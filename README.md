# n8n-2-octoPrint

**Connect [OctoPrint](https://octoprint.org/) 3D printers to self-hosted
[n8n](https://n8n.io/) — both directions — and run an automated print farm on
top of it.** All Node.js / TypeScript, all self-hostable, no cloud in between.
MIT licensed.

It does two related things:

1. **A two-way bridge between OctoPrint and n8n** — printer events trigger n8n
   workflows, and n8n workflows send commands back to the printer.
2. **A print-farm orchestrator** — pull jobs from an n8n queue, auto-slice the
   model, print it on OctoPrint, and report progress back — with a local status
   dashboard and pluggable auth.

You can use either half on its own.

## Components

| Component | What it is | Lives in |
| --- | --- | --- |
| **`n8n-nodes-octoprint`** | n8n community node package: an **OctoPrint Trigger** node (printer events → workflow) and an **OctoPrint** action node (commands → printer), plus credentials. | [`n8n-nodes-octoprint/`](n8n-nodes-octoprint) |
| **`octoprint2n8n`** | The **bridge**: a Node service (Docker image) that points at an OctoPrint API, streams its events up to n8n (HMAC-signed), and relays n8n's commands back down via an authenticated proxy. | [`octoprint2n8n/`](octoprint2n8n) |
| **`print-orchestrator`** | The **print-farm worker** (Docker image): pulls jobs from an n8n queue, auto-slices, prints on OctoPrint, reports progress — backed by a local Redis/BullMQ queue, with a status **dashboard** + pluggable auth. | [`print-orchestrator/`](print-orchestrator) |
| **`octoprint-emulator`** | A **virtual OctoPrint** (REST + SockJS) that simulates a print, so you can develop and test the whole thing with no printer. | [`octoprint-emulator/`](octoprint-emulator) |

## How it fits together

```
                         ┌───────────────────────────── n8n ─────────────────────────────┐
                         │  OctoPrint Trigger node      OctoPrint action node    Queue +   │
                         │  (events in)                 (commands out)           webhooks  │
                         └───▲───────────────────────────────┬───────────────────▲─────┬───┘
            events (HMAC POST)│                   commands (Bearer)│        jobs   │     │ status
                              │                                    │      (poll)   │     │ (POST)
                         ┌────┴─────────── octoprint2n8n ──────────┴────┐    ┌─────┴─────┴──────┐
                         │  SockJS subscribe + REST poll → normalize     │    │ print-orchestrator│
                         │  command proxy (allow-listed)                 │    │ Redis/BullMQ queue│
                         └───────────────────┬───────────────────────────┘    │ slice → print →   │
                                             │ OctoPrint API                   │ monitor + dashboard│
                                             ▼                                 └─────────┬─────────┘
                                       ┌──────────┐  ◄──────── upload + print + poll ─────┘
                                       │ OctoPrint │  (on the printer's LAN)
                                       │  + printer │
                                       └──────────┘
```

- **Bridge (`octoprint2n8n`)** holds OctoPrint's SockJS feed open, normalizes
  events, and POSTs them to the Trigger node's webhook; the action node sends
  commands back through its allow-listed proxy. Your OctoPrint API key never
  leaves the box.
- **Orchestrator (`print-orchestrator`)** is the print-farm brain: it polls n8n
  for queued jobs, slices each model, drives the print on OctoPrint, and posts
  status back — independently of the bridge.

## Quick start

### A) Event bridge + nodes (OctoPrint ⇄ n8n)

1. Run the bridge next to your printer:
   ```bash
   cp octoprint2n8n/.env.example octoprint2n8n/.env   # set OCTOPRINT_URL + OCTOPRINT_API_KEY
   docker compose up -d --build
   ```
2. In n8n: **Settings → Community Nodes → Install** `n8n-nodes-octoprint`.
3. Add an **OctoPrint Trigger** node, copy its Production webhook URL into the
   bridge's `N8N_WEBHOOK_URL`, restart the bridge. Add an **OctoPrint** node to
   send commands. (Full details in [`octoprint2n8n/`](octoprint2n8n/README.md)
   and [`n8n-nodes-octoprint/`](n8n-nodes-octoprint/README.md).)

### B) Print farm (queue → slice → print)

Run on the box next to a printer:
```bash
cp print-orchestrator/.env.example print-orchestrator/.env   # OCTOPRINT_*, SLICER_*, N8N_*
cd print-orchestrator && docker compose up -d --build
```
It polls your n8n queue, slices each job, prints it, and reports progress. Open
the dashboard at **http://localhost:4848**.

📖 **[Print-farm guide](docs/print-farm.md)** — the full walkthrough: the stack,
the data flow, the n8n form + queue setup, the slicer, and wiring it all so a
customer can fill out a form and a printer prints their model.

## Dashboard

The orchestrator serves a local **status dashboard** (printer state + live
progress, queue depth, recent jobs, pipeline config) behind a **pluggable auth
layer** — a built-in local username/password provider, with a clean interface
for adding external OAuth/OIDC providers. See
[print-orchestrator/README.md#dashboard](print-orchestrator/README.md#dashboard).

## Test without a printer

The repo ships a **virtual OctoPrint** and a full local stack, so you can try
everything with no hardware:

```bash
# fast, offline: emulator → bridge
cd octoprint-emulator && npm i && npm run build && cd ..
cd octoprint2n8n     && npm i && npm run build && cd ..
node scripts/e2e.mjs

# the whole thing in Docker: real OctoPrint (Virtual Printer) + bridge + n8n
docker compose -f demo/docker-compose.yml up -d --build
bash demo/setup.sh && bash demo/print.sh   # watch n8n's Executions tab
```

More in [`demo/`](demo/README.md). The `scripts/verify-*.mjs` checks cover the
emulator, real OctoPrint, and the full stack through n8n.

## Security model

- **Events → n8n** are HMAC-signed with a shared secret; the Trigger node
  verifies them.
- **Commands → printer** go through the bridge's Bearer-authenticated,
  allow-listed proxy — the OctoPrint API key stays on the bridge.
- **The dashboard** requires login (scrypt-hashed local credentials, HMAC
  session cookies) and is auth-provider-pluggable.
- Run everything behind HTTPS in production. `.env` files are git-ignored — keep
  secrets there.

## Why not dockerize OctoPrint itself?

OctoPrint needs direct USB/serial access to the printer, which is fiddly to pass
through a container reliably. Run OctoPrint the normal way (OctoPi, native, or —
for testing — its built-in **Virtual Printer** plugin) and point these tools at
it.

## Repository layout

```
n8n-2-octoPrint/
├── n8n-nodes-octoprint/   # the n8n community node package (Trigger + Action)
├── octoprint2n8n/         # the bridge / client (Docker image)
├── print-orchestrator/    # the print-farm worker + dashboard (Docker image)
├── octoprint-emulator/    # a virtual OctoPrint for testing without a printer
├── demo/                  # one-command full stack (OctoPrint + bridge + n8n)
├── scripts/               # e2e + real-OctoPrint + full-stack verification
└── .github/workflows/     # CI: builds all packages, runs e2e, builds images
```

## Contributing

Issues and PRs welcome — see [CONTRIBUTING.md](CONTRIBUTING.md) and the
[Code of Conduct](CODE_OF_CONDUCT.md). For security reports, see
[SECURITY.md](SECURITY.md).

## License

[MIT](LICENSE) © 2026 Roger Hernandez (amosroger91)
