# Neon stutter: status and handoff

## Session 2026-11-08 (Claude), branch `perf/neon-stutter-2`

Continues from the checkpoint below. **Not finished; a reboot is pending.**

**Environment change.** All Codex numbers (2026-11-06/07) were on the 2080 Ti via nouveau/NVK.
The proprietary NVIDIA 595.112.07 kernel module took over on the 02:09 reboot on 2026-11-07, but
its GL/EGL/Vulkan userspace was missing, so every browser fell back to the Ryzen iGPU (~8 FPS).
Matt installed `nvidia-driver nvidia-driver-libs`. Without a reboot, KDE still started before those
libs existed; the browser reaches the 2080 Ti only via XWayland + PRIME offload env
(`__NV_PRIME_RENDER_OFFLOAD=1 __GLX_VENDOR_LIBRARY_NAME=nvidia`, `--use-angle=gl --ozone-platform=x11`,
set in a local script only). Display 100 Hz. `nvidia-smi` now provides an OS utilization counter
(`GPU_BUSY_CMD` in the profiler). Re-baseline after the reboot before trusting the numbers below.

Results: [neon-2026-11-08-results.jsonl](../../performance/neon-2026-11-08-results.jsonl)
(Low/720p/30 s, one visible window; "OS" = nvidia-smi steady-state mean).

| Config | Render FPS | Timer | OS GPU | Handoff max | rAF max |
|---|---:|---:|---:|---:|---:|
| checkpoint default (2 × 4 ms) | 160–164 | 70.5% | 85.6% | 11 ms | 10 ms |
| previews off | 195–197 | 88.8% | 92.3% | – | 10 ms |
| 3 × 8 ms | 174–176 | 79.6% | 93.4% | 26–40 ms | 10–20 ms |
| previews off, 6 × 16 ms | 204 | 94.3% | 97.3% | – | **70 ms** |
| previews off, 6 × 16 ms, 1440p | 54 | 95.2% | 98.0% | – | 90 ms |
| unclamped wake only (default queue) | 169 | 76.3% | 91.7% | 11 ms | 10 ms |
| previews off, time queue 6–14 ms + unclamped wake | 202–206 | 91.5–92.3% | 95–96% | – | 10 ms |

Findings:
1. On this driver, the default's previews are perfectly regular; the problem is utilization.
2. Utilization is lost in two places: (a) the queue drains between fence polls because recursive
   `setTimeout(1)` is clamped to ~4 ms; (b) each preview `transferToImageBitmap` costs ~5–6% OS.
3. Deep queues raise utilization but delay the **browser compositor's own GPU work**: the page's
   animation callbacks miss frames (rAF max 70–100 ms) even with previews off. So the queue must
   stay small in GPU *time* and be refilled promptly, not just be deep.
4. Late previews in deeper queues are fixable with a longer playout delay (`?delayMs=`); after that,
   remaining gaps come from missed compositor frames (finding 3).
5. A ~4% gap remains even with previews off and any queue depth (204 FPS plateau). Not yet explained.

Dev-only additions: `?trace` (per-preview timestamps into `window.benchTrace`), `?preview=off`,
`?delayMs=`, `?queueMs=` (time-based queue cap; use with a higher `?inflight=`). The worker's
full-queue wake now goes through a timer scheduled from a message task (not clamped).
Profiler: `GPU_BUSY_CMD`, `BENCH_QUERY`, `BENCH_OUT`, `BENCH_LABEL`, steady-state stats, gap-by-second.

Next: reboot; confirm KDE and the browser are on the NVIDIA GPU natively; re-run control and
`?inflight=8&queueMs=10` with previews on; then attack the preview cost (persistent swap chain via
`transferControlToOffscreen`, drawing to the default framebuffer only on preview frames) and the
residual ~4%.

---

## Earlier checkpoint (Codex, 2026-11-07)

Updated: 2026-11-07. Checkpoint branch: `perf/neon-stutter-checkpoint`.

## Critical remote divergence discovered at close

The initial checkout used locally cached `origin/perf/neon-cpu-overhead` at
`751c52b` (3.0.1). A fetch was not performed before testing. At push time, the
remote was found at `2607a6f`, a separate 3.0.2 checkpoint with its own
`docs/plans/neon-pacing/STATUS.md` and `PLAN.md`. **Today's measurements do not
validate or reject that 3.0.2 checkpoint.** Several ideas overlap with it.

To preserve the exact version tested here and avoid overwriting remote work, this
session is saved on `perf/neon-stutter-checkpoint`. The original performance branch
is untouched remotely. Next agent: fetch and read BOTH handoffs before any new
experiment. Compare code and reconcile deliberately; do not blindly merge queue
constants or infer acceptance from either checkpoint. The user asked to close the
session, so no combined-code testing or deployment was attempted.

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
