/** An authenticated user, however they signed in. */
export interface AuthUser {
	id: string;
	name: string;
	provider: string;
}

/** A username/password provider (the built-in local one, LDAP, etc.). */
export interface PasswordProvider {
	id: string;
	label: string;
	kind: 'password';
	verify(username: string, password: string): Promise<AuthUser | null>;
}

/**
 * A redirect-based provider (Google, GitHub, generic OIDC, …).
 * Implement these two methods and register it — the login page and the
 * /auth/<id> + /auth/<id>/callback routes pick it up automatically.
 */
export interface OAuthProvider {
	id: string;
	label: string;
	kind: 'oauth';
	/** Where to send the browser to start sign-in. */
	authorizeUrl(state: string, redirectUri: string): string;
	/** Exchange the callback query params for a user (or null on failure). */
	handleCallback(params: URLSearchParams, redirectUri: string): Promise<AuthUser | null>;
}

export type AuthProvider = PasswordProvider | OAuthProvider;
