import type { QueueAdapter } from './n8nQueue';
import type { StatusUpdate } from './job';

/** Keeps the latest status per job in memory so the dashboard can show recent activity. */
export class Ledger {
	private byId = new Map<string, StatusUpdate>();
	private order: string[] = [];

	constructor(private cap = 100) {}

	record(update: StatusUpdate): void {
		if (!this.byId.has(update.id)) this.order.push(update.id);
		this.byId.set(update.id, update);
		while (this.order.length > this.cap) {
			const id = this.order.shift();
			if (id) this.byId.delete(id);
		}
	}

	recent(n = 50): StatusUpdate[] {
		return this.order
			.slice(-n)
			.map((id) => this.byId.get(id))
			.filter((u): u is StatusUpdate => Boolean(u))
			.reverse();
	}
}

/** Wraps a QueueAdapter so every status update is also recorded for the dashboard. */
export class RecordingQueue implements QueueAdapter {
	constructor(
		private inner: QueueAdapter,
		private ledger: Ledger,
	) {}

	fetchClaimable(): ReturnType<QueueAdapter['fetchClaimable']> {
		return this.inner.fetchClaimable();
	}

	async pushStatus(update: StatusUpdate): Promise<void> {
		this.ledger.record(update);
		await this.inner.pushStatus(update);
	}
}
