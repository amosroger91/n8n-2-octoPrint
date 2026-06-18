# slicer — edge slicing companion

A small Docker companion that runs **headless OrcaSlicer** right next to the
orchestrator at each print site, exposing a tiny HTTP slice API. Slicing happens
at the edge — there's no central slicing server to bottleneck, and none of the
~5 GB desktop-GUI build the full OrcaSlicer image ships (this image is ~1.5 GB).

> **Status:** working. Builds OrcaSlicer **2.3.2** from the official AppImage and
> slices STL/3MF → gcode headlessly. Verified end to end on a 20 mm cube against
> the **Ender 3 V3 SE 0.4 mm** profiles (auto-selected; the `G92 E0` start-gcode
> fix is applied automatically). Swap the profile match for any printer.

## Contract

```
POST /slice    multipart:  file=<STL/3MF>   [material=<PLA|PETG>]
   → 200  text/plain  gcode   (raw body; the orchestrator parses stats from it)
GET  /health   → {"status":"ok"}
```

A job whose source is already `.gcode` skips slicing entirely. The orchestrator
points `SLICER_URL` at this companion — by default `http://slicer:8080/slice`
when both run in the same compose project (see
[`../print-orchestrator/`](../print-orchestrator/README.md)).

## Run it (bundled in the print site — recommended)

The orchestrator's compose already includes this service, so the normal path is
just:

```bash
cd ../print-orchestrator
docker compose up -d --build      # brings up redis + slicer + orchestrator
```

The orchestrator reaches the slicer over the compose network; no ports are
published for it.

## Run it standalone

```bash
docker build -t n8n2octo-slicer ./slicer
docker run -d --name slicer -p 8080:8080 n8n2octo-slicer

# slice something:
curl -F file=@model.stl -F material=PLA http://localhost:8080/slice -o out.gcode
```

## How the image is built (Dockerfile)

[`Dockerfile`](Dockerfile) — `ubuntu:24.04` base, layered so the heavy bits cache
well:

1. **Fetch + extract OrcaSlicer.** The official Linux AppImage is downloaded and
   unpacked with `--appimage-extract` (no FUSE needed in a container) into
   `/opt/orcaslicer`. Pin/upgrade the version with
   `--build-arg ORCA_URL=…<AppImage URL>`. This layer is ordered *before* the
   apt deps so changing the dependency list doesn't re-download the ~400 MB
   AppImage.
2. **Runtime libraries.** OrcaSlicer's CLI links a set of GTK/WebKit/X11 libs
   even when run headless — including a few the AppImage doesn't bundle
   (`libSM`, `libICE`, `libmspack`). They're installed from Ubuntu's repos, and
   Node 20 is added for the slice server. (Verify the closure with
   `ldd /opt/orcaslicer/bin/orca-slicer | grep 'not found'`.)
3. **The slice server.** [`server.mjs`](server.mjs) (Node + `busboy`) accepts the
   upload and shells out to OrcaSlicer.

Slicing runs under `QT_QPA_PLATFORM=offscreen` — no X server, no display.

### What the server does per request

- **Finds the profiles** under `/opt/orcaslicer/resources/profiles` by regex
  (env-overridable): the machine `Ender-3 V3 SE 0.4 nozzle`, the process
  `0.20mm Standard … Ender3V3SE 0.4`, and a `Creality Generic PLA/PETG` filament.
- **Patches the machine profile** in a temp copy: OrcaSlicer leaves
  `layer_change_gcode` empty with relative-E on, which makes the CLI refuse to
  slice ("Add `G92 E0`"); the server injects it.
- **Runs** `orca-slicer --load-settings "<machine>;<process>" --load-filaments
  "<filament>" --arrange 1 --orient 1 --slice 0 --outputdir … <model>` and
  returns the resulting gcode. Temp files are cleaned up after each request.

### Configuration (env)

| Var | Default | Purpose |
| --- | --- | --- |
| `PORT` | `8080` | HTTP port |
| `ORCA_BIN` | `/opt/orcaslicer/AppRun` | OrcaSlicer entrypoint |
| `PROFILE_ROOT` | `/opt/orcaslicer/resources/profiles` | where profiles live |
| `MACHINE_MATCH` | `Ender-3 V3 SE 0\.4 nozzle` | machine-profile regex |
| `PROCESS_MATCH` | `0\.20mm Standard.*Ender3V3SE 0\.4` | process-profile regex |
| `ORCA_DATADIR` | `/data/orca` | OrcaSlicer config dir |

To target a **different printer**, point `MACHINE_MATCH` / `PROCESS_MATCH` at
that printer's OrcaSlicer profile names — no code change.

## Why headless OrcaSlicer

OrcaSlicer has the strongest Creality / Ender 3 V3 SE profiles, and its CLI
slices completely headless — same proven gcode, a fraction of the footprint,
running at the printer instead of on a central VPS.

Swapping in a different engine (PrusaSlicer CLI, CuraEngine) is just a different
base image behind the same `POST /slice` contract.

## License

[MIT](../LICENSE)
