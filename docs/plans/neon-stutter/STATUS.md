# Neon stutter: status and handoff

Updated: 2026-11-07. Branch: `perf/neon-cpu-overhead`.

## Selected version

Matt asked to stop experimenting, restore the best partial improvement, and leave
a plan for Claude and other AIs. The restored version is the `runtime` experiment
in [the measurements](../../performance/neon-2026-11-07-results.jsonl).
It retains the original bitmap rendering path and original fence polling, with:

- Display ticks advance by elapsed time; requests fire when crossing a slot.
- Refresh estimation uses the lower quintile of callback intervals.
- Sustained callback loss can reduce preview cadence during warm-up or timing;
  isolated delays are trimmed and the backoff is retained to avoid oscillation.
- Individual GPU frames longer than the configured queue budget use one in-flight
  batch. Short Low frames retain two. Fixed scene/shader work is unchanged.

This is **not a completed fix**. Matt said motion settled and stutters were smaller,
but still present. Low/720p remains the main problem and acceptance priority.
Do not restart from any later experimental direct-canvas or readback variant.
Benchmark version remains 3.0.1; no preview deployment was made this session.

## Evidence and validation

Baseline Low/720p: 194.5–196.7 render FPS, 69.8–73.9 handoffs/s, p95 19.6–21 ms,
max 75.6–86.7 ms. Selected version: 195.2–197.1 render FPS, 57.5–57.8 handoffs/s,
p95 17.7–25.2 ms, max 58.6–68.4 ms. Timer coverage approximately 91% in the selected
runs. These aggregates do not prove uniform improvement; visual feedback informed
the selection. Only two selected-version trials completed.

349 unit tests and production build pass. Seven default browser tests and 30 sharing checks pass; seven accelerated
worker tests were skipped by the default browser suite. The accelerated worker suite was not rerun against
this exact final combination; prior intermediate heavy runs are not full acceptance.
No system driver, monitor, or browser-profile settings were changed.

## Next session

Read [PLAN.md](PLAN.md), then the investigation and archived results. The problem
occurs on other machines too. Do not blame this installation or replace the Low
acceptance target with a successful heavy-preset run. Do not call timer-derived
coverage an OS utilization counter or call canvas handoffs physical scanout.
