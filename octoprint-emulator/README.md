# octoprint-emulator

A **virtual OctoPrint instance** for testing
[n8n-2-octoPrint](https://github.com/amosroger91/n8n-2-octoPrint) without a real
printer. It speaks the slice of OctoPrint's REST + SockJS API that the
`octoprint2n8n` bridge uses, and simulates a print job — temperatures ramp,
progress climbs 0 → 100 %, and it emits real OctoPrint events
(`PrintStarted`, `PrintPaused`, `PrintDone`, …).

> This is a lightweight stand-in, not OctoPrint. For full-fidelity testing,
> point the bridge at real OctoPrint running its built-in **Virtual Printer**
> plugin (no hardware needed). The emulator is for fast, offline, scriptable
> loops and CI.

## Run

```bash
cd octoprint-emulator
npm install
npm run build
PRINT_DURATION_SEC=20 AUTO_DEMO=true npm start
```

Or with Docker, from the repo root:

```bash
docker compose --profile demo up --build
```

…which starts the emulator **and** the bridge wired to it (see the root README).

## What it implements

- **REST:** `GET /api/version`, `POST /api/login`, `GET/POST /api/connection`,
  `GET /api/printer`, `POST /api/printer/{tool,bed,printhead}`,
  `GET/POST /api/job`, `GET /api/files[/<location>]`,
  `POST|DELETE /api/files/<location>/<path>`, `GET /api/printerprofiles`.
- **SockJS** at `/sockjs`: sends `connected`, accepts `auth`/`throttle`, and
  pushes `current`, `history`, and `event` messages — the same shapes OctoPrint
  uses.

## Configuration

| Variable | Default | Description |
| --- | --- | --- |
| `PORT` | `8080` | HTTP/SockJS port |
| `PRINT_DURATION_SEC` | `60` | How long a simulated print takes |
| `CURRENT_INTERVAL_MS` | `500` | How often `current` telemetry is pushed |
| `AUTO_DEMO` | `false` | Auto-start a print on boot and loop forever |
| `API_KEY` | — | If set, `/api/*` requires this `X-Api-Key` |

## Drive it

A print starts when something selects + prints a file or starts the job — e.g.
the n8n **OctoPrint** action node (*File → Select*, print = on), or directly:

```bash
curl -X POST http://localhost:8080/api/job -H 'Content-Type: application/json' \
  -d '{"command":"start"}'
```

`benchy.gcode` is pre-selected, so `start` works immediately.

## License

[MIT](../LICENSE)
