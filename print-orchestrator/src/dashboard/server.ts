import http from 'node:http';
import { randomBytes } from 'node:crypto';
import type { Queue } from 'bullmq';
import type { Config } from '../config';
import type { Logger } from '../logger';
import type { OctoPrintClient } from '../octoprint';
import type { Ledger } from '../ledger';
import type { AuthRegistry } from '../auth/registry';
import type { AuthUser } from '../auth/types';
import { parseCookies, serializeCookie } from '../auth/session';
import { buildStatus } from './status';
import { dashboardPage, loginPage } from './page';

const SESSION_COOKIE = 'po_session';
const STATE_COOKIE = 'po_oauth_state';
const SESSION_MAX_AGE = 7 * 24 * 3600;

/** Serves the auth-guarded status dashboard. */
export class DashboardServer {
	private server: http.Server | null = null;

	constructor(
		private cfg: Config,
		private log: Logger,
		private auth: AuthRegistry,
		private octo: OctoPrintClient,
		private bull: Queue,
		private ledger: Ledger,
	) {}

	start(): void {
		this.server = http.createServer((req, res) => {
			this.handle(req, res).catch((err: any) => this.send(res, 500, 'text/plain', `error: ${err?.message ?? err}`));
		});
		this.server.listen(this.cfg.dashboardPort, () => {
			this.log.info(`dashboard on http://localhost:${this.cfg.dashboardPort}`);
		});
	}

	stop(): void {
		this.server?.close();
	}

	private currentUser(req: http.IncomingMessage): AuthUser | null {
		return this.auth.sessions.verify(parseCookies(req.headers.cookie)[SESSION_COOKIE]);
	}

	private send(res: http.ServerResponse, status: number, type: string, body: string): void {
		res.writeHead(status, { 'Content-Type': type });
		res.end(body);
	}

	private redirect(res: http.ServerResponse, location: string): void {
		res.writeHead(302, { Location: location });
		res.end();
	}

	private async handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
		const url = new URL(req.url ?? '/', 'http://localhost');
		const path = url.pathname;
		const method = (req.method ?? 'GET').toUpperCase();

		if (path === '/healthz') return this.send(res, 200, 'application/json', '{"status":"ok"}');

		if (path === '/login' && method === 'GET') {
			return this.send(
				res,
				200,
				'text/html',
				loginPage({
					passwordProviders: this.auth.password(),
					oauthProviders: this.auth.oauth(),
					error: url.searchParams.get('error') ?? undefined,
				}),
			);
		}
		if (path === '/login' && method === 'POST') return this.handleLogin(req, res);
		if (path === '/logout' && method === 'POST') {
			res.setHeader('Set-Cookie', serializeCookie(SESSION_COOKIE, '', { maxAgeSec: 0 }));
			return this.redirect(res, '/login');
		}

		const start = /^\/auth\/([\w-]+)$/.exec(path);
		if (start && method === 'GET') return this.handleOAuthStart(req, res, start[1]);
		const callback = /^\/auth\/([\w-]+)\/callback$/.exec(path);
		if (callback && method === 'GET') return this.handleOAuthCallback(req, res, callback[1], url);

		// --- authenticated routes ---
		const user = this.currentUser(req);

		if (path === '/api/status' && method === 'GET') {
			if (!user) return this.send(res, 401, 'application/json', '{"error":"unauthorized"}');
			const status = await buildStatus(this.cfg, this.octo, this.bull, this.ledger);
			return this.send(res, 200, 'application/json', JSON.stringify(status));
		}
		if (path === '/' && method === 'GET') {
			if (!user) return this.redirect(res, '/login');
			return this.send(res, 200, 'text/html', dashboardPage(user));
		}

		return this.send(res, 404, 'text/plain', 'not found');
	}

	private async handleLogin(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
		const params = new URLSearchParams(await readBody(req));
		const username = params.get('username') ?? '';
		const password = params.get('password') ?? '';
		for (const provider of this.auth.password()) {
			const user = await provider.verify(username, password).catch(() => null);
			if (user) {
				res.setHeader('Set-Cookie', serializeCookie(SESSION_COOKIE, this.auth.sessions.issue(user), { maxAgeSec: SESSION_MAX_AGE }));
				return this.redirect(res, '/');
			}
		}
		this.log.warn(`dashboard: failed login for "${username}"`);
		return this.redirect(res, '/login?error=' + encodeURIComponent('Invalid username or password'));
	}

	private redirectUri(req: http.IncomingMessage, id: string): string {
		const proto = headerValue(req.headers['x-forwarded-proto']) ?? 'http';
		const host = headerValue(req.headers['x-forwarded-host']) ?? req.headers.host ?? `localhost:${this.cfg.dashboardPort}`;
		return `${proto}://${host}/auth/${id}/callback`;
	}

	private handleOAuthStart(req: http.IncomingMessage, res: http.ServerResponse, id: string): void {
		const provider = this.auth.get(id);
		if (!provider || provider.kind !== 'oauth') return this.send(res, 404, 'text/plain', 'unknown provider');
		const state = randomBytes(16).toString('hex');
		res.setHeader('Set-Cookie', serializeCookie(STATE_COOKIE, state, { maxAgeSec: 600 }));
		this.redirect(res, provider.authorizeUrl(state, this.redirectUri(req, id)));
	}

	private async handleOAuthCallback(req: http.IncomingMessage, res: http.ServerResponse, id: string, url: URL): Promise<void> {
		const provider = this.auth.get(id);
		if (!provider || provider.kind !== 'oauth') return this.send(res, 404, 'text/plain', 'unknown provider');
		const expected = parseCookies(req.headers.cookie)[STATE_COOKIE];
		if (!expected || url.searchParams.get('state') !== expected) {
			return this.redirect(res, '/login?error=' + encodeURIComponent('OAuth state mismatch'));
		}
		const user = await provider.handleCallback(url.searchParams, this.redirectUri(req, id)).catch(() => null);
		if (!user) return this.redirect(res, '/login?error=' + encodeURIComponent('Sign-in failed'));
		res.setHeader('Set-Cookie', [
			serializeCookie(SESSION_COOKIE, this.auth.sessions.issue(user), { maxAgeSec: SESSION_MAX_AGE }),
			serializeCookie(STATE_COOKIE, '', { maxAgeSec: 0 }),
		]);
		this.redirect(res, '/');
	}
}

function headerValue(v: string | string[] | undefined): string | undefined {
	return Array.isArray(v) ? v[0] : v;
}

function readBody(req: http.IncomingMessage): Promise<string> {
	return new Promise((resolve, reject) => {
		const chunks: Buffer[] = [];
		let size = 0;
		req.on('data', (c: Buffer) => {
			size += c.length;
			if (size > 1_000_000) {
				reject(new Error('body too large'));
				req.destroy();
				return;
			}
			chunks.push(c);
		});
		req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
		req.on('error', reject);
	});
}
