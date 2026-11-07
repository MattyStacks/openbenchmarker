# Follow-up plan: smooth Neon at low settings without losing GPU utilization

## Goal and constraints

Continue from the selected partial improvement described in [STATUS.md](STATUS.md).
Primary target: visible Low/720p on the affected machine, then Low/1080p and Medium.
Motion must be consistently paced while render throughput remains uncapped and GPU
utilization stays strong. A smooth 30 or 15 FPS matters too, but heavy presets are
regression coverage, not a replacement for fixing low-resolution/low-settings runs.
The issue also occurred on other machines; keep code portable and validate there
when access exists. Do not require driver changes, fixed refresh rates, a blanket
60 FPS rendering cap, or hardware-selected benchmark workloads.

## Establish a trustworthy baseline

1. Read `docs/performance/neon-cpu-overhead.md` and the JSONL results archive.
   `baseline` is original 751c52b; `runtime` is the selected final candidate. Other
   labels are rejected/control experiments. Keep the selected code as the control.
2. Use locked dependencies and an accelerated visible browser with its native
   viewport. `BENCH_HEADED=1 BENCH_REPEATS=3 node scripts/profile-run.mjs` runs the
   default Low/720p/30-second trials against a local server on port 5179. Verify
   the renderer inside the benchmark result, not merely the probe context.
3. Capture three unchanged controls before edits. Record whole-run and steady-state
   pacing separately, including the adaptation transition. The profiler currently
   exports only aggregate intervals: add timestamped samples so later analysis can
   distinguish startup settling, recurring gaps, and isolated stalls.
4. Record GPU-specific OS utilization when available. This NVIDIA/nouveau device
   lacks AMD's `gpu_busy_percent` file; do not sample the integrated AMD GPU instead.
   Preserve Matt's observed utilization separately when no counter can be captured.

## Investigate the remaining presentation delays

- Add development-only tracing for preview request/sample time, worker receipt,
  submission, fence completion, bitmap delivery, queue deadline, and actual handoff.
  Include cadence changes and generation resets. Correlate gaps before choosing
  another queue depth, delay, or cadence threshold. Keep diagnostics out of saved
  result schemas unless a concrete user-facing need is established.
- Check whether sampled scene timestamps remain evenly spaced when callbacks miss
  slots. The current request crosses a slot but samples the actual callback time;
  canonical slot timestamps or bounded look-ahead requests are **untried hypotheses**,
  not established fixes. Test camera progression as well as handoff intervals.
- Check refresh estimation under sustained missed callbacks: a physical 120 Hz
  display sometimes reports 60 Hz. Distinguish overload from a real monitor change
  without oscillating cadence or repeatedly discarding the presentation buffer.
- Inspect deadline selection and generation resets at cadence transitions. Ensure
  future images stay queued, obsolete images are released, and adaptation itself
  does not introduce a long blank interval. Do not equate fewer dropped images
  with smoother delivery: the original queue reported zero drops despite long gaps.
- Keep fence/submission and GPU-process image-creation waits separate. A traced Low
  run showed shared-image creation up to 7.5 ms wall time with little CPU time.
  This is a lead, not proof of a driver-specific cause. `BENCH_TRACE=/tmp/neon-trace`
  writes Chrome trace JSON; tracing is intrusive and not performance acceptance.
  The previous 332 MB trace remains only in `/tmp/neon-trace-0.json` on this machine.

## Avoid repeating rejected experiments blindly

- One batch globally: regular presentation but Low utilization collapsed (~52–56%
  timer coverage; Matt confirmed poor OS utilization). Heavy-only queue limiting
  is retained, but requires further acceptance testing.
- Faster polling via message tasks: improved timer coverage (~95%) but did not
  solve Low presentation; final code uses original polling.
- Warm-up-only preview backoff: misses overload appearing in the timed phase.
  Retaining the initial render-derived divisor accidentally selected 17 previews/s;
  final code retains only presentation backoff and has a regression test for this.
- Direct canvas, retained drawing buffer, async snapshots, and PBO readback: no
  acceptable pacing/utilization combination. Matt explicitly rejected their low
  utilization. Direct variants have no bitmap-handoff metrics; zero means unmeasured.
- `desynchronized`: requested on the direct WebGL context, but this browser returned
  false. Never claim the mode was active. No production dependency on that hint.
- Native Wayland, installed Helium, main-thread renderer, disabling GPU queries,
  and removing HUD backdrop blur did not isolate a complete fix. Vulkan launch flags
  failed to create accelerated WebGL. These are controls, not user configuration fixes.

## Validation and completion

Make one attributable change at a time. Keep only changes supported by repeated
measurements and visible review. For Low/720p require fewer recurring long gaps
and more regular scene progression, with no material throughput or OS utilization
regression beyond unchanged-control variability. Report preview FPS separately
from render FPS; a 200 FPS render result does not mean 200 displayed images/s.

Then check Low/1080p, Medium, and a heavier configuration producing roughly 15–30
render FPS. Include simulated 15/24/30/40/59 FPS and 60/90/120/144/165/240/400 Hz,
missed callbacks, jitter, a real refresh change, startup stalls, runtime overload,
abort/resize/visibility, bounded image cleanup, and deterministic stress laps.
Run unit tests, production build, accelerated worker/browser regressions, and share
checks. Test the exact final combination, not just its components. Update STATUS
and the investigation with evidence and explicit limitations; decide the next
patch version before publishing. Do not deploy an unresolved experiment as a fix.
