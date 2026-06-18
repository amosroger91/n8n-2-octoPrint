import http from 'node:http';
import { randomBytes } from 'node:crypto';
import sockjs from 'sockjs';
import { VirtualPrinter } from './printer';

const PORT = Number.parseInt(process.env.PORT ?? '8080', 10);
const PRINT_DURATION_SEC = Number.parseInt(process.env.PRINT_DURATION_SEC ?? '60', 10);
const CURRENT_INTERVAL_MS = Number.parseInt(process.env.CURRENT_INTERVAL_MS ?? '500', 10);
const API_KEY = process.env.API_KEY ?? ''; // if set, required on /api/* requests
const AUTO_DEMO = /^(1|true|yes|on)$/i.test(process.env.AUTO_DEMO ?? '');
const VERSION = '1.10.3';

const printer = new VirtualPrinter(PRINT_DURATION_SEC);
const connections = new Set<any>();

function log(msg: string): void {
	console.log(`${new Date().toISOString()} [emulator] ${msg}`);
}

function broadcast(obj: Record<string, unknown>): void {
	const frame = JSON.stringify(obj);
	for (const conn of connections) {
		if (conn.__authed) {
			try {
				conn.write(frame);
			} catch {
				/* ignore */
			}
		}
	}
}

printer.on('octoEvent', (event: { type: string; payload: Record<string, unknown> }) => {
	log(`event ${event.type}`);
	broadcast({ event: { type: event.type, payload: event.payload } });
});

// --- SockJS push socket (mirrors OctoPrint's /sockjs feed) ---
const sock = sockjs.createServer({ log: () => undefined });
sock.on('connection', (conn: any) => {
	connections.add(conn);
	conn.__authed = false;
	conn.write(
		JSON.stringify({
			connected: { version: VERSION, display_version: VERSION, branch: 'master', plugin_hash: '', config_hash: '' },
		}),
	);
	conn.on('data', (message: string) => {
		let msg: Record<string, any>;
		try {
			msg = JSON.parse(message);
		} catch {
			return;
		}
		if ('auth' in msg) {
			conn.__authed = true;
			conn.write(JSON.stringify({ history: printer.current() }));
		}
		// `throttle` is accepted but ignored — the emulator emits at a fixed cadence.
	});
	conn.on('close', () => connections.delete(conn));
});

// --- REST helpers ---
function readBody(req: http.IncomingMessage): Promise<string> {
	return new Promise((resolve, reject) => {
		const chunks: Buffer[] = [];
		req.on('data', (c: Buffer) => chunks.push(c));
		req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
		req.on('error', reject);
	});
}

function sendJson(res: http.ServerResponse, status: number, body: unknown): void {
	res.writeHead(status, { 'Content-Type': 'application/json' });
	res.end(JSON.stringify(body));
}

function sendEmpty(res: http.ServerResponse, status: number): void {
	res.writeHead(status);
	res.end();
}

function parseJson(text: string): Record<string, any> {
	if (!text) return {};
	try {
		return JSON.parse(text);
	} catch {
		return {};
	}
}

// --- REST API (the subset of OctoPrint the bridge uses) ---
async function route(req: http.IncomingMessage, res: http.ServerResponse, rawUrl: string): Promise<void> {
	const url = new URL(rawUrl, 'http://localhost');
	const path = url.pathname;
	const method = (req.method ?? 'GET').toUpperCase();

	// /api/version is left unauthenticated so it works as a liveness ping
	// (e.g. the Docker healthcheck) even when API_KEY is configured.
	if (API_KEY && path.startsWith('/api/') && path !== '/api/version') {
		const key = req.headers['x-api-key'];
		if (key !== API_KEY) return sendJson(res, 403, { error: 'invalid api key' });
	}

	if (path === '/api/version' && method === 'GET') {
		return sendJson(res, 200, { api: '0.1', server: VERSION, text: `OctoPrint ${VERSION} (virtual emulator)` });
	}

	if (path === '/api/login' && method === 'POST') {
		await readBody(req);
		return sendJson(res, 200, {
			name: '_api',
			session: randomBytes(16).toString('hex'),
			active: true,
			admin: true,
			user: true,
		});
	}

	if (path === '/api/connection') {
		if (method === 'GET') {
			return sendJson(res, 200, {
				current: {
					state: printer.connected ? printer.state : 'Closed',
					port: 'VIRTUAL',
					baudrate: 115200,
					printerProfile: '_default',
				},
				options: { ports: ['VIRTUAL'], baudrates: [115200], printerProfiles: [{ id: '_default', name: 'Virtual' }] },
			});
		}
		if (method === 'POST') {
			const body = parseJson(await readBody(req));
			if (body.command === 'connect') printer.setConnected(true);
			else if (body.command === 'disconnect') printer.setConnected(false);
			return sendEmpty(res, 204);
		}
	}

	if (path === '/api/printer' && method === 'GET') {
		if (!printer.connected) return sendJson(res, 409, { error: 'Printer is not operational' });
		return sendJson(res, 200, printer.printerState());
	}

	if (path === '/api/printer/tool' && method === 'POST') {
		const body = parseJson(await readBody(req));
		if (body.command === 'target' && body.targets) {
			const t = Number(body.targets.tool0);
			if (Number.isFinite(t)) printer.setTool(t);
		}
		return sendEmpty(res, 204);
	}

	if (path === '/api/printer/bed' && method === 'POST') {
		const body = parseJson(await readBody(req));
		if (body.command === 'target' && typeof body.target === 'number') printer.setBed(body.target);
		return sendEmpty(res, 204);
	}

	if (path === '/api/printer/printhead' && method === 'POST') {
		await readBody(req);
		return sendEmpty(res, 204);
	}

	if (path === '/api/job') {
		if (method === 'GET') return sendJson(res, 200, printer.jobState());
		if (method === 'POST') {
			const body = parseJson(await readBody(req));
			if (body.command === 'start' || body.command === 'restart') printer.start();
			else if (body.command === 'cancel') printer.cancel();
			else if (body.command === 'pause') printer.pause(body.action ?? 'toggle');
			return sendEmpty(res, 204);
		}
	}

	if ((path === '/api/files' || path === '/api/files/local' || path === '/api/files/sdcard') && method === 'GET') {
		return sendJson(res, 200, printer.listFiles());
	}

	const fileMatch = /^\/api\/files\/(local|sdcard)\/(.+)$/.exec(path);
	if (fileMatch) {
		const filePath = decodeURIComponent(fileMatch[2]);
		if (method === 'POST') {
			const body = parseJson(await readBody(req));
			if (body.command === 'select') {
				const ok = printer.select(filePath, Boolean(body.print));
				return ok ? sendEmpty(res, 204) : sendJson(res, 404, { error: 'file not found' });
			}
			return sendEmpty(res, 204);
		}
		if (method === 'DELETE') return sendEmpty(res, 204);
	}

	if (path === '/api/printerprofiles' && method === 'GET') {
		return sendJson(res, 200, { profiles: { _default: { id: '_default', name: 'Virtual', model: 'Emulator' } } });
	}

	return sendJson(res, 404, { error: `not found: ${method} ${path}` });
}

const server = http.createServer((req, res) => {
	const url = req.url ?? '/';
	if (url.startsWith('/sockjs')) return; // handled by the SockJS handler below
	route(req, res, url).catch((err: any) => sendJson(res, 500, { error: err?.message ?? 'internal error' }));
});

sock.installHandlers(server, { prefix: '/sockjs' });

// --- simulation loop ---
let lastTick = Date.now();
setInterval(() => {
	const now = Date.now();
	printer.tick(now - lastTick);
	lastTick = now;
	broadcast({ current: printer.current() });
}, CURRENT_INTERVAL_MS);

server.on('error', (err: any) => {
	log(`SERVER ERROR ${err?.code ?? ''} ${err?.message ?? err}`);
	process.exit(1);
});
server.listen(PORT, '0.0.0.0', () => {
	log(`virtual OctoPrint ${VERSION} listening on http://0.0.0.0:${PORT} (print ${PRINT_DURATION_SEC}s, auto-demo ${AUTO_DEMO})`);
});

if (AUTO_DEMO) {
	printer.on('octoEvent', (e: { type: string }) => {
		if (e.type === 'PrintDone') setTimeout(() => printer.start(), 5000);
	});
	setTimeout(() => printer.start(), 2000);
}
