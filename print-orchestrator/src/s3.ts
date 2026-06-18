import { createHash, createHmac } from 'node:crypto';

export interface S3Config {
	endpoint: string; // e.g. https://s3.example.com  or  http://minio:9000
	region: string; // e.g. us-east-1
	accessKeyId: string;
	secretAccessKey: string;
	bucket: string;
	forcePathStyle: boolean; // true for MinIO / most self-hosted
}

/** Reference to an object in the configured bucket. */
export interface S3Ref {
	key: string;
}

/**
 * Minimal, dependency-free S3 client (AWS SigV4) supporting GET + DELETE on any
 * S3-compatible endpoint (MinIO, AWS S3, Cloudflare R2, Backblaze B2, Garage…).
 * The orchestrator downloads a staged model then deletes it — that's all it needs.
 */
export class S3Client {
	constructor(private cfg: S3Config) {}

	/** Download an object's bytes. */
	async getObject(key: string): Promise<Buffer> {
		const res = await this.signedFetch('GET', key);
		if (!res.ok) throw new Error(`S3 GET ${key} failed: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
		return Buffer.from(await res.arrayBuffer());
	}

	/** Delete an object (idempotent — S3 returns 204 even if absent). */
	async deleteObject(key: string): Promise<void> {
		const res = await this.signedFetch('DELETE', key);
		if (!res.ok && res.status !== 404) {
			throw new Error(`S3 DELETE ${key} failed: HTTP ${res.status}`);
		}
	}

	private objectUrl(key: string): URL {
		const base = this.cfg.endpoint.replace(/\/+$/, '');
		const encodedKey = key.split('/').map(uriEncode).join('/');
		if (this.cfg.forcePathStyle) {
			return new URL(`${base}/${uriEncode(this.cfg.bucket)}/${encodedKey}`);
		}
		const u = new URL(base);
		u.host = `${this.cfg.bucket}.${u.host}`;
		u.pathname = `/${encodedKey}`;
		return u;
	}

	private signedFetch(method: 'GET' | 'DELETE', key: string): Promise<Response> {
		const url = this.objectUrl(key);
		const headers = sign(method, url, this.cfg);
		return fetch(url, { method, headers, redirect: 'error' });
	}
}

/** Parse a job's source into an S3 ref, or null if it's a plain URL. */
export function parseS3Ref(source: string, bucket: string): S3Ref | null {
	if (/^s3:\/\//i.test(source)) {
		const without = source.replace(/^s3:\/\//i, '');
		const slash = without.indexOf('/');
		if (slash < 0) return null;
		return { key: without.slice(slash + 1) };
	}
	// A scheme-less value is treated as a key in the configured bucket.
	if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(source)) {
		return { key: source.replace(/^\/+/, '') };
	}
	return null; // http(s):// etc. — fetched normally
}

// --- AWS Signature V4 (S3) ------------------------------------------------
const EMPTY_HASH = createHash('sha256').update('').digest('hex');

function sign(method: string, url: URL, cfg: S3Config): Record<string, string> {
	const amzDate = new Date().toISOString().replace(/[:-]/g, '').replace(/\.\d{3}/, '');
	const dateStamp = amzDate.slice(0, 8);
	const host = url.host;
	const canonicalHeaders = `host:${host}\nx-amz-content-sha256:${EMPTY_HASH}\nx-amz-date:${amzDate}\n`;
	const signedHeaders = 'host;x-amz-content-sha256;x-amz-date';
	const canonicalRequest = [
		method,
		url.pathname,
		canonicalQuery(url),
		canonicalHeaders,
		signedHeaders,
		EMPTY_HASH,
	].join('\n');

	const scope = `${dateStamp}/${cfg.region}/s3/aws4_request`;
	const stringToSign = [
		'AWS4-HMAC-SHA256',
		amzDate,
		scope,
		createHash('sha256').update(canonicalRequest).digest('hex'),
	].join('\n');

	const kDate = hmac(`AWS4${cfg.secretAccessKey}`, dateStamp);
	const kRegion = hmac(kDate, cfg.region);
	const kService = hmac(kRegion, 's3');
	const kSigning = hmac(kService, 'aws4_request');
	const signature = createHmac('sha256', kSigning).update(stringToSign).digest('hex');

	return {
		Authorization: `AWS4-HMAC-SHA256 Credential=${cfg.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
		'x-amz-date': amzDate,
		'x-amz-content-sha256': EMPTY_HASH,
	};
}

function canonicalQuery(url: URL): string {
	const params = [...url.searchParams.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
	return params.map(([k, v]) => `${uriEncode(k)}=${uriEncode(v)}`).join('&');
}

function hmac(key: string | Buffer, data: string): Buffer {
	return createHmac('sha256', key).update(data).digest();
}

function uriEncode(s: string): string {
	return encodeURIComponent(s).replace(/[!*'()]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase());
}
