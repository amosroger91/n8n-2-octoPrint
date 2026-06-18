import type { Config } from './config';
import type { Logger } from './logger';
import type { PrintJob, StatusUpdate } from './job';

export interface QueueAdapter {
	/** Return jobs that are ready to be claimed (n8n should filter to status=queued). */
	fetchClaimable(): Promise<PrintJob[]>;
	/** Report a status/progress change back to n8n. */
	pushStatus(update: StatusUpdate): Promise<void>;
}

/**
 * Talks to two n8n webhooks: one to GET claimable jobs, one to POST status.
 * The orchestrator NEVER mutates the table directly — it drives status through
 * `pushStatus`, and relies on the GET webhook to only return still-queued rows
 * (so a claimed job stops coming back and isn't printed twice).
 */
export class N8nQueue implements QueueAdapter {
	constructor(
		private cfg: Config,
		private log: Logger,
	) {}

	private headers(): Record<string, string> {
		const h: Record<string, string> = { 'Content-Type': 'application/json' };
		if (this.cfg.n8nAuthHeader) h['Authorization'] = this.cfg.n8nAuthHeader;
		return h;
	}

	async fetchClaimable(): Promise<PrintJob[]> {
		if (!this.cfg.n8nQueueUrl) return [];
		const res = await fetch(this.cfg.n8nQueueUrl, { headers: this.headers() });
		if (!res.ok) throw new Error(`n8n queue GET failed: HTTP ${res.status}`);
		const body: any = await res.json();
		const rows: any[] = Array.isArray(body)
			? body
			: Array.isArray(body?.jobs)
				? body.jobs
				: Array.isArray(body?.data)
					? body.data
					: [];
		return rows.map(mapRowToJob).filter((j): j is PrintJob => j !== null);
	}

	async pushStatus(update: StatusUpdate): Promise<void> {
		if (!this.cfg.n8nStatusUrl) {
			this.log.debug(`status ${update.id} -> ${update.status}${update.progress != null ? ` (${update.progress}%)` : ''} (no N8N_STATUS_URL)`);
			return;
		}
		try {
			const res = await fetch(this.cfg.n8nStatusUrl, {
				method: 'POST',
				headers: this.headers(),
				body: JSON.stringify(update),
			});
			if (!res.ok) this.log.warn(`n8n status POST failed: HTTP ${res.status}`);
		} catch (err: any) {
			this.log.warn(`n8n status POST error: ${err.message}`);
		}
	}
}

/**
 * Map a print-queue row to a PrintJob. Field names are a best guess until the
 * Data Table schema is confirmed; the full row is kept in `meta`.
 */
function mapRowToJob(row: any): PrintJob | null {
	if (!row || typeof row !== 'object') return null;
	const id = String(row.id ?? row.rowId ?? row._id ?? row.jobId ?? '');
	if (!id) return null;
	return {
		id,
		stlUrl: row.stlUrl ?? row.modelUrl ?? row.stl ?? row.url ?? undefined,
		gcodeUrl: row.gcodeUrl ?? undefined,
		name: row.name ?? row.title ?? row.fileName ?? undefined,
		profile: row.profile ?? undefined,
		material: row.material ?? undefined,
		color: row.color ?? undefined,
		meta: row,
	};
}
