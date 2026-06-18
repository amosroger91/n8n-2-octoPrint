import type { Config } from './config';
import type { Logger } from './logger';
import type { PrintJob, JobStatus, SliceStats, StatusUpdate } from './job';
import type { OctoPrintClient } from './octoprint';
import type { Slicer } from './slicer';
import type { QueueAdapter } from './n8nQueue';
import { guardedFetchBuffer } from './safefetch';

/** Runs one print job through slice -> upload -> print -> monitor, reporting status. */
export class PrintPipeline {
	constructor(
		private cfg: Config,
		private log: Logger,
		private octo: OctoPrintClient,
		private slicer: Slicer,
		private queue: QueueAdapter,
	) {}

	private status(id: string, status: JobStatus, extra: Partial<StatusUpdate> = {}): Promise<void> {
		return this.queue.pushStatus({
			id,
			printerId: this.cfg.printerId,
			status,
			at: new Date().toISOString(),
			...extra,
		});
	}

	async run(job: PrintJob): Promise<void> {
		this.log.info(`job ${job.id}: claimed`);
		await this.status(job.id, 'claimed', { message: `picked up by ${this.cfg.printerId}` });

		// 1. obtain gcode (pre-sliced override, or slice the STL)
		let gcode: Buffer;
		let filename: string;
		let stats: SliceStats | undefined;

		if (job.gcodeBase64) {
			gcode = Buffer.from(job.gcodeBase64, 'base64');
			filename = job.name ?? `${job.id}.gcode`;
		} else if (job.gcodeUrl) {
			gcode = await guardedFetchBuffer(job.gcodeUrl, { allowPrivate: this.cfg.allowPrivateFetch });
			filename = job.name ?? basename(job.gcodeUrl) ?? `${job.id}.gcode`;
		} else if (job.stlUrl) {
			await this.status(job.id, 'slicing');
			this.log.info(`job ${job.id}: slicing ${job.stlUrl}`);
			const stl = await guardedFetchBuffer(job.stlUrl, { allowPrivate: this.cfg.allowPrivateFetch });
			const r = await this.slicer.slice(stl, {
				filename: job.name ?? `${job.id}.stl`,
				profile: job.profile ?? this.cfg.slicerProfile,
				material: job.material,
			});
			gcode = r.gcode;
			filename = r.filename;
			stats = r.stats;
			this.log.info(`job ${job.id}: sliced -> ${stats.filamentUsedGrams ?? '?'}g, ${stats.printTimeHours ?? '?'}h`);
		} else {
			throw new Error('job has no stlUrl, gcodeUrl, or gcodeBase64');
		}

		if (!filename.toLowerCase().endsWith('.gcode')) filename += '.gcode';

		// 2. upload
		await this.status(job.id, 'uploading', { stats });
		this.log.info(`job ${job.id}: uploading ${filename} (${gcode.length} bytes)`);
		const stored = await this.octo.upload(filename, gcode);

		// 3. start the print
		await this.status(job.id, 'printing', { progress: 0, stats });
		this.log.info(`job ${job.id}: starting print of ${stored}`);
		await this.octo.selectAndPrint(stored);

		// 4. monitor to completion
		let lastReported = -5;
		const { result, completion } = await this.octo.monitorPrint(
			(c) => {
				const pct = Math.floor(c ?? 0);
				if (pct >= lastReported + 5) {
					lastReported = pct;
					void this.status(job.id, 'printing', { progress: pct });
					this.log.debug(`job ${job.id}: ${pct}%`);
				}
			},
			{ intervalMs: this.cfg.printPollIntervalMs, timeoutMs: this.cfg.printTimeoutMs },
		);

		if (result === 'done') {
			await this.status(job.id, 'done', { progress: 100, stats, message: 'print complete' });
			this.log.info(`job ${job.id}: DONE`);
			return;
		}

		const status: JobStatus = result === 'cancelled' ? 'cancelled' : 'failed';
		await this.status(job.id, status, { progress: Math.floor(completion), error: `print ${result}` });
		this.log.warn(`job ${job.id}: ${result} at ${Math.floor(completion)}%`);
		// Non-'done' prints are terminal; throwing lets BullMQ record the failure.
		if (result !== 'cancelled') throw new Error(`print ${result}`);
	}
}

function basename(url: string): string | null {
	try {
		const p = new URL(url).pathname.split('/').pop();
		return p || null;
	} catch {
		return null;
	}
}
