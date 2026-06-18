import type { Queue } from 'bullmq';
import type { Config } from './config';
import type { Logger } from './logger';
import type { QueueAdapter } from './n8nQueue';

/** Polls n8n for claimable jobs and feeds them into the BullMQ queue (deduped by id). */
export class QueuePoller {
	private timer: ReturnType<typeof setInterval> | null = null;
	private stopped = false;
	private polling = false;

	constructor(
		private cfg: Config,
		private log: Logger,
		private queue: QueueAdapter,
		private bull: Queue,
	) {}

	start(): void {
		if (!this.cfg.n8nQueueUrl) {
			this.log.warn('N8N_QUEUE_URL not set — n8n polling disabled (enqueue jobs directly into Redis)');
			return;
		}
		const tick = async (): Promise<void> => {
			if (this.stopped || this.polling) return;
			this.polling = true;
			try {
				const jobs = await this.queue.fetchClaimable();
				let added = 0;
				for (const job of jobs) {
					// jobId = job.id dedups: a job already queued/active won't be re-added.
					await this.bull.add('print', job, {
						jobId: job.id,
						attempts: 1,
						removeOnComplete: 200,
						removeOnFail: 500,
					});
					added++;
				}
				if (added) this.log.info(`enqueued ${added} job(s) from n8n`);
			} catch (err: any) {
				this.log.warn(`queue poll failed: ${err.message}`);
			} finally {
				this.polling = false;
			}
		};
		this.timer = setInterval(() => void tick(), this.cfg.n8nPollIntervalMs);
		void tick();
		this.log.info(`polling n8n queue every ${this.cfg.n8nPollIntervalMs}ms`);
	}

	stop(): void {
		this.stopped = true;
		if (this.timer) clearInterval(this.timer);
		this.timer = null;
	}
}
