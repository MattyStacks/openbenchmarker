# P10: WebGPU measurement

**Track:** Ashen foundation · **Depends on:** P09 · **Visitors see:** nothing (`hidden`) · **Ashen version:** 0.3.0

**Branch:** `feature/p10-webgpu-measurement` · **Preview:** `npm run preview:deploy -- p10-webgpu-measurement` → `https://p10-webgpu-measurement.opengpubenchmarker.com`

## Goal
WebGPU runs are measured with the same meaning as Neon's: Avg FPS, 1%/5% lows, GPU time and
diagnostics. A placeholder run produces a valid, exportable, shareable result.

## Read first
- `src/app/run.ts` (batches, fences, timer queries, pre-roll)
- `src/benchmark/metrics.ts`
- `src/benchmark/diagnose.ts`
- `README` "How a run works" and "Notes on measurement"
- `tests/metrics.test.ts`
- `tests/diagnose.test.ts`

## Scope
- **GPU timer adapter** (P02 interface):
  - WebGPU `timestamp-query` when the adapter offers it, summed across every pass in a frame
  - handle the browser's quantized timestamps
  - without it, fall back to the existing estimated-limit path
- **Pipelining:** reproduce the two-batches-in-flight model with
  `device.queue.onSubmittedWorkDone()` in place of WebGL fences. The adaptive batch sizing
  (`nextBatchFrames`) is unchanged.
- **Pre-roll:**
  - `renderer.compileAsync` for every pipeline
  - pre-render the whole path before timing, like `PREROLL_FRAMES`
  - all buffers and textures are allocated before warm-up
- **Diagnostics** (`gpuBusy`, `gpuMs`, `cpuMs`, `syncMs`, stalls, hitches, `gpuHitches`) are computed
  identically, and the "what limited this run" verdicts still make sense for WebGPU. Adjust only
  where WebGPU genuinely differs, and document it.
- A full hidden run produces a valid result:
  - saved in My Results
  - JSON and CSV export
  - a working share link and card showing GPU frame time
  - YAML disabled ("Preview version")

## Out of scope
Real content.

## Acceptance
- Placeholder runs at Low/720p on Chrome Windows, Safari iOS 26 and an Android Chrome device produce
  valid results with GPU time where available.
- At the same scene, run-to-run noise on the test bench is ≤ 2%.
- Neon is unaffected.
