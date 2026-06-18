import { hostname } from 'node:os';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface Config {
	redisUrl: string;

	octoprintUrl: string;
	octoprintApiKey: string;
	allowInsecureTls: boolean;
	printerId: string;

	slicerUrl: string | null;
	slicerUsername: string | null;
	slicerPassword: string | null;
	slicerProfile: string;

	n8nQueueUrl: string | null;
	n8nStatusUrl: string | null;
	n8nAuthHeader: string | null;
	n8nPollIntervalMs: number;

	concurrency: number;
	printPollIntervalMs: number;
	printTimeoutMs: number;

	dashboardEnabled: boolean;
	dashboardPort: number;
	dashboardUsername: string;
	dashboardPassword: string | null;
	sessionSecret: string | null;

	logLevel: LogLevel;
}

function str(name: string, fallback = ''): string {
	const v = process.env[name];
	return v === undefined || v === '' ? fallback : v;
}
function bool(name: string, fallback = false): boolean {
	const v = process.env[name];
	if (!v) return fallback;
	return /^(1|true|yes|on)$/i.test(v.trim());
}
function int(name: string, fallback: number): number {
	const v = process.env[name];
	if (!v) return fallback;
	const n = Number.parseInt(v, 10);
	return Number.isFinite(n) ? n : fallback;
}

export function loadConfig(): Config {
	const octoprintUrl = str('OCTOPRINT_URL').replace(/\/+$/, '');
	const octoprintApiKey = str('OCTOPRINT_API_KEY');

	const missing: string[] = [];
	if (!octoprintUrl) missing.push('OCTOPRINT_URL');
	if (!octoprintApiKey) missing.push('OCTOPRINT_API_KEY');
	if (missing.length) throw new Error(`Missing required configuration: ${missing.join(', ')}`);

	const level = str('LOG_LEVEL', 'info').toLowerCase();
	const logLevel: LogLevel = (['debug', 'info', 'warn', 'error'].includes(level) ? level : 'info') as LogLevel;

	return {
		redisUrl: str('REDIS_URL', 'redis://127.0.0.1:6379'),

		octoprintUrl,
		octoprintApiKey,
		allowInsecureTls: bool('OCTOPRINT_ALLOW_INSECURE_TLS'),
		printerId: str('PRINTER_ID') || hostname(),

		slicerUrl: str('SLICER_URL') || null,
		slicerUsername: str('SLICER_USERNAME') || null,
		slicerPassword: str('SLICER_PASSWORD') || null,
		slicerProfile: str('SLICER_PROFILE', 'ender3v3se'),

		n8nQueueUrl: str('N8N_QUEUE_URL') || null,
		n8nStatusUrl: str('N8N_STATUS_URL') || null,
		n8nAuthHeader: str('N8N_AUTH_HEADER') || null,
		n8nPollIntervalMs: int('N8N_POLL_INTERVAL_MS', 10000),

		concurrency: int('CONCURRENCY', 1),
		printPollIntervalMs: int('PRINT_POLL_INTERVAL_MS', 5000),
		printTimeoutMs: int('PRINT_TIMEOUT_MS', 86_400_000),

		dashboardEnabled: bool('DASHBOARD_ENABLED', true),
		dashboardPort: int('DASHBOARD_PORT', 4848),
		dashboardUsername: str('DASHBOARD_USERNAME', 'admin'),
		dashboardPassword: str('DASHBOARD_PASSWORD') || null,
		sessionSecret: str('SESSION_SECRET') || null,

		logLevel,
	};
}
