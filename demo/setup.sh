#!/usr/bin/env bash
# Installs the OctoPrint community node into the demo n8n container, then imports
# and activates the demo workflow. Run once after `docker compose ... up -d`.
set -euo pipefail
export MSYS_NO_PATHCONV=1   # stop Git Bash mangling container paths on Windows

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"
N8N=demo-n8n

echo "==> Building + packing n8n-nodes-octoprint"
( cd "$ROOT/n8n-nodes-octoprint" && npm install >/dev/null 2>&1 && npm run build >/dev/null && rm -f n8n-nodes-octoprint-*.tgz && npm pack >/dev/null )
TGZ="$(ls "$ROOT"/n8n-nodes-octoprint/n8n-nodes-octoprint-*.tgz | tail -1)"

echo "==> Installing the node into n8n container ($N8N)"
docker cp "$TGZ" "$N8N:/tmp/node.tgz"
docker exec "$N8N" sh -c 'mkdir -p ~/.n8n/nodes && cd ~/.n8n/nodes && (npm init -y >/dev/null 2>&1 || true) && npm install /tmp/node.tgz --omit=dev --legacy-peer-deps >/dev/null 2>&1'

echo "==> Importing + activating the demo workflow"
docker cp "$ROOT/demo/n8n/octoprint-demo.json" "$N8N:/tmp/demo.json"
docker exec "$N8N" n8n import:workflow --input=/tmp/demo.json
docker exec "$N8N" n8n update:workflow --id=OctoPrintDemo001 --active=true

echo "==> Restarting n8n to register the webhook"
docker restart "$N8N" >/dev/null

echo
echo "Done. Webhook is live at http://localhost:5678/webhook/octoprint"
echo "Open http://localhost:5678 (create the owner account), then run: bash demo/print.sh"
