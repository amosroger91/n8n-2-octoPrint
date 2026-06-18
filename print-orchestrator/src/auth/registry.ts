import type { AuthProvider, OAuthProvider, PasswordProvider } from './types';
import type { SessionManager } from './session';

/**
 * Holds the configured auth providers + the session manager. Register more
 * providers (OAuth/OIDC/LDAP) here and the dashboard wires them up.
 */
export class AuthRegistry {
	private providers: AuthProvider[] = [];

	constructor(readonly sessions: SessionManager) {}

	register(provider: AuthProvider): this {
		this.providers.push(provider);
		return this;
	}

	get(id: string): AuthProvider | undefined {
		return this.providers.find((p) => p.id === id);
	}

	all(): AuthProvider[] {
		return [...this.providers];
	}

	password(): PasswordProvider[] {
		return this.providers.filter((p): p is PasswordProvider => p.kind === 'password');
	}

	oauth(): OAuthProvider[] {
		return this.providers.filter((p): p is OAuthProvider => p.kind === 'oauth');
	}
}
