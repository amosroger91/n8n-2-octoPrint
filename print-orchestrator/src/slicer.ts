import type { Config } from './config';
import type { SliceStats } from './job';
import { assertFetchAllowed } from './safefetch';

export interface SliceResult {
	gcode: Buffer;
	filename: string;
	stats: SliceStats;
}

export interface Slicer {
	slice(stl: Buffer, opts: { filename: string; profile: string; material?: string }): Promise<SliceResult>;
}

/**
 * Posts an STL to the hosted slice API and returns gcode + stats.
 *
 * The exact request/response shape of a slice API varies, so this is
 * deliberately liberal:
 *   - request: multipart with `file` (the STL) + `profile` + `material` fields
 *   - response: either raw gcode (any non-JSON body) OR JSON with one of
 *     `gcodeBase64` / `gcode` / `gcodeUrl`, plus optional `stats`.
 * Stats are also parsed straight from the gcode comments as a fallback, so we
 * report filament + time even if the API returns only gcode.
 */
export class HttpSlicer implements Slicer {
	constructor(private cfg: Config) {}

	async slice(stl: Buffer, opts: { filename: string; profile: string; material?: string }): Promise<SliceResult> {
		if (!this.cfg.slicerUrl) throw new Error('SLICER_URL is not configured');

		const form = new FormData();
		form.append('file', new Blob([stl], { type: 'application/octet-stream' }), opts.filename);
		form.append('profile', opts.profile);
		if (opts.material) form.append('material', opts.material);

		const headers: Record<string, string> = {};
		if (this.cfg.slicerUsername || this.cfg.slicerPassword) {
			const token = Buffer.from(`${this.cfg.slicerUsername ?? ''}:${this.cfg.slicerPassword ?? ''}`).toString('base64');
			headers['Authorization'] = `Basic ${token}`;
		}

		const res = await fetch(this.cfg.slicerUrl, { method: 'POST', headers, body: form });
		if (!res.ok) {
			throw new Error(`Slicer failed: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
		}

		const contentType = res.headers.get('content-type') ?? '';
		let gcode: Buffer;
		let apiStats: SliceStats | undefined;

		if (contentType.includes('application/json')) {
			const body: any = await res.json();
			apiStats = body.stats ?? pickStats(body);
			if (body.gcodeBase64) gcode = Buffer.from(body.gcodeBase64, 'base64');
			else if (typeof body.gcode === 'string') gcode = Buffer.from(body.gcode, 'utf8');
			else if (body.gcodeUrl) {
				await assertFetchAllowed(body.gcodeUrl, { allowPrivate: this.cfg.allowPrivateFetch });
				const g = await fetch(body.gcodeUrl, { headers, redirect: 'error' });
				gcode = Buffer.from(await g.arrayBuffer());
			} else throw new Error('Slicer JSON had no gcode / gcodeBase64 / gcodeUrl');
		} else {
			gcode = Buffer.from(await res.arrayBuffer());
		}

		const parsed = parseGcodeStats(gcode.toString('utf8'));
		const filename = opts.filename.replace(/\.(stl|3mf|obj)$/i, '') + '.gcode';
		return { gcode, filename, stats: { ...parsed, ...apiStats } };
	}
}

function pickStats(body: any): SliceStats {
	return {
		filamentUsedCm3: numOrUndef(body.filamentUsedCm3),
		filamentUsedGrams: numOrUndef(body.filamentUsedGrams ?? body.grams),
		printTimeHours: numOrUndef(body.printTimeHours ?? body.hours),
	};
}

function numOrUndef(v: unknown): number | undefined {
	return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

/** Parse filament + time from OrcaSlicer/Cura-style gcode comments. */
export function parseGcodeStats(gcode: string): SliceStats {
	const stats: SliceStats = {};

	const grams = /;\s*(?:total\s+)?filament used\s*\[g\]\s*=\s*([\d.]+)/i.exec(gcode);
	if (grams) stats.filamentUsedGrams = Number.parseFloat(grams[1]);

	const cm3 = /;\s*(?:total\s+)?filament used\s*\[cm3\]\s*=\s*([\d.]+)/i.exec(gcode);
	if (cm3) stats.filamentUsedCm3 = Number.parseFloat(cm3[1]);

	// grams reported as 0 by some profiles -> derive from cm3 (PLA density 1.24)
	if ((!stats.filamentUsedGrams || stats.filamentUsedGrams === 0) && stats.filamentUsedCm3) {
		stats.filamentUsedGrams = Math.round(stats.filamentUsedCm3 * 1.24 * 10) / 10;
	}

	const time = /;\s*estimated printing time(?:\s*\(normal mode\))?\s*=\s*(.+)/i.exec(gcode);
	if (time) {
		const hours = parseDurationToHours(time[1].trim());
		if (hours !== null) stats.printTimeHours = Math.round(hours * 100) / 100;
	}
	return stats;
}

function parseDurationToHours(text: string): number | null {
	let total = 0;
	let matched = false;
	for (const [re, mult] of [
		[/(\d+)\s*d/i, 24],
		[/(\d+)\s*h/i, 1],
		[/(\d+)\s*m/i, 1 / 60],
		[/(\d+)\s*s/i, 1 / 3600],
	] as const) {
		const m = re.exec(text);
		if (m) {
			total += Number.parseInt(m[1], 10) * mult;
			matched = true;
		}
	}
	return matched ? total : null;
}
