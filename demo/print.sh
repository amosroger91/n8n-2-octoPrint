#!/usr/bin/env bash
# Upload + start a print on the demo OctoPrint virtual printer.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
KEY=DEMOKEY00000000000000000000000000

echo "Uploading + starting demo.gcode on the virtual printer…"
curl -sS -H "X-Api-Key: $KEY" \
  -F "file=@$HERE/octoprint/demo.gcode" \
  -F "print=true" \
  http://localhost:5005/api/files/local >/dev/null

echo "Print started (~10-15s). Watch the Executions tab at http://localhost:5678"
