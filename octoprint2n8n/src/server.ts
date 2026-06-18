import http from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import type { Config } from './config';
import type { Logger } from './logger';
import type { OctoPrintClient } from './octoprint/client';
import type { Snapshot } from './events';

// OctoPrint REST resource roots the bridge is willing to proxy. The OctoPrint
// API key already grants full access, so this is a guardrail against the bridge
// being used as an arbitrary open proxy — not a privilege boundary.
const ALLOWED_ROOTS = new Set([
	'version',
	'server',
	'connection',
	'printer',
	'job',
	'files',
	'printerprofiles',
	'settings',
	'system',
]);

function readBody(req: http.IncomingMessage): Promise<string> {
	return new Promise((resolve, reject) => {
		const chunks: Buffer[] = [];
		let size = 0;
		req.on('data', (chunk: Buffer) => {
			size += chunk.length;
			if (size > 1_000_000) {
				reject(new Error('request body too large'));
				req.destroy();
				return;
			}
			chunks.push(chunk);
		});
		req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
		req.on('error', reject);
	});
}

/**
 * The bridge's inbound HTTP API:
 *   GET  /api/v1/health          - liveness + OctoPrint connectivity (no auth)
 *   GET  /api/v1/state           - last known snapshot (Bearer auth)
 *   ANY  /api/v1/proxy/<path>    - allow-listed proxy to OctoPrint (Bearer auth)
 */
export class BridgeServer {
	private server: http.Server | null = null;
	private readonly startedAt = Date.now();

	constructor(
		private cfg: Config,
		private log: Logger,
		private rest: OctoPrintClient,
		private getSnapshot: () => Snapshot,
	) {}

	start(): void {
		this.server = http.createServer((req, res) => {
			this.handle(req, res).catch((err: any) => {
				this.json(res, 500, { error: err?.message ?? 'internal error' });
			});
		});
		this.server.listen(this.cfg.bridgePort, this.cfg.bridgeBind, () => {
			this.log.info(`bridge API listening on ${this.cfg.bridgeBind}:${this.cfg.bridgePort}`);
			if (!this.cfg.sharedSecret) {
				this.log.warn('BRIDGE_SHARED_SECRET is not set: command API is DISABLED');
			}
		});
	}

	stop(): void {
		this.server?.close();
	}

	private json(res: http.ServerResponse, status: number, body: unknown): void {
		const text = JSON.stringify(body);
		res.writeHead(status, { 'Content-Type': 'application/json' });
		res.end(text);
	}

	private authorized(req: http.IncomingMessage): boolean {
		if (!this.cfg.sharedSecret) return false;
		const header = req.headers['authorization'];
		const value = Array.isArray(header) ? header[0] : header ?? '';
		const match = /^Bearer\s+(.+)$/i.exec(value);
		if (!match) return false;
		const provided = Buffer.from(match[1]);
		const expected = Buffer.from(this.cfg.sharedSecret);
		return provided.length === expected.length && timingSafeEqual(provided, expected);
	}

	private async handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
		const url = new URL(req.url ?? '/', 'http://localhost');
		const path = url.pathname;

		if (path === '/api/v1/health') {
			return this.handleHealth(res);
		}

		// Everything below requires the shared secret.
		if (!this.cfg.sharedSecret) {
			return this.json(res, 503, { error: 'command API disabled: set BRIDGE_SHARED_SECRET' });
		}
		if (!this.authorized(req)) {
			return this.json(res, 401, { error: 'unauthorized' });
		}

		if (path === '/api/v1/state') {
			return this.json(res, 200, this.getSnapshot());
		}

		if (path.startsWith('/api/v1/proxy/')) {
			return this.handleProxy(req, res, path.slice('/api/v1/proxy/'.length), url.search);
		}

		return this.json(res, 404, { error: 'not found' });
	}

	private handleHealth(res: http.ServerResponse): void {
		const snap = this.getSnapshot();
		this.json(res, 200, {
			status: 'ok',
			service: 'octoprint2n8n',
			instanceId: this.cfg.instanceId,
			uptimeSeconds: Math.round((Date.now() - this.startedAt) / 1000),
			octoprintConnected: snap.connected,
			octoprintVersion: snap.octoprintVersion,
			commandApiEnabled: Boolean(this.cfg.sharedSecret),
			forwardingEvents: Boolean(this.cfg.n8nWebhookUrl),
		});
	}

	private async handleProxy(
		req: http.IncomingMessage,
		res: http.ServerResponse,
		octoPath: string,
		search: string,
	): Promise<void> {
		if (octoPath.includes('..') || octoPath.includes('\\')) {
			return this.json(res, 400, { error: 'invalid path' });
		}
		const root = octoPath.split('/')[0];
		if (!ALLOWED_ROOTS.has(root)) {
			return this.json(res, 403, { error: `path not allowed: ${root}` });
		}

		const method = (req.method ?? 'GET').toUpperCase();
		let body: unknown;
		if (method !== 'GET' && method !== 'HEAD') {
			const raw = await readBody(req);
			if (raw) {
				try {
					body = JSON.parse(raw);
				} catch {
					return this.json(res, 400, { error: 'body must be valid JSON' });
				}
			}
		}

		const result = await this.rest.request(method, `/api/${octoPath}${search}`, body);
		return this.json(res, result.status, result.data ?? { success: result.ok });
	}
}
