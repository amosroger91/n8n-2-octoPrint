import dotenv from 'dotenv';
dotenv.config();

import { randomBytes } from 'node:crypto';
import { Queue, Worker } from 'bullmq';
import { QUEUE_NAME, redisConnection } from './queue';
import { loadConfig, type Config } from './config';
import { Logger } from './logger';
import { OctoPrintClient } from './octoprint';
import { HttpSlicer } from './slicer';
import { N8nQueue } from './n8nQueue';
import { Ledger, RecordingQueue } from './ledger';
import { PrintPipeline } from './worker';
import { QueuePoller } from './poller';
import { SessionManager } from './auth/session';
import { AuthRegistry } from './auth/registry';
import { LocalProvider, hashPassword } from './auth/local';
import { DashboardServer } from './dashboard/server';
import type { PrintJob } from './job';

/** Build the auth registry: the built-in local provider, plus any you add here. */
function buildAuth(cfg: Config, log: Logger): AuthRegistry {
	const secret = cfg.sessionSecret ?? randomBytes(32).toString('hex');
	if (!cfg.sessionSecret) log.warn('SESSION_SECRET not set — using an ephemeral one (logins reset on restart)');

	let password = cfg.dashboardPassword;
	if (!password) {
		password = randomBytes(9).toString('base64url');
		log.warn(`Dashboard login (generated): ${cfg.dashboardUsername} / ${password}   — set DASHBOARD_PASSWORD to keep it`);
	}

	const registry = new AuthRegistry(new SessionManager(secret));
	registry.register(new LocalProvider(cfg.dashboardUsername, hashPassword(password)));
	// Add an external provider by implementing OAuthProvider and registering it:
	//   registry.register(new GoogleOAuthProvider({ clientId, clientSecret }));
	return registry;
}

async function main(): Promise<void> {
	const cfg = loadConfig();
	const log = new Logger(cfg.logLevel);

	if (cfg.allowInsecureTls) {
		process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
		log.warn('OCTOPRINT_ALLOW_INSECURE_TLS=true disables TLS verification PROCESS-WIDE — prefer plain http for LAN OctoPrint.');
	}

	log.info(`print-orchestrator starting (printer: ${cfg.printerId})`);
	log.info(`OctoPrint: ${cfg.octoprintUrl}   Redis: ${cfg.redisUrl}`);
	log.info(cfg.slicerUrl ? `Slicer: ${cfg.slicerUrl} (profile ${cfg.slicerProfile})` : 'Slicer: not configured (pre-sliced gcode only)');

	const connection = redisConnection(cfg.redisUrl);
	const octo = new OctoPrintClient(cfg);
	const slicer = new HttpSlicer(cfg);
	const ledger = new Ledger();
	const queueAdapter = new RecordingQueue(new N8nQueue(cfg, log), ledger);
	const pipeline = new PrintPipeline(cfg, log, octo, slicer, queueAdapter);

	const version = await octo.getVersion().catch(() => ({ ok: false, version: null }));
	log.info(version.ok ? `OctoPrint reachable (v${version.version})` : 'WARNING: OctoPrint not reachable yet — will retry per job');

	const bull = new Queue(QUEUE_NAME, { connection });
	const worker = new Worker<PrintJob>(
		QUEUE_NAME,
		async (job) => {
			await pipeline.run(job.data);
		},
		{ connection, concurrency: cfg.concurrency },
	);
	worker.on('completed', (job) => log.info(`queue: job ${job.id} completed`));
	worker.on('failed', (job, err) => log.error(`queue: job ${job?.id} failed: ${err?.message}`));

	const poller = new QueuePoller(cfg, log, queueAdapter, bull);
	poller.start();

	let dashboard: DashboardServer | null = null;
	if (cfg.dashboardEnabled) {
		dashboard = new DashboardServer(cfg, log, buildAuth(cfg, log), octo, bull, ledger);
		dashboard.start();
	} else {
		log.info('dashboard disabled (DASHBOARD_ENABLED=false)');
	}

	log.info(`worker running (concurrency ${cfg.concurrency}) on queue "${QUEUE_NAME}"`);

	const shutdown = async (signal: string): Promise<void> => {
		log.info(`${signal} — shutting down`);
		poller.stop();
		dashboard?.stop();
		await worker.close();
		await bull.close();
		process.exit(0);
	};
	process.on('SIGINT', () => void shutdown('SIGINT'));
	process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((err: any) => {
	console.error(`fatal: ${err?.message ?? err}`);
	process.exit(1);
});
