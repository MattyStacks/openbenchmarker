# P20: Scene stats and FPS timeline chart

**Track:** Results · **Required** · **Depends on:** P11 (scene boundaries) and P14 (public preview). **Do it before P15**, so every
later beat is tuned with it. · **Visitors see:** a live running average in the HUD, an FPS timeline chart and per-scene stats on the
results page, for both benchmarks · **Ashen version:** next minor · **Neon version:** next patch
(new optional data, measurement unchanged)

**Branch:** `feature/p20-scene-stats-and-fps-chart` · **Preview:** `npm run preview:deploy -- p20-scene-stats-and-fps-chart` → `https://p20-scene-stats-and-fps-chart.opengpubenchmarker.com`

## Goal
Show how performance moves through a run, as 3DMark does: a running FPS average while it plays, then a
line chart sampled at fixed intervals with the scenes marked, plus Avg FPS, 1% low and GPU time per
scene.

## Read first
- `src/benchmark/metrics.ts` (`computeRunStats`, `graphPoints`, `liveBatchFps`, `lowFpsSelect`)
- `src/app/hud.ts` (`drawGraph`: the live frame-time chart and its style)
- `src/app/run.ts` (timed batches)
- `src/app/results-view.ts`
- `src/benchmark/types.ts`
- `src/benchmark/exporter.ts`
- the scene timeline from P11 (`beats.ts`)
- the storyboard's "Results & Sharing" panel

## Scope
- **Scenes:**
  - each benchmark may define scenes as named ranges of its timeline. For Ashen these are the five
    beats from P11.
  - Neon has none and gets the timeline chart without scene bands. Neon can later name segments of
    its flight if wanted.
  - scene boundaries are by scene time `t`, so they mean the same thing on every device and
    duration.
- **Timeline samples at a fixed interval.** Start at **1 s** of scene time, and make the interval a
  per-benchmark constant (0.5 s is fine if storage allows). For each interval, record:
  - interval FPS (frames ÷ wall time in that interval)
  - **running average** FPS from the start of the timed phase
  - GPU ms per frame when timer results exist
  - the scene id
  - built from the existing timed batches. Batches that straddle an interval edge are split
    proportionally, so totals reconcile exactly with Avg FPS.
- **Per-scene stats:**
  - Avg FPS, 1% low, 5% low, GPU ms and frame count per scene, from the per-frame times inside
    each scene (same `metrics.ts` math as the whole run)
  - when the journey plays more than once (90 s runs, stress laps), stats cover every pass through a
    scene, with a per-lap split for stress tests
- **Live HUD:**
  - running average FPS and current scene name next to the existing live FPS
  - the line chart grows live at the same interval, in the `drawGraph` style
  - HUD updates stay batched (no per-frame DOM work) so measurement is unaffected. Verify in
    `lab.ts`: the HUD-on vs. HUD-off difference stays within noise.
- **Results page:** a line chart in the same visual style as the frame-time chart, drawn on a canvas:
  - **interval FPS** line and **running average** line (the average settling as the run goes)
  - shaded **scene bands** with labels (Highway, Gas Station, Tunnel, City Approach, City Core)
  - a 60 FPS reference line, auto-scaled Y, and a time axis in seconds
  - tap or hover a point for time, scene, FPS and running average
  - readable at 390 px phone width
  - below the chart, a per-scene table: Avg FPS, 1% low, GPU ms. The slowest scene is highlighted.
- **Data and exports:**
  - result fields: `timeline` (samples) and `scenes` (per-scene stats), both optional. Old results
    without them still display, just with no chart.
  - **JSON:** includes both
  - **CSV:**
    - the main CSV gains per-scene Avg FPS and 1% low columns (empty for Neon)
    - a separate **"Timeline CSV"** download per result has one row per sample
    - CSV-all stays one file
  - **YAML** (upstream) is **unchanged** until Matt decides, documented in
    `docs/upstream-submission-changes.md` as a proposed addition
  - **Share link:** per-scene Avg FPS (5 small values) only if it fits the QR budget from P06. The
    timeline stays out of the link. The shared view shows per-scene bars when present.
  - **Share card:** optional five-bar per-scene strip, only if it stays legible
- Neon's P01 goldens are updated **once, deliberately**, in this plan for the new CSV columns.
  Document why in the PR; that's the only golden change allowed.

## Out of scope
Sensor data (P24).

## Acceptance
- The frame-count-weighted per-scene averages reconcile with the overall Avg FPS (test).
- The final running-average point equals the result's Avg FPS (test).
- The chart renders for Neon and Ashen, live and on the results page, at phone and desktop width.
- HUD-on vs. HUD-off FPS difference is within run-to-run noise.
- Every README Invariant 4 gate passes.
