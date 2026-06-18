# Full local demo — no printer required

Brings up the **entire stack** on your machine and proves it end to end:

```
real OctoPrint (Virtual Printer)  ->  octoprint2n8n bridge  ->  real n8n (OctoPrint Trigger node)
```

When the virtual printer prints, the events land as **workflow executions** in n8n.

## Run it

```bash
docker compose -f demo/docker-compose.yml up -d --build   # OctoPrint + bridge + n8n
bash demo/setup.sh                                         # install the node + activate the workflow
bash demo/print.sh                                         # start a print on the virtual printer
```

Open <http://localhost:5678>, create the owner account, and watch the
**Executions** tab fill as `PrintStarted`, `Progress`, and `PrintDone` flow
through the workflow. Re-run `bash demo/print.sh` for another print.

Tear down: `docker compose -f demo/docker-compose.yml down -v`

> Needs Docker + Node 20+. `setup.sh`/`print.sh` are bash (Git Bash works on
> Windows). The first n8n boot runs DB migrations and can take a minute.

## What's wired

| Service | Image / build | Notes |
| --- | --- | --- |
| `octoprint` | `octoprint/octoprint` | Boots into an Operational **Virtual Printer** via [`octoprint/config.yaml`](octoprint/config.yaml) — wizard skipped, autoconnect, global API key `DEMOKEY…`. UI at <http://localhost:5005>. |
| `bridge` | builds `../octoprint2n8n` | Points at `octoprint:5000`, forwards events to `n8n:5678/webhook/octoprint`. API at <http://localhost:5252>. |
| `n8n` | `docker.n8n.io/n8nio/n8n` | `setup.sh` installs `n8n-nodes-octoprint` as a community node and activates [`n8n/octoprint-demo.json`](n8n/octoprint-demo.json) (OctoPrint Trigger → HTTP Request). UI at <http://localhost:5678>. |

## Automated checks

```bash
node scripts/e2e.mjs           # emulator -> bridge (offline, fast — no Docker)
node scripts/verify-real.mjs   # real OctoPrint container -> bridge (needs `up`)
node scripts/verify-fullstack.mjs  # real OctoPrint -> bridge -> n8n workflow (needs `up` + `setup.sh`)
```

## Notes

- OctoPrint rewrites `octoprint/config.yaml` on first boot (adds a secret key and
  plugin versions). That's expected — `git checkout demo/octoprint/config.yaml`
  to reset it.
- For a real deployment you'd install `n8n-nodes-octoprint` from npm via n8n's
  **Settings → Community Nodes** screen instead of `setup.sh`, and point the
  bridge at your real OctoPrint (or one running the Virtual Printer plugin).
