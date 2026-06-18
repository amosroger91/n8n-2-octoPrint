import { createHmac, timingSafeEqual } from 'node:crypto';
import type { AuthUser } from './types';

/** Issues + verifies compact HMAC-signed session tokens (no DB, no JWT lib). */
export class SessionManager {
	constructor(
		private secret: string,
		private ttlMs = 7 * 24 * 3600 * 1000,
	) {}

	issue(user: AuthUser): string {
		const body = Buffer.from(JSON.stringify({ u: user, iat: Date.now() })).toString('base64url');
		return `${body}.${this.sign(body)}`;
	}

	verify(token: string | undefined): AuthUser | null {
		if (!token) return null;
		const dot = token.lastIndexOf('.');
		if (dot < 0) return null;
		const body = token.slice(0, dot);
		const sig = token.slice(dot + 1);
		if (!constEq(sig, this.sign(body))) return null;
		try {
			const p = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
			if (typeof p?.iat !== 'number' || Date.now() - p.iat > this.ttlMs) return null;
			return p.u as AuthUser;
		} catch {
			return null;
		}
	}

	private sign(body: string): string {
		return createHmac('sha256', this.secret).update(body).digest('base64url');
	}
}

function constEq(a: string, b: string): boolean {
	const ab = Buffer.from(a);
	const bb = Buffer.from(b);
	return ab.length === bb.length && timingSafeEqual(ab, bb);
}

export function parseCookies(header: string | undefined): Record<string, string> {
	const out: Record<string, string> = {};
	if (!header) return out;
	for (const part of header.split(';')) {
		const i = part.indexOf('=');
		if (i < 0) continue;
		const k = part.slice(0, i).trim();
		if (k) out[k] = decodeURIComponent(part.slice(i + 1).trim());
	}
	return out;
}

export function serializeCookie(
	name: string,
	value: string,
	opts: { maxAgeSec?: number; httpOnly?: boolean; path?: string; sameSite?: 'Lax' | 'Strict' | 'None' } = {},
): string {
	const parts = [`${name}=${encodeURIComponent(value)}`, `Path=${opts.path ?? '/'}`];
	if (opts.maxAgeSec != null) parts.push(`Max-Age=${opts.maxAgeSec}`);
	if (opts.httpOnly !== false) parts.push('HttpOnly');
	parts.push(`SameSite=${opts.sameSite ?? 'Lax'}`);
	return parts.join('; ');
}
