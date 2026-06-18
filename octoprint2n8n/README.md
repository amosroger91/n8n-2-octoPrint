# octoprint2n8n

The **client / bridge** for [n8n-2-octoPrint](https://github.com/amosroger91/n8n-2-octoPrint).

A small Node.js service that sits next to your printer, points at an OctoPrint
instance, and:

- **streams events up to n8n** — subscribes to OctoPrint's SockJS push feed and
  polls its REST API, normalizes everything into one event shape, and POSTs it
  (HMAC-signed) to your *OctoPrint Trigger* node's webhook;
- **relays commands down to OctoPrint** — exposes a small `Bearer`-authenticated
  HTTP API that the *OctoPrint* action node calls, proxying an allow-listed set
  of OctoPrint REST endpoints. Your OctoPrint API key never leaves the bridge.

## Run it

### Docker (recommended)

From the repo root:

```bash
cp octoprint2n8n/.env.example octoprint2n8n/.env   # then edit it
docker compose up -d --build
```

If OctoPrint is only reachable on the Docker host's LAN, set `network_mode: host`
in `docker-compose.yml` (and drop the `ports:` mapping).

### Node (no Docker)

```bash
cd octoprint2n8n
npm install
npm run build
cp .env.example .env   # edit it
npm start
```

Requires Node 20+.

## Configuration

| Variable | Required | Default | Description |
| --- | --- | --- | --- |
| `OCTOPRINT_URL` | ✅ | — | Base URL of OctoPrint (no trailing `/api`) |
| `OCTOPRINT_API_KEY` | ✅ | — | OctoPrint API key |
| `OCTOPRINT_ALLOW_INSECURE_TLS` | | `false` | Accept a self-signed cert on OctoPrint |
| `N8N_WEBHOOK_URL` | | — | Trigger node's Production webhook URL; blank disables forwarding |
| `BRIDGE_SHARED_SECRET` | | — | Bearer secret for commands + HMAC key for events; blank disables the command API and sends events unsigned |
| `BRIDGE_PORT` | | `5252` | Port for the bridge HTTP API |
| `BRIDGE_BIND` | | `0.0.0.0` | Bind address |
| `INSTANCE_ID` | | hostname | Identifier stamped on every event |
| `SOCKET_THROTTLE` | | `2` | OctoPrint `current` throttle (×500 ms) |
| `POLL_INTERVAL_MS` | | `30000` | Snapshot poll interval; `0` disables polling |
| `PROGRESS_DELTA_PCT` | | `1` | Emit Progress when completion moves this many % |
| `PROGRESS_MIN_INTERVAL_MS` | | `30000` | …or at least this often while printing |
| `INCLUDE_RAW` | | `false` | Attach the raw OctoPrint payload to events |
| `LOG_LEVEL` | | `info` | `debug` / `info` / `warn` / `error` |

## HTTP API

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| `GET` | `/api/v1/health` | none | Liveness + OctoPrint connectivity (used by the Docker healthcheck and the n8n credential test) |
| `GET` | `/api/v1/state` | Bearer | Last known printer snapshot |
| `ANY` | `/api/v1/proxy/<octoprint-path>` | Bearer | Allow-listed proxy to `/<octoprint-path>` on OctoPrint |

Allow-listed proxy roots: `version`, `server`, `connection`, `printer`, `job`,
`files`, `printerprofiles`, `settings`, `system`.

## Event schema

Every event forwarded to n8n is one JSON object:

```jsonc
{
  "source": "octoprint2n8n",
  "instanceId": "octopi-shop",
  "event": "PrintDone",          // OctoPrint event type, or a synthetic one
  "timestamp": "2026-06-17T12:00:00.000Z",
  "nonce": "a1b2c3d4e5f6a7b8",
  "printer": { "state": "Operational", "flags": { "operational": true, "printing": false } },
  "job":     { "file": { "name": "benchy.gcode", "origin": "local", "size": 712345 }, "estimatedPrintTime": 3600 },
  "progress": { "completion": 100, "printTime": 3550, "printTimeLeft": 0 },
  "temperatures": { "tool0": { "actual": 205.1, "target": 0 }, "bed": { "actual": 58.0, "target": 0 } },
  "payload": { /* the raw OctoPrint event payload, when applicable */ }
}
```

**Event types**

- Passed through from OctoPrint: `PrintStarted`, `PrintDone`, `PrintFailed`,
  `PrintPaused`, `PrintResumed`, `PrintCancelled`, `Error`, `Connected`,
  `Disconnected`, `FileSelected`, and any other OctoPrint event.
- Synthetic (derived by the bridge): `StateChange`, `Progress`, `Snapshot`.

**Signature** — when `BRIDGE_SHARED_SECRET` is set, each request carries:

```
X-Octoprint-Timestamp: 2026-06-17T12:00:00.000Z
X-Octoprint-Signature: v1=<hex HMAC-SHA256 of "v1:<timestamp>:<nonce>:<event>:<instanceId>">
```

The Trigger node verifies this and rejects stale requests. Run both the bridge
and n8n behind HTTPS in production.

## How it talks to OctoPrint

1. `POST /api/login {passive:true}` (with the API key) to get a socket session.
2. Opens the SockJS feed at `/sockjs`, authenticates with `user:session`, and
   throttles the `current` stream.
3. Polls `/api/version`, `/api/printer`, `/api/job` on an interval as a
   heartbeat and to emit `Snapshot` events.

Reconnects with exponential backoff and forces a reconnect if the feed goes
silent for 60 s.

## License

[MIT](../LICENSE)
