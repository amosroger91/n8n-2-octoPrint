# print-orchestrator

The **print-farm worker** for [n8n-2-octoPrint](https://github.com/amosroger91/n8n-2-octoPrint).
A small Docker service you run **on the box next to a printer**. It pulls jobs
from n8n, auto-slices the model, prints it on OctoPrint, and reports progress
back to n8n — backed by a local **Redis (BullMQ)** queue for durability,
retries, and one-print-at-a-time concurrency.

```
n8n print-queue (poll)  ──►  Redis / BullMQ  ──►  worker
                                                     │  per job
                                                     ▼
                       fetch STL ─► slice (Ender 3 V3 SE) ─► upload+print on
                       OctoPrint ─► poll progress ─► POST status back to n8n
```

## Status

- **Print path: built + tested.** `claimed → uploading → printing(0–100%) → done`
  verified end-to-end against real OctoPrint. See `stage-a.mjs`.
- **Slicer + n8n adapters: built against a draft contract** (below) — they need
  the real slicer request/response shape, the `print-queue` schema, and the two
  n8n webhook URLs to be finalized.

## Run it (on-site)

```bash
cp .env.example .env     # fill in OCTOPRINT_URL/KEY, SLICER_*, N8N_*
docker compose up -d --build
```

## Dashboard

A local status dashboard runs on **http://localhost:4848** (set `DASHBOARD_PORT`).
It shows the printer state + live progress, the queue (waiting/active/completed/
failed), the pipeline config, and recent jobs — auto-refreshing every 3s.

It's behind a **pluggable auth layer**:

- **Local provider** (built in): username/password from `DASHBOARD_USERNAME` /
  `DASHBOARD_PASSWORD` (scrypt-hashed, HMAC-signed session cookies). If
  `DASHBOARD_PASSWORD` is blank, a random one is generated and printed in the
  logs on startup. Set `SESSION_SECRET` to keep logins across restarts.
- **External providers**: implement the `OAuthProvider` interface
  (`src/auth/types.ts`) and `registry.register(...)` it in `buildAuth()`
  (`src/index.ts`). The login page and `/auth/<id>` + `/auth/<id>/callback`
  routes wire up automatically.

`GET /api/status` returns the same data as JSON (auth required); `GET /healthz`
is unauthenticated.

## Configuration

| Variable | Required | Description |
| --- | --- | --- |
| `OCTOPRINT_URL` | ✅ | Printer's OctoPrint, e.g. `http://192.168.1.156:5000` |
| `OCTOPRINT_API_KEY` | ✅ | OctoPrint API key |
| `REDIS_URL` | | Defaults to the bundled redis in compose |
| `SLICER_URL` | | Slice endpoint; blank ⇒ jobs must supply pre-sliced gcode |
| `SLICER_USERNAME` / `SLICER_PASSWORD` | | HTTP basic auth for the slicer |
| `SLICER_PROFILE` | | Printer profile (default `ender3v3se`) |
| `N8N_QUEUE_URL` | | Webhook to GET claimable jobs; blank disables polling |
| `N8N_STATUS_URL` | | Webhook to POST status/progress |
| `N8N_AUTH_HEADER` | | Optional `Authorization` for those webhooks |
| `N8N_POLL_INTERVAL_MS` | | Job poll cadence (default 10000) |
| `CONCURRENCY` | | Concurrent prints — keep at `1` |
| `PRINT_POLL_INTERVAL_MS` | | Progress poll cadence (default 5000) |

## The n8n contract (two webhooks to build)

**`GET N8N_QUEUE_URL`** → an array of *still-queued* rows. The orchestrator maps
these fields (others are passed through in `meta`):

```jsonc
[{ "id": "row-123", "stlUrl": "https://…/model.stl", "name": "benchy",
   "material": "PLA", "color": "black" }]
```

It must only return rows that are **not yet claimed** (filter `status = queued`),
so a job in flight isn't printed twice.

**`POST N8N_STATUS_URL`** ← status updates, which your workflow writes to the
`print-queue` row:

```jsonc
{ "id": "row-123", "printerId": "shop-pi", "status": "printing",
  "progress": 42, "stats": { "filamentUsedGrams": 8.1, "printTimeHours": 0.6 },
  "at": "2026-06-18T05:40:00.000Z" }
```

`status` ∈ `claimed | slicing | uploading | printing | done | failed | cancelled`.

## The slicer contract (to confirm)

Currently the orchestrator POSTs multipart (`file` = STL, `profile`, `material`)
to `SLICER_URL` with basic auth, and accepts the response as **either** raw gcode
**or** JSON (`gcodeBase64` / `gcode` / `gcodeUrl` + optional `stats`). It also
parses filament/time straight from the gcode comments (grams = cm³ × 1.24 for
PLA), so we get stats even if the API returns only gcode. Tell me the real shape
and I'll lock it in.

## Test the print path

With Redis up and an OctoPrint reachable (the repo's virtual printer works):

```bash
npm install && npm run build
node stage-a.mjs        # enqueues a pre-sliced job and prints it
node dashboard-test.mjs # exercises the dashboard login + status endpoints
```

## License

[MIT](../LICENSE)
