import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

export interface FetchGuard {
	allowPrivate: boolean;
}

const BLOCKED_HOSTNAMES = new Set(['metadata.google.internal', 'metadata']);
const METADATA_IPS = new Set(['169.254.169.254', 'fd00:ec2::254']);

/**
 * Validate a URL before the orchestrator fetches it (STL / gcode / slicer
 * output). Limits SSRF: http(s) only, never cloud-metadata, and — unless
 * `allowPrivate` — never private/loopback addresses. Print farms are usually on
 * a LAN so `allowPrivate` defaults to true; set `ALLOW_PRIVATE_FETCH=false` to
 * lock fetches down to public hosts.
 */
export async function assertFetchAllowed(rawUrl: string, guard: FetchGuard): Promise<void> {
	let url: URL;
	try {
		url = new URL(rawUrl);
	} catch {
		throw new Error('invalid URL');
	}
	if (url.protocol !== 'http:' && url.protocol !== 'https:') {
		throw new Error(`blocked URL scheme "${url.protocol}" (only http/https)`);
	}

	const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
	if (BLOCKED_HOSTNAMES.has(host)) throw new Error(`blocked host "${host}"`);

	const addresses = isIP(host) ? [host] : (await lookup(host, { all: true })).map((a) => a.address);
	for (const ip of addresses) {
		if (METADATA_IPS.has(ip)) throw new Error(`blocked cloud-metadata address ${ip}`);
		if (!guard.allowPrivate && isPrivateAddress(ip)) {
			throw new Error(`blocked private address ${ip} (set ALLOW_PRIVATE_FETCH=true to allow)`);
		}
	}
}

/** Fetch a URL into a Buffer after running the SSRF guard. */
export async function guardedFetchBuffer(rawUrl: string, guard: FetchGuard): Promise<Buffer> {
	await assertFetchAllowed(rawUrl, guard);
	const res = await fetch(rawUrl, { redirect: 'error' });
	if (!res.ok) throw new Error(`fetch ${rawUrl} failed: HTTP ${res.status}`);
	return Buffer.from(await res.arrayBuffer());
}

export function isPrivateAddress(ip: string): boolean {
	const v4 = /^(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(ip);
	if (v4) {
		const a = Number(v4[1]);
		const b = Number(v4[2]);
		return (
			a === 0 ||
			a === 10 ||
			a === 127 ||
			(a === 172 && b >= 16 && b <= 31) ||
			(a === 192 && b === 168) ||
			(a === 169 && b === 254)
		);
	}
	const low = ip.toLowerCase();
	return (
		low === '::1' ||
		low === '::' ||
		low.startsWith('fc') ||
		low.startsWith('fd') ||
		low.startsWith('fe80') ||
		low.startsWith('::ffff:127.') ||
		low.startsWith('::ffff:10.') ||
		low.startsWith('::ffff:192.168.')
	);
}
