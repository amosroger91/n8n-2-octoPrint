import SockJS from 'sockjs-client';
import type { Config } from '../config';
import type { Logger } from '../logger';
import type { OctoPrintClient } from './client';

/** A push message from OctoPrint, e.g. ("event", {...}) or ("current", {...}). */
export type OctoMessageHandler = (type: string, payload: any) => void;

interface SockLike {
	onopen: (() => void) | null;
	onmessage: ((event: { data: string }) => void) | null;
	onclose: (() => void) | null;
	onerror: ((err: any) => void) | null;
	send(data: string): void;
	close(): void;
}

/**
 * Holds OctoPrint's SockJS push socket open, authenticates it, and forwards
 * every message to a handler. Reconnects with exponential backoff and forces a
 * reconnect if the feed goes silent.
 */
export class OctoPrintSocket {
	private sock: SockLike | null = null;
	private stopped = false;
	private backoff = 1000;
	private lastMessageAt = 0;
	private heartbeat: ReturnType<typeof setInterval> | null = null;

	constructor(
		private cfg: Config,
		private log: Logger,
		private rest: OctoPrintClient,
		private onMessage: OctoMessageHandler,
	) {}

	start(): void {
		this.stopped = false;
		this.lastMessageAt = Date.now();
		this.connect();
		this.heartbeat = setInterval(() => this.checkHeartbeat(), 20000);
	}

	stop(): void {
		this.stopped = true;
		if (this.heartbeat) clearInterval(this.heartbeat);
		this.heartbeat = null;
		try {
			this.sock?.close();
		} catch {
			/* ignore */
		}
	}

	private checkHeartbeat(): void {
		if (this.stopped) return;
		if (Date.now() - this.lastMessageAt > 60000) {
			this.log.warn('socket: no messages for 60s, forcing reconnect');
			try {
				this.sock?.close();
			} catch {
				/* ignore */
			}
		}
	}

	private async connect(): Promise<void> {
		if (this.stopped) return;

		let login;
		try {
			login = await this.rest.login();
		} catch (err: any) {
			this.log.error(`socket: login failed: ${err.message}`);
			this.scheduleReconnect();
			return;
		}

		const url = `${this.cfg.octoprintUrl}/sockjs`;
		this.log.info(`socket: connecting to ${url}`);

		const sock = new SockJS(url, undefined, {
			transports: ['websocket', 'xhr-streaming', 'xhr-polling'],
		}) as unknown as SockLike;
		this.sock = sock;

		sock.onopen = () => {
			this.log.info('socket: connected, authenticating');
			this.backoff = 1000;
			this.lastMessageAt = Date.now();
			sock.send(JSON.stringify({ auth: `${login.name}:${login.session}` }));
			if (this.cfg.socketThrottle > 0) {
				sock.send(JSON.stringify({ throttle: this.cfg.socketThrottle }));
			}
		};

		sock.onmessage = (event) => {
			this.lastMessageAt = Date.now();
			let msg: Record<string, any>;
			try {
				msg = JSON.parse(event.data);
			} catch {
				return;
			}
			for (const key of Object.keys(msg)) {
				try {
					this.onMessage(key, msg[key]);
				} catch (err: any) {
					this.log.error(`socket: handler error for "${key}": ${err.message}`);
				}
			}
		};

		sock.onclose = () => {
			this.log.warn('socket: closed');
			if (!this.stopped) this.scheduleReconnect();
		};

		sock.onerror = (err) => {
			this.log.warn(`socket: error ${err?.message ?? ''}`);
		};
	}

	private scheduleReconnect(): void {
		if (this.stopped) return;
		const delay = Math.min(this.backoff, 30000);
		this.log.info(`socket: reconnecting in ${delay}ms`);
		setTimeout(() => this.connect(), delay);
		this.backoff = Math.min(this.backoff * 2, 30000);
	}
}
