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

## Initial profiling-only outcome (superseded below)

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

## Local accelerated testing (2026-11-06)

All seven Playwright end-to-end tests passed. Default headless Chromium uses
SwiftShader; this validates behavior only. Full Chromium with local launch flags
`--ignore-gpu-blocklist --enable-gpu --use-gl=angle --use-angle=gl` used
`ANGLE (AMD, AMD Steam Machine (radeonsi navi33 ACO), OpenGL ES 3.2)` with
GPU timer queries. Flags were supplied in a temporary script, not repo config.

Three Low/720p lab trials (60 frames at each of eight scene points) reported:

| Trial | GPU ms | CPU render ms | Update ms | Submission ms | Draw calls |
|---|---:|---:|---:|---:|---:|
| 1 | 0.53 | 0.35 | 0.03 | 0.32 | 39.83 |
| 2 | 0.53 | 0.35 | 0.03 | 0.32 | 39.83 |
| 3 | 0.53 | 0.36 | 0.03 | 0.33 | 39.83 |

These are lab samples, not complete timed benchmark runs or measured FPS.
The browser is Chromium 153, not the supplied report's Brave 157.
Submission timing includes possible driver backpressure; it is not pure CPU
computation. No optimization or multi-core speedup is established by these tests.
Cloudflare deployment deferred at Matt's request.

Three Extreme/4K trials (15 frames per scene point): GPU 52.94/52.88/52.96 ms,
CPU render 39.22/39.18/39.19 ms, update 0.60/0.66/0.58 ms,
and 108.07 draw calls/frame. GPU time dominates this heavy preset.

## Workload and scheduling investigation (continued)

Matt authorized lower FPS and a new fixed workload to prioritize GPU scaling.
Initial headless 30-second Low/720p runs (Chromium 153, accelerated AMD OpenGL) measured:

- Original workload/default queue: 1742 and 1737 FPS, GPU timer coverage 82.7%.
- Original workload/six queued 8 ms batches: 1865 and 1861 FPS, coverage 87.1%.
- Original workload/six queued 16 ms batches: 1913 FPS, coverage 90.3%.
- Disabling timer queries: 1697 FPS; no evidence that queries caused the gap.
- A separate early queue experiment was invalidated by tab visibility and excluded.

The scene-update cost was around 0.025 ms/frame. The observed gap responds to
submission batching, so attributing it entirely to a slow CPU or animation is
incorrect. The 9800X3D/2080Ti case remains remotely reported, not locally measured.

A 24-step volumetric floor alone did not meet the goal: 334 FPS and 88.8% timer
coverage with six 8 ms batches. A 64-step floor plus six 16 ms batches reached
146 FPS / 92.1% coverage. The last 25 seconds of OS samples for that run were
91–100%, averaging 94.26%; including setup in the average understates utilization.
Timer coverage and OS utilization are distinct measurements.

## Implemented candidate and visible-browser controls

Version 3.0.0 uses fixed 64-step volumetrics on every preset. It never selects work
based on detected hardware, and scores are not comparable with 2.x. Rendering,
scene updates and GPU queries run in a dedicated worker. The UI receives completed
bitmaps, presents the newest one on animation callbacks and requests previews at
up to 60 Hz. Render throughput remains uncapped. A compatibility path remains for
browsers without worker/bitmap support.

Batch sizing uses recent GPU times, or a smoothed window without timers, rather
than noisy individual fence intervals. Three batches target 8 ms GPU work each;
CPU tasks have a separate 8 ms budget. Phase transitions wait for outstanding
fences without blocking the main thread. Deep queues increased presentation
latency in experiments and were not retained. More workload alone (128 steps)
did not solve the presentation issue; 64 steps were retained.

The first visible profiling harness forced a viewport larger than the actual
window, hiding HUD controls. The harness now uses the native viewport in visible
runs. Matt reviewed the updated run and confirmed smoother motion and correct
layout. Animation callback timing alone is not proof of displayed-frame pacing.

Controlled native-window Chromium 153, same accelerated AMD backend, Low/720p,
30 seconds, OS GPU counter sampled every 500 ms during the timed phase:

| Build | Render FPS | GPU timer coverage | OS utilization mean / min / max | Animation callback p95 / max |
|---|---:|---:|---:|---:|
| Original 2.2.0 | 2014.2 | 96.13% | 99.67 / 80 / 100% | 8.4 / 16.8 ms |
| Candidate 3.0.0 | 152.0 | 97.48% | 99.90 / 94 / 100% | 8.4 / 16.6 ms |

These controls do **not** reproduce the original reported sustained utilization
loss: the original also averages nearly 100% in visible Chromium. The earlier
headless differences must not be presented as a definitive diagnosis of the
user's visible-browser issue. The changes reduce scheduling interference and
increase fixed GPU work, but the original cause remains incompletely isolated.
Matt reports the other affected system used Windows Edge on a 9800X3D / 2080 Ti;
the behavior is therefore not exclusive to Brave. That system and a 5080 have
not been measured locally. No all-hardware utilization guarantee is established.
Cloudflare deployment remains deferred at Matt's request.

A second controlled pair used installed Brave 157 with a fresh isolated profile,
its default GPU settings (no forced ANGLE flags), native viewport, and the same
Low/720p/30 s settings. Original 2.2.0: 2026.8 FPS, 96.63% timer coverage,
OS mean 99.35% / min 61% / max 100%. Candidate 3.0.0: 154.1 FPS, 97.53% timer
coverage, OS mean 99.90% / min 94% / max 100%. Each had 60 OS samples and animation
callback p95 8.4 ms / max 16.7 ms. The original's single low sample did not amount
to sustained low utilization. The original report is still not reproduced under
these clean-profile conditions; neither browser identity nor CPU speed alone is
established as the cause. Candidate reported no UI stalls, render stalls or hitches.

The portable profiler supports `PW_CDP_URL` for an externally started test browser,
`BENCH_HEADED=1` for native-window profiling, and optional `GPU_BUSY_FILE` for an OS
counter. Use an isolated browser profile when attaching through CDP. CPU total-use
percentages need not match across systems with different core counts; compare
render throughput, GPU time and completion variability under identical workloads.

## Candidate verification

Production build and 281 unit tests passed. All 14 accelerated Chromium browser
tests passed, including worker abort/resize/visibility invalidation and visible
output/HUD bounds for Medium through Extreme. Thirty desktop/mobile sharing
checks passed. The completed Low runs above cover valid completion. These checks
do not establish Windows/NVIDIA performance or cross-GPU score ordering.

## 3.0.1 preview pacing follow-up

Matt's 9800X3D / 2080 Ti result used Chrome 156 on Nobara Linux, with
`ANGLE (Mesa, zink Vulkan 1.4(... NVK TU102 ...), OpenGL ES 3.2)`.
It reported 214.4 render FPS, 97.9% GPU timer coverage, 0.03 ms scene updates,
18 hitches, 89.2 FPS 1% low and a 14.5 ms worst frame. This is not the earlier
Windows Edge environment. Both displays Matt was using were 120 Hz; the solution
must also account automatically for other refresh rates, including 90/144/240/400.

The previous profiler only timed animation callbacks. Instrumenting actual
`transferFromImageBitmap` calls exposed irregular image delivery even when those
callbacks were regular: the 3.0.0 local Brave baseline had image interval median
16.7 ms, p95 25 ms, max 33.3 ms; callbacks had p95 8.4 ms. Render throughput was
155.3 FPS. Thus high throughput and zero UI stalls did not establish smoothness.

The candidate requests previews on display callbacks and picks an integer divisor
of the measured refresh rate during warm-up, allowing 10% throughput headroom.
For example, 400 Hz with 215 render FPS selects every third callback; 120 Hz with
155 render FPS selects every callback. It never caps benchmark submission or
changes the preset's geometry/shader work based on refresh rate.

Preview images sample animation at their request timestamp. A bounded buffer holds
completed images until their target display callback, at least 50 ms later,
rounded to complete preview intervals. Deadline selection uses integer callback
indices, avoiding floating-point time boundaries and millisecond jitter. Pending
requests and completed previews are retained rather than unconditionally replaced
by the newest image. Monitor refresh changes recalibrate the cadence and invalidate
old presentation requests; timed benchmark statistics remain independent.

Preview intervals, rate, dropped images and GPU-only hitch counts are now exported.
These are canvas handoffs, not physical monitor scanout. An ANGLE parser bug was
also corrected: a nested `Zink Vulkan` driver name no longer overrides the outer
`OpenGL ES 3.2` backend. Mesa identifies NVK as its NVIDIA Vulkan driver and Zink
as OpenGL over Vulkan; this does not prove that either caused Matt's stutter.
References: https://docs.mesa3d.org/drivers/nvk.html and
https://docs.mesa3d.org/drivers/zink.html .

The final defaults reduce queued batches from three to two and their GPU target
from 8 ms to 4 ms (CPU task budget remains 8 ms). Display-paced previews with the
old queue still had delayed animation callbacks; shortening the GPU queue improved
the measured handoffs without a material throughput or utilization loss locally.

Two final native-window Brave 157 runs, 120 Hz display, Low/720p/30 s:

| Trial | Render FPS | Preview handoffs/s | Handoff interval p95 / max | OS GPU mean / min / max |
|---|---:|---:|---:|---:|
| 1 | 152.15 | 120.00 | 8.5 / 10.2 ms | 99.45 / 77 / 100% |
| 2 | 151.75 | 120.00 | 8.5 / 9.8 ms | 99.88 / 99 / 100% |

Neither trial dropped a preview from the presentation queue. The first trial still
had an isolated 77% OS sample; this is not a guarantee against every sampled dip.
The profiler samples across timed-phase notification and completion boundaries;
these aggregate samples cannot locate that dip precisely within GPU execution.
Physical scanout and the remote NVK system remain unverified. No claim of universal
stutter elimination is made. The fixed 64-step GPU workload is unchanged in 3.0.1.
Preview cadence is inferred from callbacks, not a monitor identification API.

Automated checks cover 60/90/120/144/165/240/400 Hz with rendering above and below
refresh, refresh changes, jittered image completion, missed deadlines, bounded
resource cleanup, 400 Hz buffering, export fields and the Zink backend parser.
The production build and 317 unit tests passed.
All 14 accelerated browser regression tests and 30 desktop/mobile sharing checks
also passed before redeploying the branch preview.
