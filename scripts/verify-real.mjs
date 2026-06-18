// Validates the bridge against REAL OctoPrint (Docker, virtual printer).
// Assumes OctoPrint is reachable at http://localhost:5005 with the demo key.
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
const BRIDGE_PORT = 5252;
const CAPTURE_PORT = 9099;
const SECRET = 'real-secret';

const delay = (ms) => new Promise((r) => setTimeout(r, ms));
const fetchT = (url, opts = {}) => fetch(url, { ...opts, signal: AbortSignal.timeout(4000) });
let bridge;

async function waitFor(label, fn, timeoutMs = 30000) {
	const start = Date.now();
	let last = 'no response';
	while (Date.now() - start < timeoutMs) {
		try {
			if (await fn()) return;
		} catch (e) {
			last = e.message + (e.cause?.message ? ' / ' + e.cause.message : '');
		}
		await delay(400);
	}
	throw new Error(`timeout waiting for ${label} (${last})`);
}

async function main() {
	const events = [];
	const capture = http.createServer((req, res) => {
		let body = '';
		req.on('data', (c) => (body += c));
		req.on('end', () => {
			try {
				const j = JSON.parse(body);
				events.push(j);
				console.log(`  [capture] ${j.event}  completion=${j.progress?.completion ?? '-'}  state=${j.printer?.state ?? '-'}`);
			} catch {}
			res.writeHead(200);
			res.end('{"ok":true}');
		});
	});
	await new Promise((r) => capture.listen(CAPTURE_PORT, '127.0.0.1', r));

	bridge = spawn(process.execPath, [path.join(BRIDGE_DIR, 'dist/index.js')], {
		cwd: BRIDGE_DIR,
		env: {
			...process.env,
			OCTOPRINT_URL: OCTO,
			OCTOPRINT_API_KEY: KEY,
			N8N_WEBHOOK_URL: `http://127.0.0.1:${CAPTURE_PORT}/hook`,
			BRIDGE_SHARED_SECRET: SECRET,
			BRIDGE_PORT: String(BRIDGE_PORT),
			POLL_INTERVAL_MS: '5000',
			PROGRESS_DELTA_PCT: '5',
			LOG_LEVEL: 'info',
		},
		stdio: ['ignore', 'pipe', 'pipe'],
	});
	const log = (s) => s.toString().split('\n').filter(Boolean).forEach((l) => console.log(`  [bridge] ${l}`));
	bridge.stdout.on('data', log);
	bridge.stderr.on('data', log);

	await waitFor('bridge connected to real OctoPrint', async () => {
		const r = await fetchT(`http://127.0.0.1:${BRIDGE_PORT}/api/v1/health`);
		return r.ok && (await r.json()).octoprintConnected === true;
	});
	console.log('✓ bridge connected to real OctoPrint (REST + SockJS)');

	// Upload the demo gcode directly to OctoPrint (multipart).
	const gcode = readFileSync(path.join(ROOT, 'demo/octoprint/demo.gcode'));
	const fd = new FormData();
	fd.append('file', new Blob([gcode], { type: 'application/octet-stream' }), 'demo.gcode');
	const up = await fetch(`${OCTO}/api/files/local`, { method: 'POST', headers: { 'X-Api-Key': KEY }, body: fd });
	console.log(`✓ uploaded demo.gcode -> HTTP ${up.status}`);
	await delay(1000);

	// Select + print THROUGH the bridge proxy (tests the command path on real OctoPrint).
	const sel = await fetch(`http://127.0.0.1:${BRIDGE_PORT}/api/v1/proxy/files/local/demo.gcode`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${SECRET}` },
		body: JSON.stringify({ command: 'select', print: true }),
	});
	console.log(`✓ proxy select+print -> HTTP ${sel.status}; collecting events (up to 120s)…`);

	const start = Date.now();
	while (Date.now() - start < 120000) {
		if (events.some((e) => e.event === 'PrintDone')) break;
		await delay(500);
	}

	const seen = new Set(events.map((e) => e.event));
	const required = ['PrintStarted', 'PrintDone'];
	const missing = required.filter((e) => !seen.has(e));
	console.log('\n========== RESULT (real OctoPrint) ==========');
	console.log('events seen :', [...seen].sort().join(', '));
	console.log('progress    :', events.filter((e) => e.event === 'Progress').length);
	const pass = missing.length === 0;
	console.log(pass ? '\n✅ REAL OCTOPRINT PASS' : `\n❌ FAIL (missing ${missing.join(', ')})`);
	return pass;
}

main()
	.then((pass) => {
		bridge?.kill();
		setTimeout(() => process.exit(pass ? 0 : 1), 200);
	})
	.catch((err) => {
		console.error('error:', err.message);
		bridge?.kill();
		setTimeout(() => process.exit(1), 200);
	});
