import type { Config } from './config';
import type { Logger } from './logger';
import type { PrintJob, JobStatus, SliceStats, StatusUpdate } from './job';
import type { OctoPrintClient } from './octoprint';
import type { Slicer } from './slicer';
import type { QueueAdapter } from './n8nQueue';
import type { S3Client } from './s3';
import { parseS3Ref } from './s3';
import { guardedFetchBuffer } from './safefetch';

interface ResolvedModel {
	bytes: Buffer;
	isGcode: boolean;
	name: string;
	/** Removes the staged source (e.g. an ephemeral S3 object) once it's safely on OctoPrint. */
	cleanup?: () => Promise<void>;
}

/** Runs one print job through resolve -> slice -> upload -> print -> monitor, reporting status. */
export class PrintPipeline {
	constructor(
		private cfg: Config,
		private log: Logger,
		private octo: OctoPrintClient,
		private slicer: Slicer,
		private queue: QueueAdapter,
		private s3?: S3Client,
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

	/** Fetch the model bytes from S3 (any compatible bucket) or an http(s) URL, or inline gcode. */
	private async resolveModel(job: PrintJob): Promise<ResolvedModel> {
		if (job.gcodeBase64) {
			return { bytes: Buffer.from(job.gcodeBase64, 'base64'), isGcode: true, name: job.name ?? `${job.id}.gcode` };
		}
		const source = job.sourceUrl ?? job.gcodeUrl ?? job.stlUrl;
		if (!source) throw new Error('job has no sourceUrl / stlUrl / gcodeUrl / gcodeBase64');

		const name = job.name ?? basename(source) ?? job.id;
		const isGcode = Boolean(job.gcodeUrl) || /\.gcode(\?|$)/i.test(source) || /\.gcode$/i.test(name);

		if (this.s3) {
			const ref = parseS3Ref(source, this.cfg.s3Bucket);
			if (ref) {
				this.log.info(`job ${job.id}: fetching "${ref.key}" from bucket ${this.cfg.s3Bucket}`);
				const bytes = await this.s3.getObject(ref.key);
				return { bytes, isGcode, name, cleanup: () => this.s3!.deleteObject(ref.key) };
			}
		}

		const bytes = await guardedFetchBuffer(source, { allowPrivate: this.cfg.allowPrivateFetch });
		return { bytes, isGcode, name };
	}

	async run(job: PrintJob): Promise<void> {
		this.log.info(`job ${job.id}: claimed`);
		await this.status(job.id, 'claimed', { message: `picked up by ${this.cfg.printerId}` });

		// 1. obtain the model, slicing if it isn't already gcode
		const model = await this.resolveModel(job);
		let gcode: Buffer;
		let filename: string;
		let stats: SliceStats | undefined;

		if (model.isGcode) {
			gcode = model.bytes;
			filename = model.name;
		} else {
			await this.status(job.id, 'slicing');
			this.log.info(`job ${job.id}: slicing ${model.name} (${model.bytes.length} bytes)`);
			const r = await this.slicer.slice(model.bytes, {
				filename: model.name,
				profile: job.profile ?? this.cfg.slicerProfile,
				material: job.material,
			});
			gcode = r.gcode;
			filename = r.filename;
			stats = r.stats;
			this.log.info(`job ${job.id}: sliced -> ${stats.filamentUsedGrams ?? '?'}g, ${stats.printTimeHours ?? '?'}h`);
		}

		if (!filename.toLowerCase().endsWith('.gcode')) filename += '.gcode';

		// 2. upload to OctoPrint
		await this.status(job.id, 'uploading', { stats });
		this.log.info(`job ${job.id}: uploading ${filename} (${gcode.length} bytes)`);
		const stored = await this.octo.upload(filename, gcode);

		// the source is now safely on OctoPrint — drop the ephemeral staged copy
		if (model.cleanup) {
			try {
				await model.cleanup();
				this.log.info(`job ${job.id}: removed staged source from the bucket`);
			} catch (err: any) {
				this.log.warn(`job ${job.id}: bucket cleanup failed: ${err.message}`);
			}
		}

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
		// scheme-less (e.g. an S3 key): take the last path segment
		const p = url.split('?')[0].split('/').pop();
		return p || null;
	}
}
