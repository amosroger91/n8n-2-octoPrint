import WebSocket from 'ws';
import { randomBytes } from 'node:crypto';
import type { Config } from '../config';
import type { Logger } from '../logger';
import type { OctoPrintClient } from './client';

/** A push message from OctoPrint, e.g. ("event", {...}) or ("current", {...}). */
export type OctoMessageHandler = (type: string, payload: any) => void;

/**
 * Holds OctoPrint's push socket open and forwards every message to a handler.
 *
 * OctoPrint exposes its feed over SockJS. Rather than depend on the browser
 * `sockjs-client` (which is unreliable under Node), we connect a plain
 * WebSocket to the SockJS raw-websocket transport and speak its tiny framing
 * directly: an `o` open frame, `h` heartbeats, `a[...]` arrays of JSON message
 * strings, and a `c[...]` close frame. Reconnects with exponential backoff and
 * forces a reconnect if the feed goes silent.
 */
export class OctoPrintSocket {
	private ws: WebSocket | null = null;
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
		void this.connect();
		this.heartbeat = setInterval(() => this.checkHeartbeat(), 20000);
	}

	stop(): void {
		this.stopped = true;
		if (this.heartbeat) clearInterval(this.heartbeat);
		this.heartbeat = null;
		try {
			this.ws?.close();
		} catch {
			/* ignore */
		}
	}

	private checkHeartbeat(): void {
		if (this.stopped) return;
		if (Date.now() - this.lastMessageAt > 60000) {
			this.log.warn('socket: no messages for 60s, forcing reconnect');
			try {
				this.ws?.terminate();
			} catch {
				/* ignore */
			}
		}
	}

	private socketUrl(): string {
		const base = this.cfg.octoprintUrl.replace(/^http/i, 'ws').replace(/\/+$/, '');
		const session = randomBytes(8).toString('hex');
		return `${base}/sockjs/000/${session}/websocket`;
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

		const url = this.socketUrl();
		this.log.info(`socket: connecting to ${url.replace(/\/[0-9a-f]+\/websocket$/, '/…/websocket')}`);

		const ws = new WebSocket(url, { rejectUnauthorized: !this.cfg.allowInsecureTls });
		this.ws = ws;

		ws.on('open', () => this.log.debug('socket: websocket open, awaiting SockJS open frame'));

		ws.on('message', (data: WebSocket.RawData) => {
			this.lastMessageAt = Date.now();
			const frame = data.toString();
			if (frame.length === 0) return;
			const type = frame[0];

			if (type === 'o') {
				this.log.info('socket: SockJS open, authenticating');
				this.backoff = 1000;
				this.sendMessage(ws, { auth: `${login.name}:${login.session}` });
				if (this.cfg.socketThrottle > 0) {
					this.sendMessage(ws, { throttle: this.cfg.socketThrottle });
				}
			} else if (type === 'a') {
				let messages: unknown[];
				try {
					messages = JSON.parse(frame.slice(1));
				} catch {
					return;
				}
				for (const raw of messages) {
					// Real OctoPrint (sockjs-tornado) embeds JSON objects directly in the
					// array; the SockJS spec / node `sockjs` lib wrap each in a JSON string.
					// Accept both so the bridge works against either.
					let msg: Record<string, any> | null = null;
					if (typeof raw === 'string') {
						try {
							msg = JSON.parse(raw);
						} catch {
							msg = null;
						}
					} else if (raw && typeof raw === 'object') {
						msg = raw as Record<string, any>;
					}
					if (!msg) continue;
					for (const key of Object.keys(msg)) {
						try {
							this.onMessage(key, msg[key]);
						} catch (err: any) {
							this.log.error(`socket: handler error for "${key}": ${err.message}`);
						}
					}
				}
			} else if (type === 'c') {
				this.log.warn(`socket: SockJS close frame ${frame.slice(1)}`);
			}
			// 'h' heartbeat frames are intentionally ignored.
		});

		ws.on('close', () => {
			this.log.warn('socket: closed');
			if (!this.stopped) this.scheduleReconnect();
		});

		ws.on('error', (err: any) => {
			this.log.warn(`socket: error ${err?.message ?? ''}`);
		});
	}

	/** SockJS raw-websocket expects a JSON array of JSON-encoded message strings. */
	private sendMessage(ws: WebSocket, obj: unknown): void {
		ws.send(JSON.stringify([JSON.stringify(obj)]));
	}

	private scheduleReconnect(): void {
		if (this.stopped) return;
		const delay = Math.min(this.backoff, 30000);
		this.log.info(`socket: reconnecting in ${delay}ms`);
		setTimeout(() => void this.connect(), delay);
		this.backoff = Math.min(this.backoff * 2, 30000);
	}
}
