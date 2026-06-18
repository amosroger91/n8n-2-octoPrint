import { createHmac, randomBytes } from 'node:crypto';
import type { Config } from '../config';
import type { Logger } from '../logger';
import type { Envelope } from '../events';

/**
 * Buffers normalized events and POSTs them to the n8n trigger webhook, signing
 * each with the shared secret. A failed send is retried with backoff; the
 * queue is bounded so a long n8n outage can't exhaust memory.
 */
export class N8nForwarder {
	private queue: Envelope[] = [];
	private pumping = false;
	private retryTimer: ReturnType<typeof setTimeout> | null = null;
	private backoff = 1000;

	constructor(
		private cfg: Config,
		private log: Logger,
	) {}

	enqueue(env: Envelope): void {
		if (!this.cfg.n8nWebhookUrl) return;
		this.queue.push(env);
		while (this.queue.length > this.cfg.queueMax) {
			this.queue.shift();
			this.log.warn('forwarder: queue full, dropping oldest event');
		}
		void this.pump();
	}

	private async pump(): Promise<void> {
		if (this.pumping || this.queue.length === 0 || !this.cfg.n8nWebhookUrl) return;
		this.pumping = true;
		try {
			while (this.queue.length > 0) {
				await this.send(this.queue[0]);
				this.queue.shift();
				this.backoff = 1000;
			}
		} catch (err: any) {
			this.log.warn(`forwarder: send failed (${err.message}); will retry`);
			this.scheduleRetry();
		} finally {
			this.pumping = false;
		}
	}

	private scheduleRetry(): void {
		if (this.retryTimer) return;
		const delay = Math.min(this.backoff, 30000);
		this.retryTimer = setTimeout(() => {
			this.retryTimer = null;
			void this.pump();
		}, delay);
		this.backoff = Math.min(this.backoff * 2, 30000);
	}

	private async send(env: Envelope): Promise<void> {
		const url = this.cfg.n8nWebhookUrl as string;
		const timestamp = new Date().toISOString();
		const nonce = randomBytes(8).toString('hex');
		const payload: Envelope = { ...env, timestamp, nonce };

		const headers: Record<string, string> = { 'Content-Type': 'application/json' };
		if (this.cfg.sharedSecret) {
			const signature = createHmac('sha256', this.cfg.sharedSecret)
				.update(`v1:${timestamp}:${nonce}:${env.event}:${env.instanceId}`)
				.digest('hex');
			headers['X-Octoprint-Signature'] = `v1=${signature}`;
			headers['X-Octoprint-Timestamp'] = timestamp;
		}

		const res = await fetch(url, {
			method: 'POST',
			headers,
			body: JSON.stringify(payload),
		});
		if (!res.ok) throw new Error(`HTTP ${res.status}`);
		this.log.debug(`forwarder: sent ${env.event}`);
	}
}
