import type { Config } from '../config';

export interface OctoResponse {
	status: number;
	ok: boolean;
	data: any;
}

export interface LoginResult {
	name: string;
	session: string;
}

/** Thin REST client for the OctoPrint API. */
export class OctoPrintClient {
	constructor(private cfg: Config) {}

	private url(path: string): string {
		const p = path.startsWith('/') ? path : `/${path}`;
		return `${this.cfg.octoprintUrl}${p}`;
	}

	async request(
		method: string,
		path: string,
		body?: unknown,
	): Promise<OctoResponse> {
		const headers: Record<string, string> = { 'X-Api-Key': this.cfg.octoprintApiKey };
		if (body !== undefined) headers['Content-Type'] = 'application/json';

		const res = await fetch(this.url(path), {
			method,
			headers,
			body: body === undefined ? undefined : JSON.stringify(body),
		});

		const text = await res.text();
		let data: any = null;
		if (text) {
			try {
				data = JSON.parse(text);
			} catch {
				data = text;
			}
		}
		return { status: res.status, ok: res.ok, data };
	}

	/**
	 * Obtain a session for the push socket. With API-key auth OctoPrint returns
	 * the associated user (or `_api`) plus a session token used as `user:session`.
	 */
	async login(): Promise<LoginResult> {
		const res = await this.request('POST', '/api/login', { passive: true });
		if (!res.ok) {
			throw new Error(`OctoPrint login failed: HTTP ${res.status}`);
		}
		const name = (res.data && res.data.name) || '_api';
		const session = res.data && res.data.session;
		if (!session) {
			throw new Error('OctoPrint login returned no session token');
		}
		return { name, session };
	}

	getVersion(): Promise<OctoResponse> {
		return this.request('GET', '/api/version');
	}
	getPrinter(): Promise<OctoResponse> {
		return this.request('GET', '/api/printer');
	}
	getJob(): Promise<OctoResponse> {
		return this.request('GET', '/api/job');
	}
}
