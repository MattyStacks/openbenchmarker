# Neon CPU overhead investigation

Branch: `perf/neon-cpu-overhead`.

## Evidence

The supplied 2.2.0 SteamOS / Brave 157 Low 720p run reports 1844.4 FPS,
88.8% timer-derived GPU busy, 0.48 ms GPU/frame, 0.17 ms CPU/frame and
0.03 ms scene update/frame. This supports a mixed limit, not a severe
scene-animation bottleneck. CPU submission and GPU execution overlap; their
times must not be added as sequential frame costs. `htop` CPU readings do not
establish GPU utilization. Timer-derived busy is not an OS hardware counter.

## Profiling

The development-only `/?lab` JSON now includes `update_ms`, `submission_ms`
(CPU render time minus scene updates), and `draw_calls` across all passes.
These are synchronous JS timings, not browser GPU-process CPU measurements.
Timer query API overhead is outside the existing render-time measurement;
this change does not measure that overhead independently.

Before selecting a production optimization, collect three identical Low/720p
and Extreme/4K runs on the affected machine, plus a browser CPU profile and
synchronized GPU-specific OS monitoring. Record medians and variability.
Compare development batch/inflight overrides with defaults. Use real accelerated
rendering, never software-renderer FPS, as performance evidence.

Reduce static traversal/submission work if profiles identify it as dominant.
Move traffic/drone animation to shaders only if update/upload costs matter;
maintain body/light/shadow/reflection agreement and deterministic stress laps.
Retain changes only when gains exceed run-to-run variation without an Extreme
regression. A worker alone does not parallelize WebGL command submission.

## Current outcome

No production optimization or performance improvement is claimed. Real-device
profiles and repeated measurements remain outstanding. Existing saved results,
exports, scoring and benchmark version are unchanged.

## Verification on the new machine

- Locked dependencies and Playwright Chromium installed.
- Production build passed; 274 unit tests passed.
- Share browser checks passed (30 checks at phone and desktop widths).
- Production bundle filenames/sizes remained identical after the development-only change.
- Preview deployment attempted but blocked by missing Cloudflare credentials.
- Real GPU profiling and cross-device performance acceptance remain outstanding.
