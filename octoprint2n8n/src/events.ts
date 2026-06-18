import type { Config } from './config';

export interface Envelope {
	source: 'octoprint2n8n';
	instanceId: string;
	event: string;
	printer?: { state: string | null; flags: Record<string, boolean> };
	job?: any;
	progress?: any;
	temperatures?: Record<string, { actual: number | null; target: number | null }>;
	payload?: any;
	raw?: any;
	// `timestamp` and `nonce` are added by the forwarder just before sending.
	[key: string]: unknown;
}

export interface Snapshot {
	connected: boolean;
	octoprintVersion: string | null;
	state: string | null;
	flags: Record<string, boolean>;
	job: any;
	progress: any;
	temperatures: Record<string, { actual: number | null; target: number | null }>;
	updatedAt: string | null;
}

export function emptySnapshot(): Snapshot {
	return {
		connected: false,
		octoprintVersion: null,
		state: null,
		flags: {},
		job: null,
		progress: null,
		temperatures: {},
		updatedAt: null,
	};
}

/** Pull the most recent temperature reading out of a `current`/`history` push. */
export function extractTemps(
	current: any,
): Record<string, { actual: number | null; target: number | null }> {
	const temps = current?.temps;
	const latest = Array.isArray(temps) && temps.length > 0 ? temps[temps.length - 1] : null;
	const out: Record<string, { actual: number | null; target: number | null }> = {};
	if (latest && typeof latest === 'object') {
		for (const key of Object.keys(latest)) {
			if (key === 'time') continue;
			const entry = latest[key];
			if (entry && typeof entry === 'object') {
				out[key] = {
					actual: typeof entry.actual === 'number' ? entry.actual : null,
					target: typeof entry.target === 'number' ? entry.target : null,
				};
			}
		}
	}
	return out;
}

/** Merge a `current`/`history` push into the shared snapshot (mutates it). */
export function applyCurrentToSnapshot(snapshot: Snapshot, current: any): void {
	if (current?.state) {
		snapshot.state = current.state.text ?? snapshot.state;
		snapshot.flags = current.state.flags ?? snapshot.flags;
	}
	if (current?.job !== undefined) snapshot.job = current.job;
	if (current?.progress !== undefined) snapshot.progress = current.progress;
	const temps = extractTemps(current);
	if (Object.keys(temps).length > 0) snapshot.temperatures = temps;
	snapshot.connected = true;
	snapshot.updatedAt = new Date().toISOString();
}

function base(cfg: Config, event: string): Envelope {
	return { source: 'octoprint2n8n', instanceId: cfg.instanceId, event };
}

/** Build an envelope for a discrete OctoPrint event (PrintStarted, Error, …). */
export function eventEnvelope(
	cfg: Config,
	type: string,
	payload: any,
	snapshot: Snapshot,
): Envelope {
	const env = base(cfg, type);
	env.printer = { state: snapshot.state, flags: snapshot.flags };
	env.job = snapshot.job;
	env.progress = snapshot.progress;
	env.temperatures = snapshot.temperatures;
	env.payload = payload ?? {};
	if (cfg.includeRaw) env.raw = payload;
	return env;
}

/** Build a periodic snapshot envelope from the shared snapshot. */
export function snapshotEnvelope(cfg: Config, snapshot: Snapshot): Envelope {
	const env = base(cfg, 'Snapshot');
	env.printer = { state: snapshot.state, flags: snapshot.flags };
	env.job = snapshot.job;
	env.progress = snapshot.progress;
	env.temperatures = snapshot.temperatures;
	return env;
}

/**
 * Turns OctoPrint's high-frequency `current` feed into a manageable number of
 * Progress and StateChange events.
 */
export class CurrentProcessor {
	private lastStateText = '';
	private lastCompletion = -1;
	private lastProgressEmit = 0;

	constructor(
		private cfg: Config,
		private emit: (env: Envelope) => void,
	) {}

	handle(current: any, snapshot: Snapshot): void {
		const stateText: string = current?.state?.text ?? '';
		if (stateText && stateText !== this.lastStateText) {
			this.lastStateText = stateText;
			const env = base(this.cfg, 'StateChange');
			env.printer = { state: snapshot.state, flags: snapshot.flags };
			env.job = snapshot.job;
			env.progress = snapshot.progress;
			this.emit(env);
		}

		const completion: number | null =
			typeof current?.progress?.completion === 'number' ? current.progress.completion : null;
		if (completion !== null) {
			const now = Date.now();
			const delta = Math.abs(completion - this.lastCompletion);
			const firstSeen = this.lastCompletion < 0;
			const bigEnough = delta >= this.cfg.progressDeltaPct;
			const oldEnough = now - this.lastProgressEmit >= this.cfg.progressMinIntervalMs;
			if (firstSeen || bigEnough || oldEnough) {
				this.lastCompletion = completion;
				this.lastProgressEmit = now;
				const env = base(this.cfg, 'Progress');
				env.printer = { state: snapshot.state, flags: snapshot.flags };
				env.job = snapshot.job;
				env.progress = current.progress;
				env.temperatures = snapshot.temperatures;
				this.emit(env);
			}
		}
	}
}
