# Neon pacing handoff

## Start here

Matt stopped tuning on this machine and requested a commit and a plan so Codex can
continue **on the affected 9800X3D / RTX 2080 Ti machine**. Read this file and
[PLAN.md](PLAN.md). Continue branch `perf/neon-cpu-overhead`; preserve local changes.
The problem is **not solved**. Do not claim local AMD improvements prove an NVIDIA fix.

## Repository and deployment state

- `99b08c6`: version 3.0.0. GPU worker + heavier fixed workload. Remote GPU utilization
  improved, but Matt still reported bad stutter.
- `751c52b`: version 3.0.1. Adaptive preview/buffering and shorter GPU queue.
  **Regressed badly on the affected machine.** This remains the deployed preview.
- Current branch checkpoint: **3.0.2 candidate, not deployed**, with timer and preview
  clock corrections. Keep this distinction when comparing results.
- Preview: https://neon-cpu-overhead.opengpubenchmarker.com
- Alternate: https://neon-cpu-overhead-openbenchmarker.mattys.workers.dev
- Production has not been updated. Cloudflare login/deployment was authorized, but
  this checkpoint is a handoff, not an accepted fix to publish as working.
- Unrelated local `package.json` / `package-lock.json` Copilot/allowScripts changes
  on the first machine were deliberately excluded from commits.

## Affected environment and acceptance

Latest reports: Nobara Linux 44 KDE, Chrome 156, Ryzen 7 9800X3D, RTX 2080 Ti Rev. A,
64 GB DDR5-6000, display 120 Hz. Detected renderer:
`ANGLE (Mesa, zink Vulkan 1.4(NVIDIA GeForce RTX 2080 Ti (NVK TU102) (MESA_NVK)), OpenGL ES 3.2)`.
Earlier Windows Edge behavior was also reported, but the exported 3.x runs are Linux.
VRR state is still unknown. Do not assume the NVIDIA proprietary driver is in use.

Matt wants high GPU utilization AND smooth preview motion, across presets, CPUs,
GPUs and refresh rates (90/144/240/400 Hz included). He accepts lower render FPS if
needed, but not stutter or hardware-dependent scoring tricks. Shader/preset work
must stay fixed across machines. Render FPS is distinct from preview handoff FPS.

| Low / 720p / 30 s on affected machine | 3.0.0 | 3.0.1 |
|---|---:|---:|
| Render FPS | 214.4 | 193.6 |
| GPU timer coverage | 97.9% | 89.2% |
| GPU ms/frame | 4.57 | 4.61 |
| CPU ms/frame | 0.23 | 0.26 |
| Scene update ms/frame | 0.03 | 0.03 |
| 1% low | 89.2 | 79.3 |
| Worst frame ms | 14.5 | 16.8 |
| Hitches | 18 | 58 |
| GPU-only hitches | not exported | 0 |
| Preview FPS | not exported | 77.1 |
| Preview interval p95 / max ms | not exported | 18.9 / 77.1 |
| Preview lateness p95 ms | not exported | 45.9 |
| Preview dropped | not exported | 0 |

GPU time barely changed; elapsed time and preview pacing worsened. This supports a
scheduling/presentation gap, not proof of slow scene animation or a specific driver fault.

## What the unshipped candidate changes

1. Worker full-queue polls wake through a MessageChannel after a 1 ms timeout, instead
   of recursively scheduling timers. Direct recursion measured median/p95 4.1/4.3 ms
   locally; the corrected task boundary measured 1.1/1.2 ms. HTML nested timer clamping
   is real; its exact contribution on the affected machine is still unmeasured.
2. Restores defaults to **three queued batches / 8 ms GPU target**, from 3.0.1's
   two / 4 ms. CPU task budget remains 8 ms. Presets still use 64 haze steps.
3. Preview clock advances by elapsed refresh slots, not just callback count. It drops
   stale buffered images after missed callbacks and requests one current image rather
   than replaying stale requests or issuing a catch-up burst.
4. Sustained missing callbacks trigger one conservative preview-divisor increase.
   This heuristic is tested synthetically but needs affected-machine validation.
5. Exports display callback FPS/p95/max separately from image-handoff measurements.

## Latest local evidence (AMD Steam Machine, NOT the affected GPU)

Current 3.0.2 defaults, three / 8 ms: 155.07 render FPS, OS GPU mean 99.9%,
112.23 preview FPS, preview p95/max 15.4/25.9 ms, 110 dropped previews.
That is NOT smooth 120 Hz acceptance, even though utilization is high.

Same candidate with development `?inflight=2` (still 8 ms, NOT 3.0.1's 4 ms):
154.46 render FPS, OS GPU samples all 100%, 120.00 preview FPS, p95/max 8.5/10.6 ms,
zero dropped previews. **This is an experiment, not the committed default**.
Do not choose queue depth solely from this AMD result again.

History and caveats: [investigation](../../performance/neon-cpu-overhead.md).
The current candidate passed `npm run build` and all 321 unit tests. 3.0.1 previously passed
317 unit tests, 14 accelerated browser tests, and 30 sharing checks but failed remote
acceptance. Browser/share regression checks have NOT yet been rerun for 3.0.2.
