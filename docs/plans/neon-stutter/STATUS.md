# Neon stutter: status and handoff

## Heavy-frame utilization, 2026-11-08 (Claude), branch `perf/neon-stutter-2`

Matt confirmed Low/720p looks smooth natively. He reported 1080p GPU utilization as too low:
the checkpoint ran any frame longer than `gpuBatchMs × inFlight` (8 ms) one at a time, which
leaves ~1.7 ms idle between frames. Results (dev server, one visible window, 100 Hz):
[neon-2026-11-08-heavy-results.jsonl](../../performance/neon-2026-11-08-heavy-results.jsonl).

Tried (labels in the results file):
- Two heavy frames in flight (`heavyInflight=2`; flag since removed): 100% busy, but for 22–25 ms frames
  preview p95 30→42 ms / 40→49 ms and page rAF max 30–40 ms. Chromium runs compositor work in the
  same GPU queue, so it waits behind a queued frame.
- Four in flight: 40–54 ms preview gaps even at Low/1080p.
- Lead submission (`leadMs`, queue the next frame when the estimated outstanding GPU time < lead):
  clean and 100% busy up to ~12–13 ms frames; 16 ms frames intermittent (one of three runs with
  cadence drop or 50 ms gap); 20+ ms frames degrade pacing like two in flight.
- Close polling near the estimated finish (`spinMs`): halves the gap for one-at-a-time frames
  (Ultra/1440p 94→97.5%), clean pacing.

**New defaults** (`run.ts`: `LEAD_MS` 4, `LEAD_MAX_FRAME_MS` 14, `SPIN_NEAR_MS` 3; dev overrides
`?leadMs= ?leadMaxMs= ?spinMs=`, 0 disables): heavy frames ≤ 14 ms use lead submission (2 in flight),
longer ones run one at a time with close polling. Light frames unchanged.

| Config | Before | New default |
|---|---|---|
| Low/720p ×2 | 100% busy, 205–214 FPS | 100%, 205–209, clean |
| Medium/720p | 100%, 177 | 100%, 175, one 22 ms gap (one-offs seen before too) |
| Low/1080p | 86–88%, 85 | **100%, 92**, clean |
| High/1080p | 90%, 76 | **100%, 80**, clean |
| Extreme/1080p (16 ms) | – | 94%, 56, clean |
| Medium/1440p | – | 98%, 47, clean |
| Ultra/1440p | 94%, 41 | 97.5%, 42, clean |

Open: frames between 14 and ~20 ms still lose 2–6%. The 14 ms cut-off is fixed rather than
refresh-relative and was only tested at 100 Hz; check on 60/144 Hz and on AMD/Intel.
Next: Matt checks the preview visually at 1080p, then test on another machine.

---

## After the reboot, 2026-11-08 (Claude), branch `perf/neon-stutter-2`

KDE (kwin_wayland, plasmashell, Xwayland) and Chromium now run natively on the 2080 Ti
(NVIDIA 595.112.07, ANGLE GL ES 3.2). No PRIME-offload env or `--ozone-platform=x11` needed.
Code unchanged from `aa112d8` (checkpoint + unclamped worker wake). Results:
[neon-2026-11-08-native-results.jsonl](../../performance/neon-2026-11-08-native-results.jsonl)
(30 s, one visible window, 100 Hz, OS = nvidia-smi steady mean).

| Config | Render FPS | Timer | OS GPU | Previews/s | Handoff p95 / max | Steady gaps > 2× |
|---|---:|---:|---:|---:|---:|---:|
| Low/720p default ×4 | 205–214 | 97.7–97.9% | 100% | 100 | 10.1 / 11–20 ms | 0–1 |
| Low/720p previews off | 204 | 97.7% | 100% | – | – | – |
| Medium/720p ×3 | 177–178 | 97.6% | 100% | 100 | 10.1 / 11–40 ms | 0, 0, 5 (one run) |
| Low/1080p | 85 | 85.0% | 88.2% | 50 | 20.1 / 27 ms | 0 |
| Medium/1080p | 77 | 87.0% | 90.3% | 50 | 20.1 / 21 ms | 0 |

Findings:
1. Low/720p on this machine now looks solved by these measures: full GPU utilization and previews
   at every refresh with no recurring gaps. Previews cost nothing measurable (default ≥ previews off).
   The pre-reboot preview cost and the ~4% residual gap came from the XWayland/PRIME-offload
   path and don't apply to native runs. Matt hasn't checked it visually yet.
2. The one Medium/720p outlier had gaps at seconds 5 and 28 and a 30 ms page animation
   callback, so the compositor missed frames too. Didn't repeat in two more runs.
3. **Remaining problem: heavy frames lose ~10–12% utilization.** At 1080p each frame is longer
   than the queue budget, so the checkpoint's heavy-frame rule drops to one in-flight batch.
   Previews stay even (cadence divisor 2, 50/s) but the GPU idles between batches.
4. This is one machine and one driver. The issue was also reported on other machines, so this
   is not acceptance.

Next: Matt checks Low/720p visually. Then fix the heavy-frame utilization loss, e.g. use the
time-based queue cap (`?queueMs=`) instead of the one-batch rule, and test Low/1080p with
`?inflight=4&queueMs=…` for utilization and compositor rAF max. Then test on another machine
(AMD/Intel) through a preview deploy.

---

## Before the reboot, 2026-11-08 (Claude), branch `perf/neon-stutter-2`

Continues from the checkpoint below. All numbers in this section were measured before the reboot,
via XWayland + PRIME offload; native runs above supersede them.

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
