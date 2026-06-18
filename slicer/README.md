# slicer — edge slicing companion

A small Docker companion that runs **headless OrcaSlicer** right next to the
orchestrator at each print site, exposing a tiny HTTP slice API. Slicing happens
at the edge — there's no central slicing server to bottleneck, and none of the
~5 GB desktop-GUI build the full OrcaSlicer image ships.

> **Status:** the slice contract + orchestrator integration are defined, and the
> Ender 3 V3 SE profiles are proven via OrcaSlicer's CLI (machine/process JSONs +
> the `G92 E0` start-gcode fix). The container image is being finalized.

## Contract

```
POST /slice    multipart:  file=<STL/3MF>   profile=<name>   [material=<name>]
   → 200  gcode  (raw body, or JSON with gcodeBase64 / gcodeUrl + optional stats)
```

The orchestrator points `SLICER_URL` at this companion (e.g.
`http://slicer:8080/slice`) — see [`../print-orchestrator/`](../print-orchestrator/README.md).
A job whose source is already `.gcode` skips slicing entirely.

## Why headless OrcaSlicer

OrcaSlicer has the strongest Creality / Ender 3 V3 SE profiles, and its CLI
slices completely headless (`QT_QPA_PLATFORM=offscreen`) — no desktop, no video
streaming. You get the same proven gcode in a fraction of the footprint, and it
runs at the printer instead of on a central VPS.

Swapping in a different engine (PrusaSlicer CLI, CuraEngine) is just a different
base image behind the same `POST /slice` contract.

## License

[MIT](../LICENSE)
