import type { ConnectionOptions } from 'bullmq';

export const QUEUE_NAME = 'prints';

/** Parse a redis:// URL into a BullMQ connection-options object (BullMQ manages its own ioredis). */
export function redisConnection(url: string): ConnectionOptions {
	const u = new URL(url);
	const opts: Record<string, unknown> = {
		host: u.hostname || '127.0.0.1',
		port: Number(u.port || 6379),
	};
	if (u.password) opts.password = decodeURIComponent(u.password);
	if (u.username) opts.username = decodeURIComponent(u.username);
	if (u.pathname && u.pathname.length > 1) opts.db = Number(u.pathname.slice(1));
	if (u.protocol === 'rediss:') opts.tls = {};
	return opts as ConnectionOptions;
}
