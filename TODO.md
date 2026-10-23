# TODO and future plans

## Test in Safari (WebKit)

2.2.0 is checked in Edge and Brave on an RTX 5080 (all presets at 4K, 93–98% GPU busy) and on
a phone (720p Low, ~300 FPS). Safari on a Mac or iPhone hasn't been confirmed yet.
Things to check there: the volumetric haze (it needs a float depth texture), the 8192 shadow map
cap and whether GPU timer queries are available (if not, the limit is estimated).

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
- Why a stress test slowed down. The stress tests (6 identical laps) now show *that* a device
  throttled, but not whether heat, a power limit or a battery saver caused it; that needs
  temperatures, clocks and power from outside the browser.
- Whether the PCIe link runs at full width/speed, and whether resizable BAR is on.
- A "CPU stress" mode that times the scene update alone without rendering, to separate CPU
  speed from GPU speed even more cleanly.

## Upstream

- Apply the open-gpu-benchmarks changes in `docs/upstream-submission-changes.md`: validation
  for the new fields, the outlier-check exemption for CPU-limited/overclocked runs, and a
  dedicated `openbenchmarker` proof method.
