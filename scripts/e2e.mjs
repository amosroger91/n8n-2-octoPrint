// End-to-end smoke test for n8n-2-octoPrint — no printer, no n8n required.
//
// It boots the octoprint-emulator and the octoprint2n8n bridge as child
// processes, points the bridge's event webhook at a local capture server
// (standing in for an n8n trigger), then:
//   1. sends a command DOWN through the bridge proxy (set tool temp) and
//      confirms the emulator received it;
//   2. starts a print through the bridge proxy and confirms the lifecycle
//      events (PrintStarted ... PrintDone) come back UP to the capture server.
//
// Run after building both packages:  node scripts/e2e.mjs
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import http from 'node:http';
import process from 'node:process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const EMU_DIR = path.join(ROOT, 'octoprint-emulator');
const BRIDGE_DIR = path.join(ROOT, 'octoprint2n8n');

const EMU_PORT = 8188;
const BRIDGE_PORT = 5353;
const CAPTURE_PORT = 8199;
const SECRET = 'e2e-secret';
const API_KEY = 'test-key';

const delay = (ms) => new Promise((r) => setTimeout(r, ms));
const fetchT = (url, opts = {}) => fetch(url, { ...opts, signal: AbortSignal.timeout(2000) });
const children = [];

function spawnApp(name, cwd, env) {
	const child = spawn(process.execPath, [path.join(cwd, 'dist/index.js')], {
		cwd,
		env: { ...process.env, ...env },
		stdio: ['ignore', 'pipe', 'pipe'],
	});
	const pipe = (stream) =>
		stream.on('data', (d) =>
			d
				.toString()
				.split('\n')
				.filter(Boolean)
				.forEach((l) => console.log(`  [${name}] ${l}`)),
		);
	pipe(child.stdout);
	pipe(child.stderr);
	child.on('exit', (code, sig) => code !== null && console.log(`  [${name}] exited code=${code} sig=${sig}`));
	children.push(child);
	return child;
}

async function waitFor(label, fn, timeoutMs = 20000, intervalMs = 300) {
	const start = Date.now();
	let lastErr = 'predicate never returned true';
	while (Date.now() - start < timeoutMs) {
		try {
			if (await fn()) return;
		} catch (err) {
			lastErr = `${err.message}${err.cause?.message ? ' / ' + err.cause.message : ''}`;
		}
		await delay(intervalMs);
	}
	throw new Error(`timeout waiting for ${label} (last: ${lastErr})`);
}

function cleanup() {
	for (const c of children) {
		try {
			c.kill();
		} catch {
			/* ignore */
		}
	}
}

async function main() {
	const events = [];
	const capture = http.createServer((req, res) => {
		if (req.method !== 'POST') {
			res.writeHead(404);
			res.end();
			return;
		}
		let body = '';
		req.on('data', (c) => (body += c));
		req.on('end', () => {
			try {
				const j = JSON.parse(body);
				events.push(j);
				console.log(`  [capture] ${j.event}  completion=${j.progress?.completion ?? '-'}  signed=${Boolean(req.headers['x-octoprint-signature'])}`);
			} catch {
				/* ignore */
			}
			res.writeHead(200, { 'Content-Type': 'application/json' });
			res.end('{"ok":true}');
		});
	});
	await new Promise((r) => capture.listen(CAPTURE_PORT, '127.0.0.1', r));
	console.log(`capture server on 127.0.0.1:${CAPTURE_PORT}`);

	spawnApp('emu', EMU_DIR, {
		PORT: String(EMU_PORT),
		PRINT_DURATION_SEC: '5',
		CURRENT_INTERVAL_MS: '300',
		API_KEY,
	});
	await waitFor('emulator', async () => (await fetchT(`http://127.0.0.1:${EMU_PORT}/api/version`, { headers: { 'X-Api-Key': API_KEY } })).ok);
	console.log('✓ emulator up');

	spawnApp('bridge', BRIDGE_DIR, {
		OCTOPRINT_URL: `http://127.0.0.1:${EMU_PORT}`,
		OCTOPRINT_API_KEY: API_KEY,
		N8N_WEBHOOK_URL: `http://127.0.0.1:${CAPTURE_PORT}/hook`,
		BRIDGE_SHARED_SECRET: SECRET,
		BRIDGE_PORT: String(BRIDGE_PORT),
		POLL_INTERVAL_MS: '2000',
		PROGRESS_DELTA_PCT: '5',
		LOG_LEVEL: 'info',
	});
	await waitFor('bridge connected', async () => {
		const r = await fetchT(`http://127.0.0.1:${BRIDGE_PORT}/api/v1/health`);
		if (!r.ok) return false;
		return (await r.json()).octoprintConnected === true;
	});
	console.log('✓ bridge up + connected to emulator');

	// 1. Command DOWN: set tool temperature through the bridge proxy.
	const toolRes = await fetch(`http://127.0.0.1:${BRIDGE_PORT}/api/v1/proxy/printer/tool`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${SECRET}` },
		body: JSON.stringify({ command: 'target', targets: { tool0: 200 } }),
	});
	await delay(300);
	const printer = await (await fetch(`http://127.0.0.1:${EMU_PORT}/api/printer`, { headers: { 'X-Api-Key': API_KEY } })).json();
	const toolTarget = printer.temperature?.tool0?.target;
	console.log(`✓ proxy set tool -> HTTP ${toolRes.status}, emulator tool0.target=${toolTarget}`);

	// 2. Start a print through the bridge proxy, then collect events.
	const startRes = await fetch(`http://127.0.0.1:${BRIDGE_PORT}/api/v1/proxy/job`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${SECRET}` },
		body: JSON.stringify({ command: 'start' }),
	});
	console.log(`✓ proxy start print -> HTTP ${startRes.status}; collecting events…`);
	await delay(8000);

	const seen = new Set(events.map((e) => e.event));
	const required = ['PrintStarted', 'PrintDone'];
	const missing = required.filter((e) => !seen.has(e));
	const progressCount = events.filter((e) => e.event === 'Progress').length;

	console.log('\n========== RESULT ==========');
	console.log('events seen      :', [...seen].sort().join(', '));
	console.log('progress events  :', progressCount);
	console.log('tool round-trip  :', toolTarget === 200 ? 'OK (200°C)' : `FAIL (${toolTarget})`);
	console.log('lifecycle events :', missing.length === 0 ? 'OK (PrintStarted + PrintDone)' : `MISSING ${missing.join(', ')}`);

	const pass = missing.length === 0 && toolTarget === 200 && progressCount > 0;
	console.log(pass ? '\n✅ E2E PASS' : '\n❌ E2E FAIL');
	return pass;
}

const safety = setTimeout(() => {
	console.error('global timeout');
	cleanup();
	process.exit(1);
}, 60000);

main()
	.then((pass) => {
		clearTimeout(safety);
		cleanup();
		setTimeout(() => process.exit(pass ? 0 : 1), 200);
	})
	.catch((err) => {
		clearTimeout(safety);
		console.error('e2e error:', err.message);
		cleanup();
		setTimeout(() => process.exit(1), 200);
	});
