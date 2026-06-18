import { hostname } from 'node:os';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface Config {
	octoprintUrl: string;
	octoprintApiKey: string;
	allowInsecureTls: boolean;

	n8nWebhookUrl: string | null;

	sharedSecret: string | null;
	bridgePort: number;
	bridgeBind: string;
	instanceId: string;

	socketThrottle: number;
	pollIntervalMs: number;
	progressDeltaPct: number;
	progressMinIntervalMs: number;
	includeRaw: boolean;
	queueMax: number;

	logLevel: LogLevel;
}

function str(name: string, fallback = ''): string {
	const v = process.env[name];
	return v === undefined || v === '' ? fallback : v;
}

function bool(name: string, fallback = false): boolean {
	const v = process.env[name];
	if (v === undefined || v === '') return fallback;
	return /^(1|true|yes|on)$/i.test(v.trim());
}

function int(name: string, fallback: number): number {
	const v = process.env[name];
	if (v === undefined || v === '') return fallback;
	const n = Number.parseInt(v, 10);
	return Number.isFinite(n) ? n : fallback;
}

function num(name: string, fallback: number): number {
	const v = process.env[name];
	if (v === undefined || v === '') return fallback;
	const n = Number.parseFloat(v);
	return Number.isFinite(n) ? n : fallback;
}

export function loadConfig(): Config {
	const octoprintUrl = str('OCTOPRINT_URL').replace(/\/+$/, '');
	const octoprintApiKey = str('OCTOPRINT_API_KEY');

	const missing: string[] = [];
	if (!octoprintUrl) missing.push('OCTOPRINT_URL');
	if (!octoprintApiKey) missing.push('OCTOPRINT_API_KEY');
	if (missing.length > 0) {
		throw new Error(`Missing required configuration: ${missing.join(', ')}`);
	}

	const level = str('LOG_LEVEL', 'info').toLowerCase();
	const logLevel: LogLevel = (['debug', 'info', 'warn', 'error'].includes(level)
		? level
		: 'info') as LogLevel;

	return {
		octoprintUrl,
		octoprintApiKey,
		allowInsecureTls: bool('OCTOPRINT_ALLOW_INSECURE_TLS', false),

		n8nWebhookUrl: str('N8N_WEBHOOK_URL') || null,

		sharedSecret: str('BRIDGE_SHARED_SECRET') || null,
		bridgePort: int('BRIDGE_PORT', 5252),
		bridgeBind: str('BRIDGE_BIND', '0.0.0.0'),
		instanceId: str('INSTANCE_ID') || hostname(),

		socketThrottle: int('SOCKET_THROTTLE', 2),
		pollIntervalMs: int('POLL_INTERVAL_MS', 30000),
		progressDeltaPct: num('PROGRESS_DELTA_PCT', 1),
		progressMinIntervalMs: int('PROGRESS_MIN_INTERVAL_MS', 30000),
		includeRaw: bool('INCLUDE_RAW', false),
		queueMax: int('QUEUE_MAX', 500),

		logLevel,
	};
}
