import type { LogLevel } from './config';

const ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

export class Logger {
	constructor(private level: LogLevel = 'info') {}

	private log(level: LogLevel, msg: string): void {
		if (ORDER[level] < ORDER[this.level]) return;
		const line = `${new Date().toISOString()} [${level.toUpperCase()}] ${msg}`;
		if (level === 'error') console.error(line);
		else if (level === 'warn') console.warn(line);
		else console.log(line);
	}

	debug(m: string): void {
		this.log('debug', m);
	}
	info(m: string): void {
		this.log('info', m);
	}
	warn(m: string): void {
		this.log('warn', m);
	}
	error(m: string): void {
		this.log('error', m);
	}
}
