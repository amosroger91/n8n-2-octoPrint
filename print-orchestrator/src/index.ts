import dotenv from 'dotenv';
dotenv.config();

import { Queue, Worker } from 'bullmq';
import { QUEUE_NAME, redisConnection } from './queue';
import { loadConfig } from './config';
import { Logger } from './logger';
import { OctoPrintClient } from './octoprint';
import { HttpSlicer } from './slicer';
import { N8nQueue } from './n8nQueue';
import { PrintPipeline } from './worker';
import { QueuePoller } from './poller';
import type { PrintJob } from './job';

async function main(): Promise<void> {
	const cfg = loadConfig();
	const log = new Logger(cfg.logLevel);

	if (cfg.allowInsecureTls) process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

	log.info(`print-orchestrator starting (printer: ${cfg.printerId})`);
	log.info(`OctoPrint: ${cfg.octoprintUrl}   Redis: ${cfg.redisUrl}`);
	log.info(cfg.slicerUrl ? `Slicer: ${cfg.slicerUrl} (profile ${cfg.slicerProfile})` : 'Slicer: not configured (pre-sliced gcode only)');

	const connection = redisConnection(cfg.redisUrl);
	const octo = new OctoPrintClient(cfg);
	const slicer = new HttpSlicer(cfg);
	const queueAdapter = new N8nQueue(cfg, log);
	const pipeline = new PrintPipeline(cfg, log, octo, slicer, queueAdapter);

	const version = await octo.getVersion().catch(() => ({ ok: false, version: null }));
	log.info(version.ok ? `OctoPrint reachable (v${version.version})` : 'WARNING: OctoPrint not reachable yet — will retry per job');

	const bull = new Queue(QUEUE_NAME, { connection });
	const worker = new Worker<PrintJob>(
		QUEUE_NAME,
		async (job) => {
			await pipeline.run(job.data);
		},
		{ connection, concurrency: cfg.concurrency },
	);
	worker.on('completed', (job) => log.info(`queue: job ${job.id} completed`));
	worker.on('failed', (job, err) => log.error(`queue: job ${job?.id} failed: ${err?.message}`));

	const poller = new QueuePoller(cfg, log, queueAdapter, bull);
	poller.start();

	log.info(`worker running (concurrency ${cfg.concurrency}) on queue "${QUEUE_NAME}"`);

	const shutdown = async (signal: string): Promise<void> => {
		log.info(`${signal} — shutting down`);
		poller.stop();
		await worker.close();
		await bull.close();
		process.exit(0);
	};
	process.on('SIGINT', () => void shutdown('SIGINT'));
	process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((err: any) => {
	console.error(`fatal: ${err?.message ?? err}`);
	process.exit(1);
});
