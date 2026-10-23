# Open GPU Benchmarker

[![License: MIT](https://img.shields.io/badge/License-MIT-ff2bd6.svg)](LICENSE)

An open-source GPU benchmark that runs in the browser with nothing to install
(opengpubenchmarker.com). It runs one benchmark, **Neon Flythrough**: a fixed 96 s
flight through a dense, rain-soaked cyberpunk megacity. The camera dives between stacked
towers to just above the street traffic, flies under sky bridges, weaves through the
streets, rides between stacked sky-lanes of flying cars, and climbs over the rooftops for
a skyline that runs out to the horizon. It reports **Average FPS** and **1% Low FPS**, a
3DMark-style **score** on the two fixed score runs, and a diagnosis of what limited the run
(GPU, CPU, driver/browser).
You can keep results in your browser or submit them to
[Open GPU Benchmarks](https://opengpubenchmarks.com/).

- Vite + TypeScript + Three.js `0.186.1` on WebGL2 (`WebGLRenderer`, no WebGPU).
- Everything is generated in code from a seeded PRNG. There are no downloaded models or textures.
- Static site deployed on Cloudflare Workers Static Assets.

## Run it

```sh
npm install
npm run dev        # local dev server
npm test           # Vitest unit tests
npm run build      # type-check + production build into dist/
npm run preview    # serve dist/ locally
npm run deploy     # build + wrangler deploy (production)
npm run preview:deploy  # build + upload a preview version (does not promote it)
```

### Testing on a phone (LAN) and preview deploys

```sh
npx vite --host          # dev server on the LAN, e.g. http://192.168.1.20:5173
npx vite preview --host  # same for the production build in dist/
```

The Web Share API and `navigator.clipboard` need a secure context (HTTPS or
`localhost`). Over plain LAN HTTP they are unavailable, so on a phone use LAN
only for layout, run flow and results rendering; test share/clipboard paths on
`localhost` or on a preview deploy:

```sh
npm run preview:deploy   # after `npm test` and `npm run build` pass locally
```

That runs `wrangler preview --name share-results` (Worker Previews; `previews = {}`
and `previews_enabled = true` on the route in `wrangler.toml`). The Preview is
served at `https://share-results.opengpubenchmarker.com` (the custom domain is
set to "Production and Preview") and at
`https://share-results-openbenchmarker.mattys.workers.dev`. A Preview never
touches production: `opengpubenchmarker.com` changes only on `npm run deploy`.
Previews are public, like the site itself; `public/_headers` marks preview
subdomains `noindex`. A Preview is a different origin, so it has its own
localStorage and does not see results saved on production. Remove it with
`npx wrangler preview delete --name share-results`. See [docs/privacy-audit.md](docs/privacy-audit.md)
for what the site does and does not store or send.

**Sharing.** A valid result can be shared as a link (`#/r/<payload>`) plus a share
card PNG with a QR code. The whole result is encoded in the URL fragment, which
browsers never send to the server; it is encoded, not encrypted, and sharing runs on
the honor system (nothing is signed or verified). Format and test steps:
[docs/share-links.md](docs/share-links.md).

Phones can run out of memory at 1440p and 4K on heavier presets, and the OS then
closes the page. The site detects this on the next load, offers a lower
resolution, and asks for a one-tap confirmation before memory-heavy runs on phones
and tablets. See [docs/high-res-memory.md](docs/high-res-memory.md) for the
estimates and [docs/device-test-matrix.md](docs/device-test-matrix.md) for the
device checklist.

To deploy, run `npx wrangler login` once, then `npm run deploy`. `wrangler.toml`
serves `./dist` with an SPA fallback. Attach the custom domain
`opengpubenchmarker.com` in the Cloudflare dashboard (Workers → openbenchmarker →
Settings → Domains).

## Score runs

There are two fixed tests, like 3DMark's. Their settings are locked, so every score measures the
same workload:

| Score run      | Preset  | Resolution          | Duration |
|----------------|---------|---------------------|---------:|
| Score: Entry   | Low     | 720p (1280×720)     | 60 s     |
| Score: Extreme | Extreme | 4K (3840×2160)      | 60 s     |

**Score = round(Average FPS × 100).** The score is linear in FPS, so any gain, from a faster GPU
or an overclock, raises it. FPS, the 1%/5% lows and the diagnosis are shown next to it.

- FPS goes up with a faster GPU because nothing caps it. Frames render back-to-back with no vsync
  or `requestAnimationFrame` wait, and Avg FPS is frames ÷ wall-clock time.
- Scene time follows wall-clock time, so the duration decides which part of the flight is timed.
  That's why score runs lock the duration as well.
- A score is only given to a valid run started from a score-run button whose settings match
  exactly. Custom runs report FPS only.
- A CPU-limited run still gets its score. It is never stopped or hidden, but it is labelled, and
  the diagnosis says what held it back. Score: Entry is often CPU-limited on fast GPUs. Score:
  Extreme is meant to be GPU-limited.

## What limited this run (diagnostics)

During the run, the HUD shows a live **LIMIT** chip (GPU / CPU / GPU + CPU, with GPU busy %),
plus the GPU and JavaScript time per frame. The results page explains the limit in plain words
and lists fixes. All of it comes from signals the browser exposes (`src/benchmark/diagnose.ts`):

| Signal | How it's measured |
|---|---|
| GPU busy % / GPU ms per frame | `EXT_disjoint_timer_query_webgl2` time per frame ÷ wall-clock |
| JS ms per frame (scene update vs draw submission) | `performance.now()` around each frame, and around the scene update |
| GPU wait per frame | Time spent waiting with the GPU queue full (three batches queued) |
| Browser overhead | Share of wall-clock outside render batches (`1 − loop busy`) |
| Main-thread stalls | Yields delayed > 20 ms by other work (tabs, extensions, GC) |
| Hitches, frame-time spread | Frames > 2.5× the median and at least 4 ms over it; standard deviation |
| JS heap growth | `performance.memory` (Chromium only) |
| Renderer, ANGLE backend, max texture size | `WEBGL_debug_renderer_info` and `gl.getParameter` |
| Battery | Battery Status API (Chromium), at the start and when timing begins |

The verdicts:
- **GPU-limited** when the GPU is busy ≥ 90%.
- **Mixed** at 75–90%.
- Below that it is **CPU-limited** when the page's JavaScript or browser overhead dominates, or
  **Driver / browser-limited** when JS is idle but each batch still waits for the GPU. That wait
  is CPU work in the browser's GPU process and the driver.
- Without GPU timers (Firefox, Safari), the verdict is estimated from the GPU wait and marked
  "est.".

The diagnosis also flags:
- software rendering (results can't be submitted)
- a likely integrated GPU
- running on battery
- stalls
- uneven frame pacing
- preset features that fell back

## How a run works

1. Before the run you choose one of four standard **resolutions**: 720p (1280×720, a
   lighter option for lower-end GPUs), 1080p, 1440p or 4K (3840×2160), recorded with
   upstream's names. Only these four can be submitted (there is no Native option, so results
   are always comparable across machines). The scene renders at exactly that size with
   `setPixelRatio(1)`, and CSS only scales it to fit on screen. You also choose a
   **preset** (Low to Extreme) and a **duration** (30/60/90 s). These settings
   can't change during the run.
2. The run view appears first. The tool then measures the stage and only then
   creates the WebGL context, builds the city, and renders one frame right away so
   any setup failure shows up at once.
3. A **3 s warm-up** follows. It is never counted.
4. The **timed phase** follows. Frames render back-to-back in batches of about 8 ms,
   chained over a `MessageChannel`. Batches don't wait for vsync, so the score can go well
   above the monitor's refresh rate. The browser only shows the canvas between tasks (a
   batch's last frame), so batches are kept short for smooth motion on screen; 2.1.0's
   28 ms batches showed only ~35 updates a second however high the FPS.
   - **Pipelined (WebGL2):** each batch ends with a fence, and three batches are kept queued
     on the GPU. When one finishes, the next is already waiting, so the GPU doesn't idle while
     the page updates the HUD, yields, or builds the next frame. While the queue is full, the
     loop sleeps until shortly before the oldest batch is due, instead of pinning a CPU core.
   - **Batch intervals:** a batch's interval runs from the previous batch's completion to its
     own.
   - **Phase boundaries:** the queue is drained with a 1-pixel `readPixels` at the warm-up→timed
     switch and at the end, so timing starts and stops on an idle GPU. Chrome's `gl.finish()`
     doesn't actually wait, so it isn't used. Warm-up/timed membership is fixed when a frame is
     submitted.
   - **WebGL1:** it has no fences, so every batch is drained with a readback.
   - **Pre-roll:** while the city is built, every material is compiled and frames are rendered
     at 16 points across the whole flight, so shader compiles and texture uploads happen
     before the warm-up rather than as hitches mid-run (a cold shader cache, e.g. the first
     run after a browser update, used to stutter).
   - Before 2.1.0, every batch was drained, which left the GPU idle for part of each batch
     (about 3–15% depending on the settings).
5. **Stats:** Avg FPS = timed frames / timed wall-clock (throughput). 1% Low (`p1_low`)
   = mean FPS of the slowest 1% of frames, using per-frame times. When
   `EXT_disjoint_timer_query_webgl2` is available, each frame's time is its GPU time
   from a timer query, or its batch's average frame time if that is larger (CPU-bound);
   results flagged disjoint are dropped. Without the extension, every frame gets its
   batch's average frame time. The method is recorded as `timing` (`gpu-timer` or
   `batch-avg`) in JSON/CSV. The tool also records 5% low, worst frame, and frame count.
   Scores from 1.1.0 aren't comparable with 1.0.0, which synced after every frame.
   **2.1.0** keeps the GPU queue full (see step 4), so GPU-limited results can be a few
   percent higher than on 2.0.0 with the same hardware. Scores from **2.0.0** aren't comparable with 1.x either: 2.0.0 is a new scene and new
   presets (a much heavier workload). The measurement itself is unchanged. My Results
   shows each result's version.
6. **Validity:** these mark the run **INVALID** and end it immediately: hiding the
   tab, resizing the window or stage, aborting, losing the WebGL context, or a
   render error. An invalid run can be saved locally but can never be submitted.

The HUD sits inside the stage, below the top banner. The banner stays in normal
page flow (never fixed or sticky), so the HUD can't end up hidden under it.

### Presets

| Preset  | Towers | Detail | Rain    | Signs | Cars  | Lane levels | Drones | Far drones | Holos | Skyline | Clouds | Shafts | Bloom | Shadow map | MSAA | Reflections | Haze steps |
|---------|-------:|-------:|--------:|------:|------:|------------:|-------:|-----------:|------:|--------:|-------:|-------:|------:|-----------:|-----:|------------:|-----------:|
| Low     | 260    | 0      | 3 000   | 120   | 90    | 2           | 8      | 120        | 2     | 1       | 1      | 2      | 0.4   | –          | –    | –           | –          |
| Medium  | 520    | 1      | 5 000   | 260   | 200   | 3           | 16     | 300        | 4     | 2       | 1      | 4      | 0.55  | 1024       | 8    | –           | –          |
| High    | 900    | 2      | 8 000   | 500   | 400   | 4           | 28     | 700        | 6     | 3       | 2      | 8      | 0.6   | 2048       | 8    | –           | 6          |
| Ultra   | 1 600  | 3      | 24 000  | 1 100 | 900   | 5           | 70     | 2 000      | 14    | 4       | 3      | 14     | 0.7   | 2048       | 8    | 1.0×        | 12         |
| Extreme | 2 700  | 3      | 330 000 | 2 600 | 2 200 | 5           | 260    | 6 000      | 40    | 4       | 3      | 24     | 0.7   | 8192       | 8    | 1.0×        | 24         |

- **Towers** get the full archetype treatment (slab, tiered setback, podium + tower,
  round/octagonal, megastructure) on the lots nearest the flight; every other lot of the
  32×32-block grid gets a plain window-shaded box, so every preset has a city all the way
  out. **Detail** (0-3) adds ledges, rooftop tanks/AC/sheds, antenna masts with spires
  and beacons, shop awnings and lanterns, facade AC units, pipes, ribs, balconies and
  scaffolding. Detail 0 also uses simpler windows (no interior parallax or flicker).
- **Lane levels**: traffic altitudes in use (street, then sky-lanes at 50, 25, 80, 120).
- **Skyline**: horizon rings of window-dotted silhouettes. **Clouds**: low cloud layers
  lit from below. **Shafts**: rooftop searchlight beams, plus 3× as many light spills
  under the biggest signs. **Haze steps**: volumetric haze (`src/engine/volumetric.ts`), a
  per-pixel ray march through drifting 3D noise that picks up light from the nearest neon
  signs. It is GPU-only work that scales with pixels × steps.
- The shadow map is capped at the GPU's `MAX_TEXTURE_SIZE` (Extreme asks for 8192); a capped
  run says so and isn't comparable.
- 2.2.0 rebalanced the presets to load fast GPUs about twice as hard (target on an RTX 5080
  at 4K: Extreme ~65 FPS, Ultra ~100, High ~150, Medium ~250; Low stays light enough for
  phones). Measured with the dev-only preset lab (`/?lab` on `npm run dev`).
- Every field is non-decreasing from Low to Extreme (a test enforces it).

The streets are drawn procedurally on the ground plane on every preset, at no extra draw
calls (`src/engine/ground.ts`). They have wet asphalt with puddles, neon lane markings that
line up with the traffic lanes, pulsing holographic crosswalks, a guide grid over each
junction, glowing curb strips with light spilling onto the road, paved sidewalks with
floor lights, and drain grates.

Presets with bloom also add a grade pass (chromatic aberration, scanlines, grain,
vignette). On Ultra and Extreme, a `Reflector` re-renders the whole scene mirrored every
frame to make the wet-street reflections.

Load per preset at 1280×720 (t = 20 s, `renderer.info` summed over every pass of one
frame, including shadow, reflection and post passes), v1.1.0 → v2.0.0:

| Preset  | Draw calls v1 → v2 | Triangles v1 → v2      |
|---------|-------------------:|-----------------------:|
| Low     | 25 → 23            | 15 k → 92 k            |
| Medium  | 52 → 52            | 24 k → 416 k           |
| High    | 53 → 56            | 34 k → 1.16 M          |
| Ultra   | 103 → 96           | 136 k → 4.14 M         |
| Extreme | 165 → 115          | 339 k → 7.47 M         |

**Camera clearance.** Nothing solid comes within 14 units (`CLEAR_SOLID`) of the camera
path in 3D: every tower part, sky bridge, sign, lantern and filler box is an
axis-aligned box checked against a grid index of the densely sampled path. A failing
upper tier truncates its tower, a failing base shrinks the lot (or leaves a plaza), and
failing details are dropped. Moving things keep 10 units (`CLEAR_MOVING`): each whole
traffic lane and level-change column, every drone orbit, and every far-swarm ring.
`tests/scene.test.ts` checks all of these for every preset.

## Honest-data rules

This tool feeds a public dataset, so:

- **Measured** by the run: FPS stats, resolution, preset, benchmark id and version,
  date, and the **graphics API** read from the WebGL context that was actually
  created (shown read-only on the results form).
- **Provided** by the user: everything else. All fields start blank. Nothing is
  guessed or auto-filled. Example values appear only as grey placeholders.
- **Detected** by the browser: WebGL renderer/vendor, ANGLE backend, CPU thread count, battery
  state and browser version. They are stored in a separate, labelled `detected:` block, for the
  diagnosis only. They **never** fill in the GPU or any `system:` field. A software-rendered run
  (SwiftShader, llvmpipe, Microsoft Basic Render) can't be submitted.
- **Device context (deliberate exception):** each result also saves a separate `device` field
  (`src/app/share-env.ts`: browser + major version, OS, phone/tablet/desktop, WebKit-engine flag,
  and the GPU name as reported by the browser, normalized and labelled "reported by browser").
  This is a deliberate exception to the browser-hints rule, for display and sharing only: it
  never fills a `system:` field, is never copied into submission YAML, and older saved results
  are migrated with only safe inferences (user-filled OS, recorded browser/renderer; an
  old "Chrome N" stays unknown because other Chromium browsers recorded the same) or
  "unknown". Limit: iPadOS Safari sends a Mac UA, so an iPad is recognised only by a Mac UA
  plus more than one touch point; a touch-screen Mac would be misread as an iPad. See [docs/privacy-audit.md](docs/privacy-audit.md).
- The GPU must be an exact `gpu_id` from the upstream catalog. Free text is
  rejected. **If your GPU isn't listed, you can't submit.** Open an issue or PR
  upstream to add it ([issue chooser](https://github.com/MattyStacks/open-gpu-benchmarks/issues/new/choose),
  [templates](https://github.com/MattyStacks/open-gpu-benchmarks/tree/main/templates)),
  then submit once it exists. Local save and JSON/CSV export still work.
- Validation (`src/benchmark/validate.ts`) fails closed and mirrors upstream
  `templates/community_submission.yaml` and `scripts/checks.py`. Required:
  catalog `gpu_id`, `game_id`, date, resolution, preset, `avg_fps`, `p1_low`,
  `system.os` (`windows`|`linux`), and `proof.method`. The resolution must be
  `720p`, `1080p`, `1440p` or `4K`, and match the rendered pixel size: older results
  from the removed Native option at any other size stay local only. A `score` must match its
  score run's locked settings and `round(avg_fps × 100)`. `overclocked` is optional (yes/no). Linux-only fields on a
  Windows run fail. Blank optional fields are left out of the YAML. YAML
  download and copy stay disabled until validation passes.

### Submitting

The results page builds `result_YYYYMMDD_openbenchmarker_neon_flythrough.yaml` for
`data/community/<gpu_id>/`, and it can open GitHub's new-file form already filled in.
Besides the upstream fields, each result item carries run details. These are the score and
`score_test` (score runs), `rendered_with` (the bloom/MSAA/shadows/reflections actually used) and
`diagnostics` (the limit verdict and the signals behind it). A top-level `detected:` block holds
the browser-read values, and there is an optional top-level `overclocked`. Upstream accepts these
today without validating them. `docs/upstream-submission-changes.md` spells out the
`checks.py`/template changes that make them first-class.

The first PR that uses this benchmark must also add it to upstream `data/games.yaml`:

```yaml
  - id: openbenchmarker_neon_flythrough
    name: OpenBenchmarker Neon Flythrough
    type: synthetic
    year: 2026
    url: https://opengpubenchmarker.com/
```

Submitted data is public under **CC BY 4.0** and can't be taken back.

### GPU catalog snapshot

`src/benchmark/gpu-catalog.json` is a dated snapshot of upstream
`data/gpus/<form_factor>/<vendor>/*.yaml` (excluding `reference/`). On
2026-10-19 the catalog holds exactly one product, `rtx_5080_16gb_fe`. To refresh it:

```sh
npm run refresh-catalog   # optionally GITHUB_TOKEN=... to avoid rate limits
```

The script refuses to overwrite the snapshot with an empty list.

## Search engines and sharing

Everything Google Search and link previews need ships from `index.html` and `public/`:

- `<title>`, meta description, `robots`, and a canonical link to `https://opengpubenchmarker.com/`.
  The app uses hash routes (`#/history`, `#/result/…`), which search engines treat as the
  same page, so there is one indexable URL.
- Open Graph and Twitter card tags, with `public/og-image.png` (1200×630, a real frame of the
  Neon Flythrough on Ultra).
- `WebApplication` JSON-LD structured data (free, MIT, requires WebGL2).
- `robots.txt` (points at the sitemap) and `sitemap.xml`.
- Icons: `favicon.ico` (48×48), `favicon.svg`, `apple-touch-icon.png`, plus
  `site.webmanifest` with 192 and 512 px icons.
- `_headers`: basic security headers, and long-lived caching for Vite's hashed `/assets/*`.
- A `<noscript>` notice and a footer with site, project and license links.

After the first deploy:

1. Add the domain in [Google Search Console](https://search.google.com/search-console). The
   **Domain** property type verifies through a DNS TXT record; add it under Cloudflare → DNS.
2. Submit `https://opengpubenchmarker.com/sitemap.xml` under **Sitemaps**.
3. Use **URL Inspection** on the home page and request indexing.
4. Optional: check the structured data with the
   [Rich Results Test](https://search.google.com/test/rich-results).

When the home page changes meaningfully, update `<lastmod>` in `public/sitemap.xml`.

## Future plans

See [TODO.md](TODO.md): a Safari check, a separate score leaderboard site (submitted
to separately from Open GPU Benchmarks), and diagnostics that need more than a browser.

## License

- **Code:** [MIT](LICENSE), © 2026 MattyStacks.
- **Submitted results:** results you submit to Open GPU Benchmarks are published under
  [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) and can't be taken back.
- **Third-party:** [three.js](https://github.com/mrdoob/three.js) is MIT-licensed and is
  bundled into the build. Build tools (Vite, TypeScript, Vitest, Wrangler) aren't shipped.

## Layout

```
src/benchmark/metrics.ts      computeStats / run stats (GPU busy, CPU time, stalls, hitches) / scoreFor (pure)
src/benchmark/diagnose.ts     "what limited this run": verdict + findings (pure)
src/benchmark/presets.ts      RESOLUTIONS, PRESETS, durations, SCORE_TESTS
src/benchmark/catalog.ts      catalog snapshot, NOT_LISTED, BENCHMARKS (exactly one), version
src/benchmark/types.ts        SystemInfo (all blank), BenchResult
src/benchmark/validate.ts     validateSubmission (fail-closed)
src/benchmark/exporter.ts     toYaml / toCsv / toJson / file names
src/main.ts                   entry: routing, config form (dev-only ?capture hook)
src/app/run.ts                run controller (warm-up, timed batches, GPU timers, validity)
src/app/results-view.ts       results page, system form, export & submit
src/app/history-view.ts       My Results (#/history): card list, filters, sort
src/app/result-display.ts     how a result is shown, by the device that ran it (pure, tested)
src/app/home.ts, shell.ts, router.ts, store.ts, hud.ts, env.ts, dom.ts
src/app/share-env.ts          device detection for display/sharing only (pure, tested)
src/app/run-guard.ts          crash detection (run-in-progress record), "didn't finish" hints, phone high-res confirmation
src/app/share.ts              share link, share text, share card (canvas + QR) and the share flow
src/app/shared-view.ts        shared-link view (#/r/<payload>), read-only
src/benchmark/share-codec.ts  share-link binary format (versioned, CRC-8, plausibility checks)
src/app/capture.ts            dev-only: fixed-t renders and renderer.info for scripts/capture.mjs
src/engine/world.ts           grid, clearances, the 96 s flight keys, landmark bridges
src/engine/path.ts            FlightPath (pose as a function of t) + 3D clearance index
src/engine/towergen.ts        lots, tower archetypes, detail kits, bridges, filler (pure)
src/engine/layout.ts          solids index, drones, far swarm, traffic lanes (pure)
src/engine/signlayout.ts      sign and lantern-string placement (pure)
src/engine/signatlas.ts       generated sign atlas (words, stroke glyphs, billboards)
src/engine/windows.ts         procedural window facade material
src/engine/glow.ts            instanced glow sprites (nav lights, swarm, lamps)
src/engine/fog.ts             height fog (shader chunks + GLSL for additive effects)
src/engine/systems/*.ts       sky, atmosphere, towers, signs, rain, traffic, drones, fx
src/engine/city.ts            assembles the systems for a preset
src/engine/scenes.ts          makeFlythrough: camera, composer, sanitize, bloom fallback, reflector
scripts/refresh-catalog.mjs
scripts/capture.mjs           headless screenshots / load reports (Playwright, dev only)
tests/                        Vitest unit tests
```

### Headless captures (development)

`scripts/capture.mjs` starts the Vite dev server and drives headless Chromium
(Playwright, a devDependency; run `npx playwright install chromium` once). It opens the
dev-only `?capture` page, which renders the scene at a fixed scene time. That page isn't
in production builds.

```sh
node scripts/capture.mjs --out shots --presets Low,Ultra --times 5,20,40   # screenshots
node scripts/capture.mjs --info                       # draw calls / triangles per preset
node scripts/capture.mjs --timing [--breakdown]       # relative ms/frame (+ per system)
node scripts/capture.mjs --og public/og-image.png --t 8
```

Headless Chromium renders WebGL in software (SwiftShader), so images are exact but timings
only compare relative load. Sign lettering uses the system's bold sans-serif (as v1 did);
the katakana-style glyphs are drawn as strokes in code, so they need no CJK font.

## Notes on measurement

- Headless or software (SwiftShader) numbers come from software rendering. Use them
  to compare relative load, not real GPU performance.
- Two batches stay queued on the GPU (WebGL2), so a GPU-limited run keeps the GPU busy close
  to 100%. The results page reports GPU busy % from timer queries; Task Manager's GPU graph
  should agree.
- The browser drives the GPU from one thread (the page's main thread, plus the browser's GPU
  process). A CPU-limited run is limited by that one thread's speed, so Task Manager shows low
  total CPU use on many-core CPUs.
- On the dev server, `?inflight=N` changes how many batches are queued (1 drains the GPU
  between batches, like 2.0.0). Production builds ignore it.
- The results page shows "Loop busy %": the share of timed wall-clock time spent submitting
  frames or waiting on a full GPU queue, rather than yielding or updating the HUD.
