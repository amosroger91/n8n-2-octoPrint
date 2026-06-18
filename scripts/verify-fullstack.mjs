// Full-stack proof: REAL OctoPrint -> bridge -> REAL n8n (real OctoPrint Trigger
// node) -> workflow -> HTTP Request -> capture. Anything the capture server
// receives necessarily flowed through an n8n workflow execution.
//
// Assumes: OctoPrint at :5005 (demo key), n8n at :5678 with the OctoPrint Demo
// workflow active (webhook /webhook/octoprint -> HTTP Request to :9099).
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import process from 'node:process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const BRIDGE_DIR = path.join(ROOT, 'octoprint2n8n');

const OCTO = process.env.OCTO_URL || 'http://localhost:5005';
const KEY = process.env.OCTO_KEY || 'DEMOKEY00000000000000000000000000';
const N8N_WEBHOOK = process.env.N8N_WEBHOOK || 'http://localhost:5678/webhook/octoprint';
const BRIDGE_PORT = 5252;
const CAPTURE_PORT = 9099;
const SECRET = 'fullstack-secret';

const delay = (ms) => new Promise((r) => setTimeout(r, ms));
const fetchT = (url, o = {}) => fetch(url, { ...o, signal: AbortSignal.timeout(4000) });
let bridge;

async function waitFor(label, fn, timeoutMs = 30000) {
	const start = Date.now();
	let last = '';
	while (Date.now() - start < timeoutMs) {
		try { if (await fn()) return; } catch (e) { last = e.message; }
		await delay(400);
	}
	throw new Error(`timeout waiting for ${label} (${last})`);
}

async function main() {
	const viaN8n = [];
	// bind 0.0.0.0 so the n8n container can reach it via host.docker.internal
	const capture = http.createServer((req, res) => {
		let body = '';
		req.on('data', (c) => (body += c));
		req.on('end', () => {
			try {
				const j = JSON.parse(body);
				viaN8n.push(j);
				console.log(`  [via n8n] ${j.event}  completion=${j.progress?.completion ?? '-'}`);
			} catch {}
			res.writeHead(200);
			res.end('{"ok":true}');
		});
	});
	await new Promise((r) => capture.listen(CAPTURE_PORT, '0.0.0.0', r));
	console.log(`capture (for n8n HTTP Request) on 0.0.0.0:${CAPTURE_PORT}`);

	bridge = spawn(process.execPath, [path.join(BRIDGE_DIR, 'dist/index.js')], {
		cwd: BRIDGE_DIR,
		env: {
			...process.env,
			OCTOPRINT_URL: OCTO,
			OCTOPRINT_API_KEY: KEY,
			N8N_WEBHOOK_URL: N8N_WEBHOOK,
			BRIDGE_SHARED_SECRET: SECRET,
			BRIDGE_PORT: String(BRIDGE_PORT),
			POLL_INTERVAL_MS: '5000',
			PROGRESS_DELTA_PCT: '25',
			LOG_LEVEL: 'info',
		},
		stdio: ['ignore', 'pipe', 'pipe'],
	});
	const log = (s) => s.toString().split('\n').filter(Boolean).forEach((l) => console.log(`  [bridge] ${l}`));
	bridge.stdout.on('data', log);
	bridge.stderr.on('data', log);

	await waitFor('bridge connected', async () => {
		const r = await fetchT(`http://127.0.0.1:${BRIDGE_PORT}/api/v1/health`);
		return r.ok && (await r.json()).octoprintConnected === true;
	});
	console.log('✓ bridge connected; forwarding events to n8n webhook');

	const gcode = readFileSync(path.join(ROOT, 'demo/octoprint/demo.gcode'));
	const fd = new FormData();
	fd.append('file', new Blob([gcode]), 'demo.gcode');
	await fetch(`${OCTO}/api/files/local`, { method: 'POST', headers: { 'X-Api-Key': KEY }, body: fd });
	await delay(1000);
	await fetch(`http://127.0.0.1:${BRIDGE_PORT}/api/v1/proxy/files/local/demo.gcode`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${SECRET}` },
		body: JSON.stringify({ command: 'select', print: true }),
	});
	console.log('✓ started print on real OctoPrint; watching what arrives THROUGH n8n…');

	const start = Date.now();
	while (Date.now() - start < 120000) {
		if (viaN8n.some((e) => e.event === 'PrintDone')) break;
		await delay(500);
	}

	const seen = new Set(viaN8n.map((e) => e.event));
	const missing = ['PrintStarted', 'PrintDone'].filter((e) => !seen.has(e));
	console.log('\n========== RESULT (full stack via n8n) ==========');
	console.log('events that flowed through an n8n workflow execution:', [...seen].sort().join(', '));
	const pass = missing.length === 0;
	console.log(pass ? '\n✅ FULL STACK PASS' : `\n❌ FAIL (missing ${missing.join(', ')})`);
	return pass;
}

main()
	.then((pass) => { bridge?.kill(); setTimeout(() => process.exit(pass ? 0 : 1), 200); })
	.catch((err) => { console.error('error:', err.message); bridge?.kill(); setTimeout(() => process.exit(1), 200); });
