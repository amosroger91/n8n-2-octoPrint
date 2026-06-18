/** A print job as it flows through the orchestrator. */
export interface PrintJob {
	/** Stable id (the print-queue row id). Used as the BullMQ job id for dedup. */
	id: string;
	/** URL to the STL/3MF to slice. */
	stlUrl?: string;
	/** Pre-sliced gcode by URL — skips slicing. */
	gcodeUrl?: string;
	/** Pre-sliced gcode inline (base64) — skips slicing. Handy for testing. */
	gcodeBase64?: string;
	/** A friendly name for the file uploaded to OctoPrint. */
	name?: string;
	/** Slicer profile override (defaults to SLICER_PROFILE). */
	profile?: string;
	material?: string;
	color?: string;
	/** Anything else from the queue row, passed through to status updates. */
	meta?: Record<string, unknown>;
}

export type JobStatus =
	| 'claimed'
	| 'slicing'
	| 'uploading'
	| 'printing'
	| 'done'
	| 'failed'
	| 'cancelled';

export interface SliceStats {
	filamentUsedCm3?: number;
	filamentUsedGrams?: number;
	printTimeHours?: number;
}

export interface StatusUpdate {
	id: string;
	printerId: string;
	status: JobStatus;
	/** 0-100 while printing. */
	progress?: number;
	message?: string;
	stats?: SliceStats;
	error?: string;
	at: string;
}
