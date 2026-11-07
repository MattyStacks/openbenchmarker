# Resume on the affected machine

## 1. Establish an honest baseline

Check git status first; do not overwrite local edits. Fetch/switch/pull
`perf/neon-cpu-overhead` (fast-forward only), then read STATUS.md and CLAUDE.md.
Install locked dependencies with `npm ci` if necessary. Run `npm run build`,
`npm test`, then `npm run dev -- --host 127.0.0.1 --port 5180`.
Do not install/change GPU drivers or force a different backend before capturing the
actual failing environment. Record OS, browser version, renderer, display refresh,
VRR, compositor/session type, driver/Mesa version and power state.

Use a visible native browser window. Headless results and animation callbacks alone
are not visual acceptance. Keep resolution, preset, duration, viewport, foreground
state and background activity identical. Start with Low/720p/30 s, at least two runs.
Save JSON (full diagnostics), YAML, and synchronized GPU utilization if available.
Ask Matt to judge visible smoothness. Do not infer physical scanout from canvas calls.

## 2. Compare controlled builds, one variable at a time

Use separate worktrees/checkouts for `99b08c6` (3.0.0), `751c52b` (3.0.1), and current
candidate. Give Vite separate caches if dependencies are shared. Never run GPU trials
concurrently. Reconfirm the 3.0.1 regression first, then test the candidate defaults.

The portable `scripts/profile-run.mjs` supports `BENCH_URL`, `BENCH_REPEATS`,
`BENCH_HEADED=1`, `BENCH_PRESET`, `BENCH_RES`, `PW_CHANNEL`, and `PW_CDP_URL`.
CDP is useful for the installed browser with an isolated test profile; don't attach
to or modify Matt's everyday profile. Keep platform/browser flags in local env,
not committed config. `GPU_BUSY_FILE` is an optional OS counter path, not portable
NVIDIA monitoring. Use an available GPU-specific monitor on the affected machine.
Do not mistake CPU total utilization or GPU timer coverage for OS GPU utilization.

If needed compare candidate `?inflight=2` versus default three, keeping the GPU
batch target at 8 ms. `?gpuBatch=4` is another independent dev-only override.
Do not change both settings simultaneously and attribute the result to one.
Capture actual timer wake delays there as well as queue occupancy/completion gaps.

## 3. Diagnose the remaining gap before another production redesign

- GPU-only hitches vs batch-derived hitches: query completion timing is not necessarily
  physical execution timing. Zero GPU-only hitches does not pinpoint CPU/driver cause.
- `display_callback_fps/p95/max` vs `preview_fps/interval/lateness/dropped`: determine
  whether callbacks are missing, frames arrive late, or buffering/scheduling loses them.
- Capture a browser Performance trace including workers and rendering/compositor events
  on the affected system. Inspect bitmap transfer/allocation and GPU-process contention.
- Verify the corrected timer task boundary avoids 4 ms recursive polling there.
- Verify missed callbacks expire stale previews, and the conservative divisor reduction
  settles instead of oscillating. Check refresh-change handling and VRR explicitly.
- If necessary, perform a local diagnostic-only preview-disabled comparison, clearly
  excluding it from valid/public benchmark results. That isolates presentation overhead
  without quietly changing the scored workload. Such a mode is not implemented yet.
- If comparing driver/backends later, preserve the original failing setup and treat it
  as a separate experiment; do not declare NVK the cause from its name alone.

## 4. Acceptance, regression checks and publication

Keep GPU shader/geometry work identical across machines and preserve valid frame
accounting/phase boundaries. Avoid endless GPU queue growth or CPU busy-spinning.
Preview throttling must never cap scored render throughput. Validate release of every
queued ImageBitmap on abort, context errors, cadence resets and normal completion.

After an observed improvement on the affected GPU, test other presets/resolutions,
repeated runs, abort/resize/tab-hide, and main-thread compatibility fallback. Test
available refresh rates physically; synthetic cadence tests are not proof of smooth
240/400 Hz scanout. Record any untested systems rather than claiming universal success.
Run `npm test`, `npm run build`, accelerated `npm run test:e2e` with explicit local
browser configuration and `BENCH_GPU_TESTS=1`, and `npm run check:share`.

Commit measured findings with the final implementation, push the branch, then update
`npm run preview:deploy -- neon-cpu-overhead` after local affected-machine acceptance.
Verify both preview URLs serve the intended bundle/version. Do not deploy production
or merge automatically. Update STATUS.md so the next machine sees the same state.
