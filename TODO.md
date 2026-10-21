# TODO and future plans

## Rebalance the presets, Extreme at 4K first (next)

A 5080 runs Extreme at 4K at ~116 FPS, with 8.3 ms of GPU time per frame at ~96% GPU busy
(2.1.0, Edge/D3D11). The target is ~60–70 FPS, so about 14–16 ms of GPU time per frame (~1.8×).
The other presets will likely shift too, as one block of work.

- Add only GPU-side work: no more cars or drones, because `traffic.ts` and `drones.ts` update
  them in JavaScript every frame and would make the test CPU-limited. Candidates:
  - more shader-driven rain
  - an 8192 shadow map, falling back to `MAX_TEXTURE_SIZE` (recorded in `rendered_with`)
  - heavier bloom, fog and atmosphere passes
  - more instanced tower detail
- Check each step on a real GPU with Score: Extreme. The results page shows GPU time per frame
  and GPU busy %, which should stay at ~95%+ (GPU-limited) while FPS drops.
- Keep presets non-decreasing (`tests/presets.test.ts`). Update the README preset and load tables.
- Bump `BENCHMARK_VERSION` (Extreme scores from before and after aren't comparable). Do it
  before a leaderboard launches, so no posted scores are reset.

## Leaderboard site

A separate site that ranks **Score: Entry** and **Score: Extreme** results per GPU, like 3DMark's
Hall of Fame. Nothing is planned or built yet.

- **Two independent submission targets.** One run can go to Open GPU Benchmarks (the open
  dataset, via a GitHub PR, as today) and, separately, to the leaderboard. Neither depends on
  the other. Add a second "Submit to leaderboard" action on the results page next to the
  existing YAML export.
- **Rankings.** Per score test and per benchmark version, never mixed with custom runs.
  Overclocked runs are allowed and labelled (`overclocked: true`), with a filter for stock-only.
  Show the limit verdict next to each score. Optionally split Entry boards by CPU, since Entry is
  often CPU-limited.
- **Tamper resistance.** Hand-edited scores are the main risk. Options, from simplest:
  - server-side recheck of `score == round(avg_fps × 100)` and the locked settings (the client
    already enforces both)
  - submit the per-batch frame-time summary, so the server can recompute avg FPS and the lows
  - sign the payload in the page (only deters casual edits, since the key ships to the client)
  - require a short screen recording for top-N placements
- **Overclock details** (leaderboard only, not upstream): core/memory clock offset, power limit,
  and cooling (air/liquid/LN2).
- **Accounts.** Optional GitHub sign-in to claim results. Anonymous submissions stay possible.

## Diagnostics a browser can't measure yet

The results page already reports GPU busy %, JavaScript time per frame (scene update vs draw
submission), GPU wait, main-thread stalls, hitches, JS heap growth, renderer/backend, software
rendering, likely integrated GPU, and battery state. Still missing:

- Real GPU and CPU clocks, temperatures, power draw and VRAM use. These could come from an
  optional native companion app, or from pasting `nvidia-smi` / GPU-Z / MangoHud output the page
  parses.
- Thermal throttling. This would need a fixed scene segment repeated at the start and end of a
  run, so frame times can be compared like for like (the flight changes over time, so today's
  trend isn't comparable).
- Whether the PCIe link runs at full width/speed, and whether resizable BAR is on.
- A "CPU stress" mode that times the scene update alone without rendering, to separate CPU
  speed from GPU speed even more cleanly.

## Upstream

- Apply the open-gpu-benchmarks changes in `docs/upstream-submission-changes.md`: validation
  for the new fields, the outlier-check exemption for CPU-limited/overclocked runs, and a
  dedicated `openbenchmarker` proof method.
