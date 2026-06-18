// Exercises the dashboard auth + status endpoints against the virtual printer.
process.env.REDIS_URL = 'redis://127.0.0.1:6380';
process.env.OCTOPRINT_URL = 'http://localhost:5005';
process.env.OCTOPRINT_API_KEY = 'DEMOKEY00000000000000000000000000';
process.env.DASHBOARD_USERNAME = 'admin';
process.env.DASHBOARD_PASSWORD = 'test-pass-123';
process.env.SESSION_SECRET = 'test-session-secret';
process.env.DASHBOARD_PORT = '4849';
process.env.N8N_QUEUE_URL = '';
process.env.N8N_STATUS_URL = '';
process.env.SLICER_URL = '';
process.env.LOG_LEVEL = 'warn';

const { loadConfig } = await import('./dist/config.js');
const { Logger } = await import('./dist/logger.js');
const { OctoPrintClient } = await import('./dist/octoprint.js');
const { Ledger } = await import('./dist/ledger.js');
const { SessionManager } = await import('./dist/auth/session.js');
const { AuthRegistry } = await import('./dist/auth/registry.js');
const { LocalProvider, hashPassword } = await import('./dist/auth/local.js');
const { DashboardServer } = await import('./dist/dashboard/server.js');
const { QUEUE_NAME, redisConnection } = await import('./dist/queue.js');
const { Queue } = await import('bullmq');

const cfg = loadConfig();
const log = new Logger('warn');
const octo = new OctoPrintClient(cfg);
const ledger = new Ledger();
ledger.record({ id: 'demo-1', printerId: 'test', status: 'printing', progress: 42, at: new Date().toISOString() });

const bull = new Queue(QUEUE_NAME, { connection: redisConnection(cfg.redisUrl) });
const auth = new AuthRegistry(new SessionManager('test-session-secret'));
auth.register(new LocalProvider('admin', hashPassword('test-pass-123')));

const dash = new DashboardServer(cfg, log, auth, octo, bull, ledger);
dash.start();
await new Promise((r) => setTimeout(r, 500));

const base = 'http://127.0.0.1:4849';
const form = (b) => ({ method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: b, redirect: 'manual' });

const lp = await fetch(base + '/login');
console.log('GET  /login            ->', lp.status);
const noauth = await fetch(base + '/api/status');
console.log('GET  /api/status noauth->', noauth.status);
const bad = await fetch(base + '/login', form('username=admin&password=wrong'));
console.log('POST /login wrong      ->', bad.status, bad.headers.get('location'));
const ok = await fetch(base + '/login', form('username=admin&password=test-pass-123'));
const cookie = (ok.headers.get('set-cookie') || '').split(';')[0];
console.log('POST /login right      ->', ok.status, '->', ok.headers.get('location'), '| cookie:', cookie ? cookie.slice(0, 18) + '…' : 'none');
const authed = await fetch(base + '/api/status', { headers: { Cookie: cookie } });
const status = authed.ok ? await authed.json() : null;
console.log('GET  /api/status auth  ->', authed.status, status ? `printer=${status.printer.state} reachable=${status.printer.reachable} jobs=${status.jobs.length}` : '');
const dashp = await fetch(base + '/', { headers: { Cookie: cookie } });
console.log('GET  / (auth)          ->', dashp.status);

const pass =
	lp.status === 200 &&
	noauth.status === 401 &&
	(bad.headers.get('location') || '').includes('error') &&
	ok.status === 302 &&
	Boolean(cookie) &&
	authed.status === 200 &&
	(status?.jobs?.length ?? 0) >= 1 &&
	dashp.status === 200;
console.log(pass ? '\n✅ DASHBOARD PASS' : '\n❌ DASHBOARD FAIL');

dash.stop();
await bull.close();
process.exit(pass ? 0 : 1);
