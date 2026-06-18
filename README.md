# n8n-2-octoPrint

Connect an [OctoPrint](https://octoprint.org/) 3D printer to a self-hosted
[n8n](https://n8n.io/) instance — **both directions**, no cloud in between.

This repo ships two cooperating pieces:

| Component | What it is | Lives in |
| --- | --- | --- |
| **`n8n-nodes-octoprint`** | An n8n community node package: an **OctoPrint Trigger** node (printer events → workflow) and an **OctoPrint** action node (commands → printer). | [`n8n-nodes-octoprint/`](n8n-nodes-octoprint) |
| **`octoprint2n8n`** | The **client / bridge**: a small Node.js service (Docker image) that points at your OctoPrint API, streams its events up to n8n, and relays n8n's commands back down to the printer. | [`octoprint2n8n/`](octoprint2n8n) |
| **`print-orchestrator`** | The **print-farm worker** (Docker image): pulls jobs from an n8n queue, auto-slices the model, prints it on OctoPrint, and reports progress back — backed by a local Redis/BullMQ queue. Run it on the box next to a printer. | [`print-orchestrator/`](print-orchestrator) |

Everything is Node.js / TypeScript. MIT licensed.

## Why a bridge instead of talking to OctoPrint directly?

OctoPrint usually lives on a Raspberry Pi on a home/shop LAN that your n8n
server can't reach, and its real-time feed is a SockJS socket that n8n's HTTP
nodes can't subscribe to. `octoprint2n8n` sits next to the printer, holds the
socket open, and does the translating:

```
                         events (HTTPS POST, HMAC-signed)
   ┌──────────────┐   ───────────────────────────────────▶   ┌──────────────┐
   │  OctoPrint    │                                          │     n8n      │
   │  (REST +      │        ┌───────────────────────┐         │              │
   │   SockJS)     │◀──────▶│     octoprint2n8n     │         │  Trigger ◀── │  events in
   │  on the LAN   │  API   │   (this bridge / the  │◀───────▶│  Action  ──▶ │  commands out
   └──────────────┘  key   │    "client" container) │  Bearer └──────────────┘
                            └───────────────────────┘
        printer side                bridge                      automation side
```

- **Events up:** the bridge subscribes to OctoPrint's push socket and polls its
  REST API, normalizes everything into one event shape, and `POST`s it to the
  **OctoPrint Trigger** node's webhook URL (optionally HMAC-signed).
- **Commands down:** the **OctoPrint** action node calls the bridge's command
  API (`Bearer`-authenticated), which proxies an allow-listed set of OctoPrint
  REST calls. Your OctoPrint API key never leaves the bridge.

> The bridge is optional for the command direction. If your n8n server *can*
> reach OctoPrint directly, the action node also has a **Direct** mode that hits
> the OctoPrint REST API itself — no bridge required for commands.

## Quick start

### 1. Run the bridge next to your printer

```bash
git clone https://github.com/amosroger91/n8n-2-octoPrint.git
cd n8n-2-octoPrint
cp octoprint2n8n/.env.example octoprint2n8n/.env
# edit octoprint2n8n/.env — at minimum OCTOPRINT_URL + OCTOPRINT_API_KEY
docker compose up -d --build
```

Get an API key in OctoPrint under **Settings → API** (global key) or
**Settings → Application Keys** (per-app key). Confirm the bridge is healthy:

```bash
curl http://localhost:5252/api/v1/health
```

### 2. Install the node package in n8n

In n8n: **Settings → Community Nodes → Install** and enter
`n8n-nodes-octoprint`. (Or build from source — see
[`n8n-nodes-octoprint/README.md`](n8n-nodes-octoprint/README.md).)

### 3. Wire it up

- **Receiving events:** add an **OctoPrint Trigger** node, copy its *Production*
  webhook URL, and set it as `N8N_WEBHOOK_URL` in the bridge's `.env`. Restart
  the bridge. Printer events now start your workflow.
- **Sending commands:** add an **OctoPrint** node, create an *OctoPrint Bridge*
  credential (the bridge URL + the same `BRIDGE_SHARED_SECRET`), and pick an
  operation (start print, set temperature, cancel, …).

A matching `BRIDGE_SHARED_SECRET` on both ends turns on HMAC-signed events and
authenticates commands. Use HTTPS in front of both the bridge and n8n in
production.

## Testing without a printer

No printer? This repo ships a **virtual OctoPrint** — `octoprint-emulator/` —
that speaks the same REST + SockJS API and simulates a print job (temps ramp,
progress 0 → 100 %, real `PrintStarted`/`PrintDone` events).

Run the full chain (emulator → bridge → captured webhook + a command round-trip)
with no Docker and no n8n:

```bash
cd octoprint-emulator && npm install && npm run build && cd ..
cd octoprint2n8n     && npm install && npm run build && cd ..
node scripts/e2e.mjs
```

Or watch it run continuously in Docker:

```bash
docker compose --profile demo up --build     # emulator prints on a loop
# then point the bridge at it: OCTOPRINT_URL=http://octoprint-emulator:8080
```

### Full real stack (OctoPrint + n8n, no printer)

For end-to-end fidelity there's a one-command demo that runs **real OctoPrint**
(with its built-in Virtual Printer), the bridge, and **real n8n** with the actual
OctoPrint Trigger node — then you watch print events arrive as workflow
executions:

```bash
docker compose -f demo/docker-compose.yml up -d --build
bash demo/setup.sh     # installs the node + activates the workflow in n8n
bash demo/print.sh     # prints on the virtual printer
# open http://localhost:5678 and watch the Executions tab
```

See [`demo/README.md`](demo/README.md) for details and the `scripts/verify-*.mjs`
checks (emulator, real OctoPrint, and full-stack-through-n8n).

## Repository layout

```
n8n-2-octoPrint/
├── n8n-nodes-octoprint/   # the n8n community node package (Trigger + Action)
├── octoprint2n8n/         # the bridge / client (Docker image)
├── print-orchestrator/    # the print-farm worker (n8n queue -> slice -> print)
├── octoprint-emulator/    # a virtual OctoPrint for testing without a printer
├── demo/                  # one-command full stack (OctoPrint + bridge + n8n)
├── scripts/               # e2e + real-OctoPrint + full-stack verification
└── .github/workflows/     # CI: builds all packages, runs e2e, builds images
```

See each subfolder's README for the full env-var reference, the event schema,
and the list of supported operations.

## A note on dockerizing OctoPrint itself

This project deliberately does **not** containerize OctoPrint. OctoPrint needs
direct access to the printer's USB/serial device, and passing that through a
container reliably across hosts is fiddle-prone. Run OctoPrint the normal way
(OctoPi image, native install, etc.) and point the bridge at it.

## License

[MIT](LICENSE) © 2026 Roger Hernandez (amosroger91)
