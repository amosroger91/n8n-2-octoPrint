import dotenv from 'dotenv';
dotenv.config();

import { loadConfig } from './config';
import { Logger } from './logger';
import { OctoPrintClient } from './octoprint/client';
import { OctoPrintSocket } from './octoprint/socket';
import { N8nForwarder } from './n8n/forwarder';
import { BridgeServer } from './server';
import {
	CurrentProcessor,
	applyCurrentToSnapshot,
	emptySnapshot,
	eventEnvelope,
	snapshotEnvelope,
	type Envelope,
	type Snapshot,
} from './events';

async function main(): Promise<void> {
	const cfg = loadConfig();
	const log = new Logger(cfg.logLevel);

	log.info(`octoprint2n8n starting (instance: ${cfg.instanceId})`);
	log.info(`OctoPrint: ${cfg.octoprintUrl}`);
	log.info(
		cfg.n8nWebhookUrl
			? `forwarding events to ${cfg.n8nWebhookUrl}`
			: 'event forwarding disabled (no N8N_WEBHOOK_URL)',
	);

	if (cfg.allowInsecureTls) {
		process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
		log.warn('TLS certificate verification disabled (OCTOPRINT_ALLOW_INSECURE_TLS=true)');
	}

	const rest = new OctoPrintClient(cfg);
	const forwarder = new N8nForwarder(cfg, log);
	const snapshot: Snapshot = emptySnapshot();
	const emit = (env: Envelope): void => forwarder.enqueue(env);
	const processor = new CurrentProcessor(cfg, emit);

	const socket = new OctoPrintSocket(cfg, log, rest, (type, payload) => {
		if (type === 'event' && payload && typeof payload.type === 'string') {
			const eventType = payload.type as string;
			log.debug(`octoprint event: ${eventType}`);
			snapshot.connected = true;
			snapshot.updatedAt = new Date().toISOString();
			emit(eventEnvelope(cfg, eventType, payload.payload, snapshot));
		} else if (type === 'current' || type === 'history') {
			applyCurrentToSnapshot(snapshot, payload);
			if (type === 'current') processor.handle(payload, snapshot);
		} else if (type === 'connected') {
			snapshot.connected = true;
			snapshot.octoprintVersion = payload?.version ?? snapshot.octoprintVersion;
			snapshot.updatedAt = new Date().toISOString();
			emit(eventEnvelope(cfg, 'Connected', payload, snapshot));
		}
	});
	socket.start();

	let pollTimer: ReturnType<typeof setInterval> | null = null;
	if (cfg.pollIntervalMs > 0) {
		const poll = async (): Promise<void> => {
			try {
				const [version, printer, job] = await Promise.all([
					rest.getVersion(),
					rest.getPrinter(),
					rest.getJob(),
				]);
				if (version.ok) {
					snapshot.octoprintVersion =
						version.data?.server ?? version.data?.text ?? snapshot.octoprintVersion;
				}
				if (printer.ok && printer.data?.state) {
					snapshot.state = printer.data.state.text ?? snapshot.state;
					snapshot.flags = printer.data.state.flags ?? snapshot.flags;
					const t = printer.data.temperature;
					if (t && typeof t === 'object') {
						const temps: Record<string, { actual: number | null; target: number | null }> = {};
						for (const key of Object.keys(t)) {
							const entry = t[key];
							if (entry && typeof entry === 'object' && 'actual' in entry) {
								temps[key] = { actual: entry.actual ?? null, target: entry.target ?? null };
							}
						}
						if (Object.keys(temps).length > 0) snapshot.temperatures = temps;
					}
				}
				if (job.ok && job.data) {
					snapshot.job = job.data.job ?? snapshot.job;
					snapshot.progress = job.data.progress ?? snapshot.progress;
				}
				snapshot.connected = version.ok || printer.ok || job.ok;
				snapshot.updatedAt = new Date().toISOString();
				emit(snapshotEnvelope(cfg, snapshot));
			} catch (err: any) {
				snapshot.connected = false;
				log.debug(`poll failed: ${err.message}`);
			}
		};
		pollTimer = setInterval(() => void poll(), cfg.pollIntervalMs);
		void poll();
	}

	const server = new BridgeServer(cfg, log, rest, () => snapshot);
	server.start();

	const shutdown = (signal: string): void => {
		log.info(`received ${signal}, shutting down`);
		socket.stop();
		server.stop();
		if (pollTimer) clearInterval(pollTimer);
		setTimeout(() => process.exit(0), 200);
	};
	process.on('SIGINT', () => shutdown('SIGINT'));
	process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((err: any) => {
	console.error(`fatal: ${err?.message ?? err}`);
	process.exit(1);
});
