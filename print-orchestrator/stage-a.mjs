// Stage A: enqueue a (pre-sliced) gcode job into BullMQ and let the worker
// drive it onto a real OctoPrint (the local virtual printer). No n8n/slicer.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

process.env.REDIS_URL = process.env.REDIS_URL || 'redis://127.0.0.1:6380';
process.env.OCTOPRINT_URL = process.env.OCTOPRINT_URL || 'http://localhost:5005';
process.env.OCTOPRINT_API_KEY = process.env.OCTOPRINT_API_KEY || 'DEMOKEY00000000000000000000000000';
process.env.LOG_LEVEL = 'info';
process.env.PRINT_POLL_INTERVAL_MS = '1000';

const { loadConfig } = await import('./dist/config.js');
const { Logger } = await import('./dist/logger.js');
const { OctoPrintClient } = await import('./dist/octoprint.js');
const { HttpSlicer } = await import('./dist/slicer.js');
const { PrintPipeline } = await import('./dist/worker.js');
const { QUEUE_NAME, redisConnection } = await import('./dist/queue.js');
const { Queue, Worker } = await import('bullmq');

const cfg = loadConfig();
const log = new Logger('info');
const octo = new OctoPrintClient(cfg);
const slicer = new HttpSlicer(cfg);

const updates = [];
const captureAdapter = {
	fetchClaimable: async () => [],
	pushStatus: async (u) => {
		updates.push(u);
		const extra = u.progress != null ? ` ${u.progress}%` : u.stats ? ` (${u.stats.filamentUsedGrams ?? '?'}g)` : '';
		console.log(`  [status] ${u.id} -> ${u.status}${extra}`);
	},
};
const pipeline = new PrintPipeline(cfg, log, octo, slicer, captureAdapter);

await octo.cancel().catch(() => {}); // ensure the virtual printer is idle

const connection = redisConnection(cfg.redisUrl);
const queue = new Queue(QUEUE_NAME, { connection });
const worker = new Worker(QUEUE_NAME, async (job) => pipeline.run(job.data), { connection, concurrency: 1 });

const gcode = readFileSync(path.join(__dirname, '..', 'demo', 'octoprint', 'demo.gcode'));
const stamp = String(Date.now());
const jobId = `stage-a-${stamp}`;
await queue.add(
	'print',
	{ id: jobId, name: `stage-a-${stamp}.gcode`, gcodeBase64: gcode.toString('base64') },
	{ jobId, attempts: 1, removeOnComplete: true, removeOnFail: true },
);
console.log(`enqueued job ${jobId} (${gcode.length} bytes of gcode)`);

const outcome = await new Promise((resolve) => {
	const t = setTimeout(() => resolve('timeout'), 90000);
	worker.on('completed', () => {
		clearTimeout(t);
		resolve('completed');
	});
	worker.on('failed', (_j, e) => {
		clearTimeout(t);
		resolve('failed: ' + e.message);
	});
});

console.log('\n========== STAGE A RESULT ==========');
console.log('worker outcome :', outcome);
console.log('status flow    :', updates.map((u) => u.status).join(' -> '));
const pass = outcome === 'completed' && updates.some((u) => u.status === 'done');
console.log(pass ? '\n✅ STAGE A PASS (queued gcode printed on real OctoPrint)' : '\n❌ STAGE A FAIL');

await worker.close();
await queue.obliterate({ force: true }).catch(() => {});
await queue.close();
process.exit(pass ? 0 : 1);
