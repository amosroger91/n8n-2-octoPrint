import { EventEmitter } from 'node:events';

export type StateText = 'Operational' | 'Printing' | 'Paused' | 'Cancelling' | 'Offline';

export interface GcodeFile {
	name: string;
	path: string;
	origin: string;
	size: number;
	date: number;
	estimatedPrintTime: number;
}

export interface OctoEvent {
	type: string;
	payload: Record<string, unknown>;
}

const AMBIENT = 25;
const HEAT_STEP_PER_SEC = 8; // °C/s moved toward the target

function round1(n: number): number {
	return Math.round(n * 10) / 10;
}

/**
 * A tiny simulation of a 3D printer + the slice of OctoPrint state the bridge
 * cares about. Emits `octoEvent` ({type, payload}) on print lifecycle changes.
 */
export class VirtualPrinter extends EventEmitter {
	connected = true;
	state: StateText = 'Operational';
	toolActual = AMBIENT;
	toolTarget = 0;
	bedActual = AMBIENT;
	bedTarget = 0;
	completion = 0;
	printTimeSec = 0;
	selected: GcodeFile | null;

	private readonly files: GcodeFile[];
	private readonly printDurationSec: number;

	constructor(printDurationSec: number) {
		super();
		this.printDurationSec = printDurationSec;
		const now = Math.round(Date.now() / 1000);
		this.files = [
			{ name: 'benchy.gcode', path: 'benchy.gcode', origin: 'local', size: 712345, date: now, estimatedPrintTime: printDurationSec },
			{ name: 'calibration_cube.gcode', path: 'calibration_cube.gcode', origin: 'local', size: 88210, date: now, estimatedPrintTime: printDurationSec },
		];
		this.selected = this.files[0];
	}

	private emitEvent(type: string, payload: Record<string, unknown> = {}): void {
		this.emit('octoEvent', { type, payload } as OctoEvent);
	}

	private filePayload(file: GcodeFile | null): Record<string, unknown> {
		if (!file) return { name: null, path: null, origin: null, size: null };
		return { name: file.name, path: file.path, origin: file.origin, size: file.size };
	}

	listFiles(): Record<string, unknown> {
		return { files: this.files, free: 1_000_000_000, total: 8_000_000_000 };
	}

	select(path: string, print: boolean): boolean {
		const file = this.files.find((f) => f.path === path);
		if (!file) return false;
		this.selected = file;
		this.emitEvent('FileSelected', this.filePayload(file));
		if (print) this.start();
		return true;
	}

	start(): boolean {
		if (!this.selected) return false;
		this.state = 'Printing';
		this.completion = 0;
		this.printTimeSec = 0;
		this.toolTarget = 205;
		this.bedTarget = 60;
		this.emitEvent('PrintStarted', this.filePayload(this.selected));
		return true;
	}

	cancel(): void {
		if (this.state !== 'Printing' && this.state !== 'Paused') return;
		this.state = 'Operational';
		this.toolTarget = 0;
		this.bedTarget = 0;
		this.emitEvent('PrintCancelled', this.filePayload(this.selected));
		this.completion = 0;
		this.printTimeSec = 0;
	}

	pause(action: string): void {
		const want = action === 'toggle' ? (this.state === 'Paused' ? 'resume' : 'pause') : action;
		if (want === 'pause' && this.state === 'Printing') {
			this.state = 'Paused';
			this.emitEvent('PrintPaused', this.filePayload(this.selected));
		} else if (want === 'resume' && this.state === 'Paused') {
			this.state = 'Printing';
			this.emitEvent('PrintResumed', this.filePayload(this.selected));
		}
	}

	setTool(target: number): void {
		this.toolTarget = target;
	}
	setBed(target: number): void {
		this.bedTarget = target;
	}

	setConnected(connected: boolean): void {
		this.connected = connected;
		this.state = connected ? 'Operational' : 'Offline';
		this.emitEvent(connected ? 'Connected' : 'Disconnected', {});
	}

	private seek(actual: number, target: number, dtSec: number): number {
		const goal = target > 0 ? target : AMBIENT;
		const step = HEAT_STEP_PER_SEC * dtSec;
		if (Math.abs(goal - actual) <= step) return goal;
		return actual + Math.sign(goal - actual) * step;
	}

	tick(dtMs: number): void {
		const dtSec = dtMs / 1000;
		this.toolActual = round1(this.seek(this.toolActual, this.toolTarget, dtSec));
		this.bedActual = round1(this.seek(this.bedActual, this.bedTarget, dtSec));

		if (this.state === 'Printing') {
			this.printTimeSec += dtSec;
			this.completion = Math.min(100, (this.printTimeSec / this.printDurationSec) * 100);
			if (this.completion >= 100) {
				this.completion = 100;
				this.state = 'Operational';
				this.toolTarget = 0;
				this.bedTarget = 0;
				this.emitEvent('PrintDone', {
					...this.filePayload(this.selected),
					time: Math.round(this.printTimeSec),
				});
			}
		}
	}

	private flags(): Record<string, boolean> {
		return {
			operational: this.connected && this.state !== 'Offline',
			printing: this.state === 'Printing',
			paused: this.state === 'Paused',
			cancelling: this.state === 'Cancelling',
			pausing: false,
			sdReady: false,
			error: false,
			ready: this.state === 'Operational',
			closedOrError: !this.connected,
		};
	}

	private progress(): Record<string, unknown> {
		const left = Math.max(0, this.printDurationSec - this.printTimeSec);
		return {
			completion: round1(this.completion),
			filepos: Math.round((this.completion / 100) * (this.selected?.size ?? 0)),
			printTime: Math.round(this.printTimeSec),
			printTimeLeft: this.state === 'Printing' ? Math.round(left) : null,
		};
	}

	printerState(): Record<string, unknown> {
		return {
			temperature: {
				tool0: { actual: this.toolActual, target: this.toolTarget, offset: 0 },
				bed: { actual: this.bedActual, target: this.bedTarget, offset: 0 },
			},
			state: { text: this.state, flags: this.flags() },
			sd: { ready: false },
		};
	}

	jobState(): Record<string, unknown> {
		return {
			job: { file: this.filePayload(this.selected), estimatedPrintTime: this.printDurationSec, filament: null },
			progress: this.progress(),
			state: this.state,
		};
	}

	current(): Record<string, unknown> {
		return {
			state: { text: this.state, flags: this.flags() },
			job: { file: this.filePayload(this.selected), estimatedPrintTime: this.printDurationSec, filament: null },
			progress: this.progress(),
			currentZ: null,
			offsets: {},
			temps: [
				{
					time: Math.round(Date.now() / 1000),
					tool0: { actual: this.toolActual, target: this.toolTarget },
					bed: { actual: this.bedActual, target: this.bedTarget },
				},
			],
			logs: [],
			messages: [],
		};
	}
}
