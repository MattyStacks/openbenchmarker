# PM01: 3D asset pipeline

**Track:** 3D models · **Depends on:** P10 · **Visitors see:** nothing · **Ashen version:** unchanged

**Branch:** `feature/pm01-asset-pipeline` · **Preview:** `npm run preview:deploy -- pm01-asset-pipeline` → `https://pm01-asset-pipeline.opengpubenchmarker.com`

## Goal
Set up a one-time path from hand-built 3D models to the benchmark, so each later model set is only
content work. Follows README Invariant 7.

## Read first
- README Invariant 7 and "3D models"
- `public/_headers` (cache rules)
- `wrangler.toml`
- `docs/privacy-audit.md`
- three r186 `GLTFLoader`, `KTX2Loader`, and meshopt/Draco decoders, and how they work with
  `WebGPURenderer`

## Scope
- **Source and output folders:**
  - `assets-src/ashen-horizon/` holds source files: `.blend` or `.glb` plus a licence note per model
  - `public/assets/ashen-horizon/` holds build output only
- **Licences:** every model has a recorded source and licence in `assets-src/.../LICENSES.md`. Only
  self-made, commissioned with full rights, or CC0 models. Nothing that forbids redistribution.
- **Build script** `scripts/build-assets.mjs` (run by hand, output committed):
  - glTF 2.0 binary (`.glb`) with meshopt or Draco compression (this plan picks one)
  - KTX2/Basis textures
  - **LOD levels** per model (e.g. LOD0/1/2), and per-tier texture sizes
  - a manifest (`manifest.json`): file, hash, byte size, LODs, which tier uses which
  - content-hashed file names, so `Cache-Control: immutable` applies (add the path to
    `public/_headers`)
  - fail if any file exceeds 20 MiB, safely under the 25 MiB per-file limit
- **Runtime loader** (`ashen-horizon/assets.ts`):
  - same-origin fetches only
  - load only the selected tier's LOD and texture set
  - progress callback for the pre-run screen
  - decode and upload before warm-up (`renderer.compileAsync` covers the pipelines)
  - a download or decode failure aborts the start with a clear message
  - assets are instanced through the P12 culling path like procedural meshes
- **Pre-run UI:** a "Loading assets: 34 / 82 MB" progress bar before warm-up. On phones, show the
  download size before starting, as the high-res memory confirmation does today.
- **Results:**
  - record the asset manifest hash in features, so runs with different model sets are
    distinguishable
  - changing models bumps the Ashen version
- **Test:** one sample model (e.g. a simple wrecked car) through the whole pipeline into the
  placeholder scene.

## Out of scope
Real model sets (PM02+).

## Acceptance
- The sample model loads on Chrome Windows, Safari iOS 26 and Android Chrome from the branch preview.
- The second load comes from cache.
- Nothing downloads after timing starts (check with the network panel).
- Neon is unaffected.
