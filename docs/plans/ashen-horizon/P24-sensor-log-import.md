# P24 (optional): Sensor log import

**Track:** Results · **Depends on:** P20 · **Visitors see:** an optional "Add sensor log" on the
results page · **Versions:** unchanged (user-supplied data, no measurement change)

**Branch:** `feature/p24-sensor-log-import` · **Preview:** `npm run preview:deploy -- p24-sensor-log-import` → `https://p24-sensor-log-import.opengpubenchmarker.com`

## Goal
Add GPU temperature, power, clocks and VRAM to a result. Browsers can't read these: WebGPU exposes no
sensors, and Compute Pressure only reports coarse CPU states. So the visitor supplies a log from a tool
they ran alongside the benchmark.

## Read first
- README "Honest-data rules"
- `docs/privacy-audit.md`
- `src/benchmark/fields.ts`
- `src/app/results-view.ts`
- the P20 timeline
- `TODO.md` ("Diagnostics a browser can't measure yet")

## Scope
- **Supported logs:** start with MangoHud CSV (Linux), PresentMon/CapFrameX CSV (Windows), GPU-Z sensor
  log and `nvidia-smi --query-gpu=... --format=csv -l 1`. HWiNFO CSV if practical.
- **Parsing:**
  - entirely in the browser, never uploaded
  - drag-and-drop or file picker on the results page
- **Alignment:**
  - match log timestamps to the run's timed phase using the run's start and end wall-clock times
    (record them in the result if they aren't already)
  - show the matched window, and let the user nudge the offset if the clocks differ
- **Summary stored in the result**, under a separate optional `sensors` block marked
  `source: "user-supplied log (<tool>)"`:
  - GPU temp avg/max, hotspot max if present, board power avg/max, core and memory clock avg, VRAM
    used max, fan % avg
- **Results page:**
  - a sensor summary panel
  - optional temperature and power lines under the P20 FPS chart, on the same time axis
- **Exports:**
  - JSON includes `sensors`
  - CSV gains sensor summary columns, empty when absent
  - YAML is unchanged unless the upstream schema adds these fields
  - share links: not included at first
- **Honest data:** clearly labelled as user-supplied, never mixed with browser-measured fields, and
  never prefilled or guessed.

## Acceptance
- A sample log from each supported tool parses, aligns and summarizes correctly (tests with fixture
  logs).
- A bad or mismatched log shows a clear error and changes nothing.
- No network requests during import.
