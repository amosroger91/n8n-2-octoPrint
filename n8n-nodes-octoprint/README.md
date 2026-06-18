# n8n-nodes-octoprint

An [n8n](https://n8n.io/) community node package for [OctoPrint](https://octoprint.org/).
Part of [n8n-2-octoPrint](https://github.com/amosroger91/n8n-2-octoPrint).

It provides:

- **OctoPrint Trigger** — starts a workflow when the `octoprint2n8n` bridge
  forwards a printer event (print started/done/failed, progress, errors, …).
- **OctoPrint** — sends commands to the printer (start/pause/cancel a job, set
  tool/bed temperature, home, jog, list/select/delete files, connect, …).

## Installation

### From the n8n UI (recommended)

**Settings → Community Nodes → Install** and enter `n8n-nodes-octoprint`.

### From source

```bash
cd n8n-nodes-octoprint
npm install
npm run build
# then link/copy into your n8n custom-nodes folder, e.g.
#   ~/.n8n/custom/   (set N8N_CUSTOM_EXTENSIONS if you use a custom path)
```

## Credentials

| Credential | Fields | Used by |
| --- | --- | --- |
| **OctoPrint Bridge (octoprint2n8n)** | Bridge Base URL, Shared Secret | Action node (Bridge mode), Trigger node (signature verification) |
| **OctoPrint API** | OctoPrint Base URL, API Key | Action node (Direct mode) |

The **Shared Secret** must equal the bridge's `BRIDGE_SHARED_SECRET`.

## OctoPrint Trigger

1. Add the node and open it — note the **Production URL**.
2. Put that URL in the bridge's `N8N_WEBHOOK_URL` and restart the bridge.
3. (Optional but recommended) enable **Verify Signature** and attach an
   *OctoPrint Bridge* credential so only the bridge can trigger the workflow.
4. Choose which **Events** should start the workflow (or `*` for all).

Each execution's JSON is one normalized event — see
[the event schema](../octoprint2n8n/README.md#event-schema).

## OctoPrint (action node)

Pick a **Connection**:

- **Via octoprint2n8n Bridge** — relays through the bridge (your OctoPrint API
  key stays on the bridge). Uses the *OctoPrint Bridge* credential.
- **Direct to OctoPrint** — calls the OctoPrint REST API directly (n8n must be
  able to reach OctoPrint). Uses the *OctoPrint API* credential.

| Resource | Operations |
| --- | --- |
| **Job** | Get, Start, Pause, Resume, Toggle Pause, Cancel, Restart |
| **Printer** | Get State, Set Tool Temperature, Set Bed Temperature, Home, Jog |
| **File** | List, Select (optionally print), Delete |
| **System** | Get Version, Get Connection, Connect, Disconnect |

Both modes map to the same OctoPrint REST semantics — bridge mode just forwards
the call through the bridge's allow-listed proxy.

## Development

```bash
npm install
npm run build     # tsc + copy icons into dist/
npm run dev       # tsc --watch
```

## License

[MIT](../LICENSE)
