# Open GPU Benchmarker

[![License: MIT](https://img.shields.io/badge/License-MIT-ff2bd6.svg)](LICENSE)

An open-source GPU benchmark that runs in the browser with nothing to install
(opengpubenchmarker.com). It runs one benchmark, **Neon Flythrough**: a fixed 96 s
flight through a dense, rain-soaked cyberpunk megacity. The camera dives between stacked
towers to just above the street traffic, flies under sky bridges, weaves through the
streets, rides between stacked sky-lanes of flying cars, and climbs over the rooftops for
a skyline that runs out to the horizon. It reports **Average FPS** and **1% Low FPS**.
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
npm run deploy     # build + wrangler deploy
```

To deploy, run `npx wrangler login` once, then `npm run deploy`. `wrangler.toml`
serves `./dist` with an SPA fallback. Attach the custom domain
`opengpubenchmarker.com` in the Cloudflare dashboard (Workers → openbenchmarker →
Settings → Domains).

## How a run works

1. Before the run you choose a **resolution**: 720p (1280×720, a lighter option for
   lower-end GPUs), 1080p, 1440p, 4K (3840×2160), or Native (the display's physical
   pixels). Results use upstream's names: `720p`, `1080p`, `1440p`, `4K`,
   and `WIDTHxHEIGHT` for any other Native size. The scene renders at exactly that size with
   `setPixelRatio(1)`, and CSS only scales it to fit on screen. You also choose a
   **preset** (Low to Extreme) and a **duration** (30/60/90 s). These settings
   can't change during the run.
2. The run view appears first. The tool then measures the stage and only then
   creates the WebGL context, builds the city, and renders one frame right away so
   any setup failure shows up at once.
3. A **3 s warm-up** follows. It is never counted.
4. The **timed phase** follows. Frames render back-to-back in batches of about 28 ms
   (GPU time included), chained over a `MessageChannel`. Batches don't wait for vsync,
   so the score can go well above the monitor's refresh rate. There is no per-frame
   sync: one 1-pixel `readPixels` after each batch waits for the GPU, so the queue never
   runs more than one batch ahead. Chrome's `gl.finish()` doesn't actually wait, so it
   isn't used. Warm-up/timed membership is fixed when a frame is submitted.
5. **Stats:** Avg FPS = timed frames / timed wall-clock (throughput). 1% Low (`p1_low`)
   = mean FPS of the slowest 1% of frames, using per-frame times. When
   `EXT_disjoint_timer_query_webgl2` is available, each frame's time is its GPU time
   from a timer query, or its batch's average frame time if that is larger (CPU-bound);
   results flagged disjoint are dropped. Without the extension, every frame gets its
   batch's average frame time. The method is recorded as `timing` (`gpu-timer` or
   `batch-avg`) in JSON/CSV. The tool also records 5% low, worst frame, and frame count.
   Scores from 1.1.0 aren't comparable with 1.0.0, which synced after every frame.
   Scores from **2.0.0** aren't comparable with 1.x either: 2.0.0 is a new scene and new
   presets (a much heavier workload). The measurement itself is unchanged. My Results
   shows each result's version.
6. **Validity:** these mark the run **INVALID** and end it immediately: hiding the
   tab, resizing the window or stage, aborting, losing the WebGL context, or a
   render error. An invalid run can be saved locally but can never be submitted.

The HUD sits inside the stage, below the top banner. The banner stays in normal
page flow (never fixed or sticky), so the HUD can't end up hidden under it.

### Presets

| Preset  | Towers | Detail | Rain    | Signs | Cars  | Lane levels | Drones | Far drones | Holos | Skyline | Clouds | Shafts | Bloom | Shadow map | MSAA | Reflections |
|---------|-------:|-------:|--------:|------:|------:|------------:|-------:|-----------:|------:|--------:|-------:|-------:|------:|-----------:|-----:|------------:|
| Low     | 260    | 0      | 1 500   | 120   | 90    | 2           | 8      | 120        | 2     | 1       | 1      | 2      | –     | –          | –    | –           |
| Medium  | 520    | 1      | 2 500   | 260   | 200   | 3           | 16     | 300        | 4     | 2       | 1      | 4      | 0.55  | 1024       | –    | –           |
| High    | 900    | 2      | 5 000   | 500   | 400   | 4           | 28     | 700        | 6     | 3       | 2      | 8      | 0.85  | 2048       | 4    | –           |
| Ultra   | 1 600  | 3      | 24 000  | 1 100 | 900   | 5           | 70     | 2 000      | 14    | 4       | 3      | 14     | 1.15  | 2048       | 4    | 0.75×       |
| Extreme | 2 700  | 3      | 110 000 | 2 600 | 2 200 | 5           | 260    | 6 000      | 40    | 4       | 3      | 24     | 1.45  | 4096       | 8    | 1.0×        |

- **Towers** get the full archetype treatment (slab, tiered setback, podium + tower,
  round/octagonal, megastructure) on the lots nearest the flight; every other lot of the
  32×32-block grid gets a plain window-shaded box, so every preset has a city all the way
  out. **Detail** (0-3) adds ledges, rooftop tanks/AC/sheds, antenna masts with spires
  and beacons, shop awnings and lanterns, facade AC units, pipes, ribs, balconies and
  scaffolding. Detail 0 also uses simpler windows (no interior parallax or flicker).
- **Lane levels**: traffic altitudes in use (street, then sky-lanes at 50, 25, 80, 120).
- **Skyline**: horizon rings of window-dotted silhouettes. **Clouds**: low cloud layers
  lit from below. **Shafts**: rooftop searchlight beams, plus 3× as many light spills
  under the biggest signs.
- Every field is non-decreasing from Low to Extreme (a test enforces it).

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
- Browser hints (WebGL renderer string, CPU thread count, user agent) are shown
  as clearly labelled hints and are **never** copied into a result.
- The GPU must be an exact `gpu_id` from the upstream catalog. Free text is
  rejected. **If your GPU isn't listed, you can't submit.** Open an issue or PR
  upstream to add it ([issue chooser](https://github.com/MattyStacks/open-gpu-benchmarks/issues/new/choose),
  [templates](https://github.com/MattyStacks/open-gpu-benchmarks/tree/main/templates)),
  then submit once it exists. Local save and JSON/CSV export still work.
- Validation (`src/benchmark/validate.ts`) fails closed and mirrors upstream
  `templates/community_submission.yaml` and `scripts/checks.py`. Required:
  catalog `gpu_id`, `game_id`, date, resolution, preset, `avg_fps`, `p1_low`,
  `system.os` (`windows`|`linux`), and `proof.method`. Linux-only fields on a
  Windows run fail. Blank optional fields are left out of the YAML. YAML
  download and copy stay disabled until validation passes.

### Submitting

The results page builds `result_YYYYMMDD_openbenchmarker_neon_flythrough.yaml` for
`data/community/<gpu_id>/`, and it can open GitHub's new-file form already filled in.
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

## License

- **Code:** [MIT](LICENSE), © 2026 MattyStacks.
- **Submitted results:** results you submit to Open GPU Benchmarks are published under
  [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) and can't be taken back.
- **Third-party:** [three.js](https://github.com/mrdoob/three.js) is MIT-licensed and is
  bundled into the build. Build tools (Vite, TypeScript, Vitest, Wrangler) aren't shipped.

## Layout

```
src/benchmark/metrics.ts      computeStats / liveFps (pure)
src/benchmark/presets.ts      RESOLUTIONS, PRESETS, durations
src/benchmark/catalog.ts      catalog snapshot, NOT_LISTED, BENCHMARKS (exactly one), version
src/benchmark/types.ts        SystemInfo (all blank), BenchResult
src/benchmark/validate.ts     validateSubmission (fail-closed)
src/benchmark/exporter.ts     toYaml / toCsv / toJson / file names
src/main.ts                   entry: routing, config form (dev-only ?capture hook)
src/app/run.ts                run controller (warm-up, timed batches, GPU timers, validity)
src/app/results-view.ts       results page, system form, export & submit
src/app/history-view.ts       My Results (#/history)
src/app/home.ts, shell.ts, router.ts, store.ts, hud.ts, env.ts, dom.ts
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
- Each batch ends with a readback, so the GPU briefly idles between batches (HUD
  update, yield, and building the first frame of the next batch). Within a batch,
  the GPU is fed back-to-back.
- The results page shows "Loop busy %": the share of timed wall-clock time spent
  rendering batches rather than yielding or updating the HUD.
  GPU utilisation itself can only be measured with tools on your own machine.
