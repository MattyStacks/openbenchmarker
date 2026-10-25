# Ashen Horizon: plan index and shared rules

Ashen Horizon is a second benchmark for Open GPU Benchmarker, "A WebGPU Benchmark Experience". The
camera follows a smooth, cinematic drone path (no player controls) through five beats:

1. a desolate highway
2. a ruined gas station
3. a dark tunnel
4. the approach to a ruined city
5. the city core

It is built to push modern GPUs with dense instancing, volumetrics, compute effects, dynamic
lighting and, on Ultra and Extreme, software ray tracing. It lives on the existing site next to Neon
Flythrough and shares its settings, results, export and share features.

**Storyboard:** `docs/reference/ashen-horizon/storyboard.png`. Every plan that builds a beat or a UI
element from the storyboard should look at it.

## How to use these plans

Each `Pxx-*.md` file is one self-contained plan that **merges and deploys to production on its own**.
Feed one at a time to Claude Code:

> Read `docs/plans/ashen-horizon/README.md` and `docs/plans/ashen-horizon/<plan file>`. Plan and implement **only that plan**.
> Follow the shared rules, invariants and Definition of done in the README. Read the files the plan
> lists before planning. If the code differs from what the plan says, the code wins; fix the plan
> docs in the same PR.

Plans run in index order unless the index says otherwise. **P20 is required and runs right after
P14, before P15.** P21 and P24 are optional and can be
skipped or done after launch.

## Release model: no big-bang release

- **Every plan ships.** Each one merges to `main` and runs `npm run deploy` once its Definition of
  done passes. There is no waiting for one giant release.
- **One branch and one Cloudflare preview per plan**, as done before for `feature/share-results` and
  `feature/stress-tests`:
  1. Branch from the latest `main`: `feature/<plan-slug>`, e.g. `feature/p04-benchmarks-hub`. Each
     plan file lists its branch name.
  2. Build and test on the branch, then deploy its own Worker Preview:
     `npm run preview:deploy -- <plan-slug>`. It is served at `https://<plan-slug>.opengpubenchmarker.com`
     and `https://<plan-slug>-openbenchmarker.mattys.workers.dev`, and never touches production.
  3. Test on real devices against that preview URL. Matt approves.
  4. Open a PR into `main`, merge, then run `npm run deploy` from `main`.
  5. Delete the preview (`npx wrangler preview delete --name <plan-slug>`) and the branch.
  - Branches are short-lived: one plan each, and never stacked on an unmerged branch. If a plan
    depends on another, the earlier one merges first.
  - A preview is a different origin, so it has its own localStorage. Seed test results there; it
    doesn't see production's.
- **Neon Flythrough stays live and unaffected the whole time.**
- **Ashen Horizon goes through three statuses**, set in the benchmark registry (P02):

  | Status | Set by | What visitors see |
  |---|---|---|
  | `hidden` | P08 | Nothing. The code is deployed but not linked. Open it with `?preview=ashen-horizon` (or in dev builds) to test on real devices. |
  | `preview` | P14 | A hub card with a **Preview** badge. Runs, saves, JSON/CSV export and sharing all work. Labelled "Preview vX". No Score tests, no YAML submission, and not comparable across preview versions. |
  | `live` | P23 | Version 1.0.0 with a **New** badge. Score tests, stress tests and YAML submission are on. |

- **Lazy loading.** Ashen Horizon (with `three/webgpu`) is a separate chunk loaded only when a visitor
  opens it. Neon visitors never download it, and work-in-progress Ashen code can't affect Neon's bundle
  or timing. P09 records Neon's bundle size, and later plans must not grow it.
- **Versioning.** Ashen starts at `0.1.0` (P08). Any plan that changes its rendered output or its
  measurement bumps the minor version. `1.0.0` comes at P23. Neon keeps its own version line
  (currently `2.2.0`).
- **Preview playback.** While some beats are still unbuilt, a run plays the built beats in timeline
  order and loops to fill the duration. P11 confirms the details.
- **Every plan must be revertable on its own.** No plan may leave the site half-migrated. If something
  isn't usable yet, it stays `hidden`.

## Definition of done (every plan)

1. `npm run build`, `npm test` and `npm run check:share` are green.
2. The Neon golden files from P01 are byte-identical. No plan may change Neon's exports, except P20,
   which adds per-scene CSV columns once, deliberately, with the reason documented.
3. **Branch preview:** the work is on the plan's own branch, deployed with
   `npm run preview:deploy -- <plan-slug>`. Check `https://<plan-slug>.opengpubenchmarker.com` on an
   iPhone (Safari) and one desktop browser:
   - a Neon run, its results page, Share, Copy link, Save image and the exports
   - Ashen Horizon in its current status, opened with `?preview=ashen-horizon` while `hidden`
4. **Merge and deploy:** PR into `main`, merge, `npm run deploy` from `main`, then delete the preview
   and the branch.
5. Docs are updated: affected README sections, `docs/share-links.md`,
   `docs/upstream-submission-changes.md`, `TODO.md`, and this folder (mark the plan done in the index).
6. Nothing half-finished is visible to the public.

## Invariants (non-negotiable)

1. **Exports stay.**
   - YAML (`toYaml`, with `# assumed, not confirmed` markers and the `validateSubmission` gate), JSON
     (`toJson`), CSV (`toCsv`, per result and CSV-all) and `gamesYamlEntry` all keep working for every
     benchmark.
   - Neon output is byte-identical throughout (P01 goldens).
   - File naming stays `result_<date>_<gameId>.<ext>`.
2. **Saved history stays.**
   - `ogb.results.v1` and `ogb.config.v1` keep their keys and shape.
   - Old results load, display, export and share.
   - New fields are optional, and a missing field means the Neon/WebGL default.
3. **Share links may change until launch.** The site is new, so the link format can be replaced in
   P06 if a better encoding does the job:
   - stateless
   - no server storage
   - QR-friendly length
   - carries everything a shared result, comparison or challenge needs
   Breaking old links is allowed until then. Any change updates `docs/share-links.md` and the share
   tests. **P23 freezes the format**, and from then on links decode forever.
4. **Sharing must never break, even while the format changes.** The share sheet has already dropped
   the link twice (iOS Messages kept only the attached image). For every benchmark and every status:
   - **Every Share button** passes `navigator.share` the **link** (`url`) plus a line of text and
     **never attaches a file**. All shares go through `sharePayload` in `src/app/share.ts`; don't
     add a second share path.
   - **Fallbacks:** with no share sheet, or when it fails, the text and link are copied with a
     confirmation. Cancelling (`AbortError`) shows nothing.
   - **Copy link**, **Copy code** and **Save image** sit next to Share. The card PNG is offered only
     through Save image, and its QR code scans and opens the shared view.
   - **Result, challenge and comparison** links open the right shared view on phone and desktop. A
     tampered link says "damaged or edited". Pasted codes work (`extractShareCode`).
   - **Preview origin:** links use the page's own origin, so preview deploys share preview links.
   - **Gates:** any PR touching sharing, results, routing, the codec or the registry runs `npm test`
     (including `share-keeps-link.test.ts` and `share-codec.test.ts`) and `npm run check:share`,
     extended to cover every benchmark's results page and My Results rows. It also runs the manual
     Test steps in `docs/share-links.md` on an iPhone and one desktop, recorded in the device table.
   - A codec change lands in the same PR as the share UI and tests that use it.
5. **Honest-data rules** (README "Honest-data rules") apply unchanged:
   - User fields start blank, apart from clearly marked, editable best-guess prefills.
   - Browser-detected info is for display and sharing only.
   - Suggested settings and VRAM figures are labelled as suggestions or estimates.
6. **Privacy:**
   - No cookies, no registration, no analytics, nothing sent to a server.
   - Stateless share links. Users control what they submit, and nothing is kept on the site.
   - The `?preview=` flag is read from the URL. It may be remembered in `sessionStorage`, but never in
     a cookie.
7. **No downloads during a run.** Everything is downloaded, generated, built and compiled before
   timing starts.
   - **Procedural first.** Geometry is generated in code by default.
   - **Hand-built 3D models are allowed** wherever they make the benchmark look clearly better: hero
     cars, gas pumps, the station building, signage, tunnel fixtures, landmark ruins and so on. They
     are built **beforehand, in their own plan** (see "3D models" below), never inside a beat plan.
   - **Models are served from this site only**, as static assets with immutable hashed URLs. No
     third-party CDN, so `docs/privacy-audit.md` stays true.
   - **Loading:** models load **before warm-up**, with a progress indicator, and are decoded and
     uploaded to the GPU before timing. A failed download means no run, with a clear message. It never
     produces a result with missing assets.
   - **Size per tier:** Low fetches only low-LOD meshes and small textures, to keep phone downloads
     small. Each plan that adds models records the download size per tier.
   - **Free-tier limits** (Cloudflare Workers static assets): 20,000 files per Worker version and
     25 MiB per file. Asset requests are free and unlimited.
   - Static card thumbnails on the hub are fine; they load with the page, not during a run.
8. **Comparable, not identical.** Runs may vary a little, like a game, as long as FPS on the same
   hardware and settings stays within a tight tolerance.
   - **Within a run, stay deterministic.** Scene state is a pure function of `t`, the seed and the
     route variant (the `onUpdate` contract in `src/engine/ctx.ts`). The seed and the variant are
     recorded in the result.
   - **Across runs, variation comes from the seed only**, never from wall-clock or `Math.random()`.
   - **Variants (optional, P21) must be load-matched:** within ±2–3% of the canonical route's GPU time
     and 1% low. Tighten the tolerance once run-to-run noise is measured.
   - **Score tests use the canonical route and a fixed seed** unless P23 shows that variants sit
     inside run-to-run noise.
   - Neon Flythrough keeps its fixed path.
9. **Same settings model:**
   - Tiers `Low | Medium | High | Ultra | Extreme`, resolutions `720p | 1080p | 1440p | 4K`, durations
     `30 | 60 | 90`.
   - Each benchmark has its own presets, Score tests, stress tests and score formula.
   - **Scores are never compared across benchmarks.**
10. **Mobile-first.**
    - Low runs on a current phone with WebGPU: iOS 26 Safari, and Android Chrome 121+ on Android 12+
      with ARM, Qualcomm or Intel GPUs.
    - Extreme is free to crush the fastest desktop GPU at 4K.
11. **Hosting: free tier first, paid only when traffic forces it.**
    - Static-first on Cloudflare Workers static assets. Build nothing that needs a paid plan or whose
      cost grows with traffic, unless that's unavoidable.
    - A small paid plan is acceptable later, but only when real traffic outgrows the free tier.
    - Any plan that adds Worker calls or storage (KV, D1, R2, Durable Objects) notes its expected cost
      per visit.
    - Prefer degrading gracefully at the free limit over billing silently. Keep spending caps or
      alerts on.
    - MIT license. No personal username in the copyright line.

## Decisions already made

- **Name:** Ashen Horizon. Proposed `gameId` `openbenchmarker_ashen_horizon`, confirmed in P08.
- **New benchmark**, not a Neon preset. Same site, same repo.
- **Renderer:** Three.js `WebGPURenderer` (`three/webgpu`) with **TSL** for shaders and compute, on
  the pinned three version (currently 0.186.x). No custom raw-WebGPU renderer.
- **WebGPU is required.** Without it, show the storyboard's "WebGPU Required" card ("use Neon
  Flythrough instead", "View WebGPU requirements"). Never fall back silently to three's WebGL2
  backend.
- **Camera:** a smooth, cinematic drone path with no player controls.
- **3D models:** procedural by default. Hand-built models are made in their own plans (PM01 sets up
  the pipeline once; PM-series plans add each set) whenever they make the benchmark look better.
- **Ray tracing:** software only (compute BVH traversal), Ultra and Extreme. Labelled "software ray
  tracing in compute shaders, it does not use RT cores".
- **Platform support.** The storyboard's panel is accurate against the
  [gpuweb implementation status](https://github.com/gpuweb/gpuweb/wiki/Implementation-Status), with
  one fix: NVIDIA on Linux is default-on **only under Wayland**.
  - Windows and macOS: Chrome and Edge 113+, Safari 26+.
  - Linux Chrome, enabled by default: Intel Gen12+ (Chrome 144+), and NVIDIA with driver 535.183.01+
    on Wayland (Chrome 147+). Other Linux setups need flags. Firefox on Linux is Nightly only.
  - Mobile: iOS/iPadOS 26 Safari. Android Chrome 121+ on Android 12+ with ARM, Qualcomm or Intel
    GPUs. Imagination GPUs need Android 16+ and Chrome 139+.
  - **Linux results policy:** Ashen runs on Linux are not submittable until P23 decides (see Open
    questions). Flagged setups are for local testing only.
- **Neon Flythrough** stays benchmark #1 on WebGL2 with its own version line.

## Corrections and notes on the storyboard

- **Score example:** the results card shows **8,432** at **120.4** FPS avg. The current rule
  (`scoreFor`: `round(avgFps × 100)`) would give 12,040. Each benchmark gets its own score formula
  (Invariant 9), and P23 sets Ashen's. Treat the mockup number as illustrative unless Matt wants that
  scale.
- **Results card** shows Score, Avg FPS, 1% Low and **GPU Frame Time** (`diag.gpuMs`). GPU frame time
  isn't on today's share card or in the link, so P06 adds it.
- **"Results include benchmark ID and backend":** that's `gameId` plus `graphicsApi` (`"WebGPU"`). Don't
  reuse `diag.backend`, which already means the ANGLE backend.
- **Settings checkboxes:**
  - "Validate WebGPU support" (P09) and "Record actual features used" (already done, extended per
    benchmark) are **always on**, not toggles.
  - "Auto-detect recommended settings" and "Show estimated VRAM usage" are visible helpers (P07, P22).
- **Copy typos to fix when building UI:** "Neen" should be "Neon", and "fosests" should be "forests".
- **Nav:** the storyboard shows Benchmarks / Results / Compare / About. Today's nav is Benchmark /
  My Results / About. P04 decides the labels and keeps every existing hash working.
- **Implementation order:** matches the storyboard's 8 steps, split into smaller deployable plans.

## Storyboard to plans

| Beat | Content | Key tech | Plan |
|---|---|---|---|
| 1 Highway | Abandoned vehicles, dead forests, distant mountains, falling ash, wet surfaces | Dense terrain and instancing, compute frustum + Hi-Z culling, volumetric fog, ash particles | P12, P13 |
| 2 Gas station | Ruined station, detailed props, destroyed assets, flickering signs, fires | Local point/spot lights, reflections on wet surfaces, shadowed interiors | P15 |
| 3 Tunnel | Dark tunnel, emerge at the far end | Heavy froxel fog, dynamic lights and shadows, wet surfaces, auto-exposure transition | P16 |
| 4 City approach | Sprawling ruined city, enclosed to open space | Large-scale city, GPU-driven culling with indirect draws, light shafts, exposure adaptation | P17 |
| 5 City core | Towering crumbling buildings, fires, smoke | Highest instance counts, software RT (Ultra/Extreme), dense volumetrics and particles, complex lighting and reflections | P18, P19 |

UI from the storyboard:
- **Multi-benchmark hub with cards:** API badge, Current/New/Preview badge, blurb, Run Benchmark, and
  a Future Benchmarks card. **P04**, with the Ashen card added in **P14**.
- **Settings:** per-benchmark tier descriptions and shared resolution/duration controls (**P04**,
  **P07**). Recommended settings and VRAM estimate (**P07**, **P22**).
- **Platform support panel and WebGPU Required card:** **P09**.
- **Results and share card** with GPU frame time: **P06**.

## Current codebase: coupling points to break

Verified against the repo. Re-verify at the start of each plan.

| Area | Where | Coupling |
|---|---|---|
| Benchmark identity | `src/benchmark/catalog.ts` | `BENCHMARKS` is already an array, but `BENCHMARK = BENCHMARKS[0]` and there's one global `BENCHMARK_VERSION = "2.2.0"` |
| Run loop | `src/app/run.ts` | Creates `THREE.WebGLRenderer`, calls `makeFlythrough`, uses the WebGL timer query (`EXT_disjoint_timer_query_webgl2`), `rendererInfo(gl)` and `MAX_TEXTURE_SIZE`, and writes `gameId: BENCHMARK.gameId` and `benchmarkVersion: BENCHMARK_VERSION` |
| Dev tools | `src/app/lab.ts`, `src/app/capture.ts`, `scripts/capture.mjs` | WebGLRenderer + `makeFlythrough` |
| Scene entry | `src/engine/scenes.ts` | `makeFlythrough(renderer: WebGLRenderer, …)` returns `{ render, features, timing, counts, scene, camera, dispose }`. EffectComposer chain. |
| Presets | `src/benchmark/presets.ts` | One `Preset` shape: `PRESETS`, `SCORE_TESTS`, `STRESS_TESTS` (`STRESS_LAP_SECONDS = 96`), all Neon-specific |
| Score | `src/benchmark/metrics.ts` | One global `scoreFor(avgFps)` |
| Result schema | `src/benchmark/types.ts` | `GraphicsApi = "WebGL2" \| "WebGL1"`. `features` is Neon-shaped. `RunDiagnostics.backend` means the ANGLE backend. |
| Exports | `src/benchmark/exporter.ts` | YAML header and `gamesYamlEntry` use the single `BENCHMARK`. The notes say "Browser WebGL2 benchmark; fixed-path neon city flythrough". |
| Share codec | `src/benchmark/share-codec.ts` | V1 tables `games` and `apis: ["WebGL2","WebGL1"]`. Rejects an unknown `gameId`. |
| Version checks | `src/app/history-view.ts`, `src/app/shared-view.ts` | "Old result" means the major version differs from the **global** `BENCHMARK_VERSION` |
| Hardcoded name | `share.ts`, `compare.ts`, `results-view.ts`, `shared-view.ts`, `shell.ts`, `about-view.ts`, `exporter.ts` | "Neon Flythrough" strings, share-card eyebrow, PNG filename, page titles |
| Routing and nav | `src/app/router.ts`, `index.html` | No benchmark dimension. Nav is Benchmark / My Results / About. |

## Plan index

| # | Plan | Track | Depends on | Visitors see after deploy |
|---|---|---|---|---|
| P01 | [Golden safety net](P01-golden-safety-net.md) | Platform | — | Nothing |
| P02 | [Benchmark registry](P02-benchmark-registry.md) | Platform | P01 | Nothing |
| P03 | [Benchmark-aware copy and versions](P03-benchmark-aware-copy.md) | Platform | P02 | Nothing (Neon strings identical) |
| P04 | [Benchmarks hub](P04-benchmarks-hub.md) | Platform | P03 | New hub: Neon card, Future Benchmarks card, new nav |
| P05 | [Results by benchmark](P05-results-by-benchmark.md) | Platform | P04 | Benchmark badges and filter in My Results |
| P06 | [Share codec v2 and card](P06-share-codec-v2.md) | Platform | P05 | New link format; GPU frame time on card and shared view |
| P07 | [Settings helpers](P07-settings-helpers.md) | Platform | P04 | Tier descriptions, recommended settings, estimated VRAM (Neon) |
| P08 | [Ashen registration and schema](P08-ashen-schema.md) | Ashen foundation | P06 | Nothing (`hidden`) |
| P09 | [WebGPU bootstrap and gate](P09-webgpu-bootstrap.md) | Ashen foundation | P08 | WebGPU requirements section on About (optional public) |
| P10 | [WebGPU measurement](P10-webgpu-measurement.md) | Ashen foundation | P09 | Nothing (`hidden`) |
| P11 | [Camera path and beat timeline](P11-path-and-beats.md) | Ashen foundation | P10 | Nothing (`hidden`) |
| P12 | [Highway: terrain, instancing, GPU culling](P12-highway-world.md) | Beats | P11 | Nothing (`hidden`) |
| P13 | [Highway: atmosphere](P13-atmosphere.md) | Beats | P12 | Nothing (`hidden`) |
| P14 | [Public preview](P14-public-preview.md) | Release | P13 | **Ashen Horizon Preview card**, highway beat playable |
| P15 | [Gas station](P15-gas-station.md) | Beats | P14 | Gas station added to the preview |
| P16 | [Tunnel](P16-tunnel.md) | Beats | P15 | Tunnel added |
| P17 | [City approach](P17-city-approach.md) | Beats | P16 | City approach added |
| P18 | [City core](P18-city-core.md) | Beats | P17 | Full five-beat run |
| P19 | [Software ray tracing](P19-software-rt.md) | Beats | P18 | RT on Ultra/Extreme |
| P20 | [Scene stats and FPS timeline chart](P20-scene-stats-and-fps-chart.md) **(required; do after P14, before P15)** | Results | P11, P14 | Live running average in the HUD; FPS line chart with scene bands; per-scene stats (both benchmarks) |
| P21 | [Route variants (optional)](P21-route-variants.md) | Extra | P18 | Slight route variation on custom runs |
| P22 | [Preset tuning](P22-preset-tuning.md) | Release | P19 | Final presets, VRAM estimates, recommendations |
| P23 | [Launch 1.0](P23-launch-1-0.md) | Release | P22 | Ashen Horizon 1.0: Score tests, submissions, New badge |
| P24 | [Sensor log import (optional)](P24-sensor-log-import.md) | Results | P20 | Optional temp/power/clocks from a user-supplied log (any time after P20) |

Platform plans P04–P07 can ship in any order after P03, except that P06 depends on P05.

### 3D models (on demand)

Model work is kept out of the beat plans, so a beat can ship procedurally and get better models
later, or wait for its models:

| # | Plan | When | Visitors see |
|---|---|---|---|
| PM01 | [3D asset pipeline](PM01-asset-pipeline.md) | Once, before the first model set; any time after P10 | Nothing |
| PM02+ | [Model set template](PM-model-set-template.md), copied per set, e.g. `PM02-highway-vehicles.md`, `PM03-gas-station.md` | Before, or after, the beat that uses them | Better-looking models in that beat (Ashen version bump) |

A beat plan lists the props it would like as models under **"Model candidates"**. Matt decides
whether each set gets built first, or the beat ships procedurally and the models come later.

## Open questions (answer before the plan that needs them)

| Question | Needed by |
|---|---|
| Confirm `gameId` `openbenchmarker_ashen_horizon` | P08 |
| Which model sets to build, and whether each comes before or after its beat | Each beat plan (P12, P15–P18) |
| Timeline sample interval (1 s default, or 0.5 s); whether per-scene FPS goes in share links and on the card; whether to propose per-scene fields to the upstream YAML schema | P20 |
| How models get made: Blender by hand, commissioned, or CC0 sources (licence must allow redistribution under the site's terms) | PM01 |
| Nav labels: storyboard (Benchmarks / Results / Compare / About) or current | P04 |
| Run length. Recommendation: every duration plays the whole five-beat journey, with path time scaled to the run length, so 30, 60 and 90 s all cover every beat. Score tests stay 60 s. | P11 |
| Beat timings within the journey | P11 |
| TAA, or keep MSAA for sharpness | P13 |
| Make the WebGPU requirements section public before the preview | P09 |
| Score formula and scale (the mockup implies a different scale from ×100) | P23 |
| Linux results policy: allow submissions from the default-on configurations (Intel Gen12+, NVIDIA on Wayland), or none until Firefox ships too | P23 |
| Official-vs-community chart split and the extra CPU test beds (OptiPlex 9020, 5600X3D) for Ashen from day one | P23 |
