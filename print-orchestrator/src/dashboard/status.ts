import type { Queue } from 'bullmq';
import type { Config } from '../config';
import type { OctoPrintClient } from '../octoprint';
import type { Ledger } from '../ledger';
import type { StatusUpdate } from '../job';

export interface SystemStatus {
	printerId: string;
	printer: {
		url: string;
		reachable: boolean;
		version: string | null;
		state: string;
		completion: number | null;
	};
	queue: { waiting: number; active: number; completed: number; failed: number; delayed: number };
	jobs: StatusUpdate[];
	config: { slicerConfigured: boolean; slicerProfile: string; n8nPolling: boolean; concurrency: number };
	generatedAt: string;
}

export async function buildStatus(
	cfg: Config,
	octo: OctoPrintClient,
	bull: Queue,
	ledger: Ledger,
): Promise<SystemStatus> {
	const [version, snap, counts] = await Promise.all([
		octo.getVersion().catch(() => ({ ok: false, version: null })),
		octo.snapshot().catch(() => ({ state: 'Unknown', completion: null, connected: false })),
		bull.getJobCounts('waiting', 'active', 'completed', 'failed', 'delayed').catch(() => ({}) as Record<string, number>),
	]);

	return {
		printerId: cfg.printerId,
		printer: {
			url: cfg.octoprintUrl,
			reachable: version.ok,
			version: version.version,
			state: snap.state,
			completion: snap.completion,
		},
		queue: {
			waiting: counts.waiting ?? 0,
			active: counts.active ?? 0,
			completed: counts.completed ?? 0,
			failed: counts.failed ?? 0,
			delayed: counts.delayed ?? 0,
		},
		jobs: ledger.recent(50),
		config: {
			slicerConfigured: Boolean(cfg.slicerUrl),
			slicerProfile: cfg.slicerProfile,
			n8nPolling: Boolean(cfg.n8nQueueUrl),
			concurrency: cfg.concurrency,
		},
		generatedAt: new Date().toISOString(),
	};
}
