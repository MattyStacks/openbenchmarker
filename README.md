# Open GPU Benchmarker

[![License: MIT](https://img.shields.io/badge/License-MIT-ff2bd6.svg)](LICENSE)

An open-source GPU benchmark that runs in the browser with nothing to install
(opengpubenchmarker.com). It runs one benchmark, **Neon Flythrough**: a fixed-path
flight through a rainy, neon-lit 1980s-movie city. It reports **Average FPS** and
**1% Low FPS**. You can keep results in your browser or submit them to
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

1. Before the run you choose a **resolution**: 1080p, 1440p, 4K (3840×2160), or Native
   (the display's physical pixels). Results use upstream's names: `1080p`, `1440p`, `4K`,
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
6. **Validity:** these mark the run **INVALID** and end it immediately: hiding the
   tab, resizing the window or stage, aborting, losing the WebGL context, or a
   render error. An invalid run can be saved locally but can never be submitted.

The HUD sits inside the stage, below the top banner. The banner stays in normal
page flow (never fixed or sticky), so the HUD can't end up hidden under it.

### Presets

| Preset  | Buildings | Rain   | Signs | Cars | Drones | Holos | Bloom | Shadow map | MSAA | Reflections |
|---------|----------:|-------:|------:|-----:|-------:|------:|------:|-----------:|-----:|------------:|
| Low     | 120       | 800    | 24    | 36   | 8      | 2     | –     | –          | –    | –           |
| Medium  | 240       | 2 500  | 48    | 80   | 16     | 4     | 0.55  | 1024       | –    | –           |
| High    | 420       | 5 000  | 80    | 150  | 28     | 6     | 0.85  | 2048       | 4    | –           |
| Ultra   | 1 100     | 24 000 | 200   | 400  | 70     | 14    | 1.15  | 2048       | 4    | 0.75×       |
| Extreme | 2 800     | 110 000| 560   | 1 400| 260    | 40    | 1.45  | 4096       | 8    | 1.0×        |

Ultra and Extreme counts are higher than the original design table (800/12k/140/240/44/9 and
1800/45k/320/600/110/22). A headless sweep showed those values added only about 1.5× per-frame
cost per tier. Searchlights = 2 × holograms.

Presets with bloom also add a grade pass (chromatic aberration, scanlines,
grain, vignette). On Ultra and Extreme, a `Reflector` re-renders the whole
scene mirrored every frame to make the wet-street reflections. Buildings,
signs, and searchlights are kept at least 24 units from the flight path (see
`distToPath` in `src/engine/city.ts`).

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
src/benchmark/metrics.ts   computeStats / liveFps (pure)
src/benchmark/presets.ts   RESOLUTIONS, PRESETS, durations
src/benchmark/catalog.ts   catalog snapshot, NOT_LISTED, BENCHMARKS (exactly one)
src/benchmark/types.ts     SystemInfo (all blank), BenchResult
src/benchmark/validate.ts  validateSubmission (fail-closed)
src/benchmark/exporter.ts  toYaml / toCsv / toJson / file names
src/engine/city.ts         seeded city, flight path, corridor, traffic, rain…
src/engine/scenes.ts       makeFlythrough: camera, composer, reflector
src/main.ts                views, run controller, HUD, results, history
scripts/refresh-catalog.mjs
tests/                     Vitest unit tests
```

## Notes on measurement

- Headless or software (SwiftShader) numbers come from software rendering. Use them
  to compare relative load, not real GPU performance.
- Each batch ends with a readback, so the GPU briefly idles between batches (HUD
  update, yield, and building the first frame of the next batch). Within a batch,
  the GPU is fed back-to-back.
- The results page shows "Loop busy %": the share of timed wall-clock time spent
  rendering batches rather than yielding or updating the HUD.
  GPU utilisation itself can only be measured with tools on your own machine.
