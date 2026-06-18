import { scryptSync, randomBytes, timingSafeEqual } from 'node:crypto';
import type { AuthUser, PasswordProvider } from './types';

/** scrypt password hash, encoded as `scrypt$<saltHex>$<hashHex>`. */
export function hashPassword(password: string): string {
	const salt = randomBytes(16);
	const dk = scryptSync(password, salt, 32);
	return `scrypt$${salt.toString('hex')}$${dk.toString('hex')}`;
}

export function verifyPassword(password: string, stored: string): boolean {
	const [scheme, saltHex, hashHex] = stored.split('$');
	if (scheme !== 'scrypt' || !saltHex || !hashHex) return false;
	const dk = scryptSync(password, Buffer.from(saltHex, 'hex'), 32);
	const expected = Buffer.from(hashHex, 'hex');
	return dk.length === expected.length && timingSafeEqual(dk, expected);
}

// Precomputed hash so verify() always runs scrypt, even for an unknown
// username — prevents user enumeration via response timing.
const DUMMY_HASH = hashPassword(randomBytes(16).toString('hex'));

/** The built-in username/password provider, backed by config. */
export class LocalProvider implements PasswordProvider {
	readonly id = 'local';
	readonly label = 'Username & password';
	readonly kind = 'password' as const;

	constructor(
		private username: string,
		private passwordHash: string,
	) {}

	async verify(username: string, password: string): Promise<AuthUser | null> {
		const matches = username === this.username;
		const ok = verifyPassword(password, matches ? this.passwordHash : DUMMY_HASH);
		return matches && ok ? { id: username, name: username, provider: 'local' } : null;
	}
}
