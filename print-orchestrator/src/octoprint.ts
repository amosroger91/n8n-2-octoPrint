import type { Config } from './config';

export interface PrinterSnapshot {
	state: string;
	completion: number | null;
	connected: boolean;
}

export type PrintResult = 'done' | 'cancelled' | 'failed' | 'timeout';

const PRINTING_STATES = ['Printing', 'Pausing', 'Paused', 'Resuming', 'Finishing', 'Cancelling'];

/** REST client for the slice of OctoPrint the orchestrator drives. */
export class OctoPrintClient {
	constructor(private cfg: Config) {}

	private url(path: string): string {
		return `${this.cfg.octoprintUrl}${path.startsWith('/') ? path : `/${path}`}`;
	}

	private async request(method: string, path: string, body?: unknown): Promise<{ status: number; ok: boolean; data: any }> {
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

	async getVersion(): Promise<{ ok: boolean; version: string | null }> {
		const r = await this.request('GET', '/api/version');
		return { ok: r.ok, version: r.ok ? r.data?.server ?? null : null };
	}

	/** Read print state via /api/job (always 200, unlike /api/printer which 409s when idle). */
	async snapshot(): Promise<PrinterSnapshot> {
		const r = await this.request('GET', '/api/job');
		if (!r.ok) return { state: 'Unknown', completion: null, connected: false };
		const state = r.data?.state ?? 'Unknown';
		const completion = typeof r.data?.progress?.completion === 'number' ? r.data.progress.completion : null;
		return { state, completion, connected: !/offline|closed/i.test(state) };
	}

	/** Upload a gcode file to OctoPrint's local storage. Returns the stored filename. */
	async upload(filename: string, bytes: Buffer): Promise<string> {
		const form = new FormData();
		form.append('file', new Blob([bytes], { type: 'application/octet-stream' }), filename);
		const res = await fetch(this.url('/api/files/local'), {
			method: 'POST',
			headers: { 'X-Api-Key': this.cfg.octoprintApiKey },
			body: form,
		});
		if (!res.ok) {
			throw new Error(`OctoPrint upload failed: HTTP ${res.status} ${await res.text()}`);
		}
		const data: any = await res.json().catch(() => ({}));
		return data?.files?.local?.name ?? filename;
	}

	/** Select a stored file and start printing it. */
	async selectAndPrint(path: string, location = 'local'): Promise<void> {
		const encoded = path.split('/').map(encodeURIComponent).join('/');
		const r = await this.request('POST', `/api/files/${location}/${encoded}`, { command: 'select', print: true });
		if (!r.ok) throw new Error(`OctoPrint select+print failed: HTTP ${r.status}`);
	}

	async cancel(): Promise<void> {
		await this.request('POST', '/api/job', { command: 'cancel' });
	}

	/**
	 * Poll until the current print finishes. Resolves with the outcome.
	 * Calls onProgress(completion) while printing.
	 */
	async monitorPrint(
		onProgress: (completion: number | null) => void,
		opts: { intervalMs: number; timeoutMs: number },
	): Promise<{ result: PrintResult; completion: number }> {
		const start = Date.now();
		let sawPrinting = false;
		let lastCompletion = 0;

		while (Date.now() - start < opts.timeoutMs) {
			await delay(opts.intervalMs);
			let snap: PrinterSnapshot;
			try {
				snap = await this.snapshot();
			} catch {
				continue; // transient; keep polling
			}
			if (typeof snap.completion === 'number') lastCompletion = snap.completion;

			if (/error/i.test(snap.state)) {
				return { result: 'failed', completion: lastCompletion };
			}
			if (PRINTING_STATES.includes(snap.state)) {
				sawPrinting = true;
				onProgress(snap.completion);
			} else if (sawPrinting && snap.state === 'Operational') {
				return { result: lastCompletion >= 99.5 ? 'done' : 'cancelled', completion: lastCompletion };
			}
		}
		return { result: 'timeout', completion: lastCompletion };
	}
}

function delay(ms: number): Promise<void> {
	return new Promise((r) => setTimeout(r, ms));
}
