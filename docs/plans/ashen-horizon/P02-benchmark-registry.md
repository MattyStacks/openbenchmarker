# P02: Benchmark registry

**Track:** Platform · **Depends on:** P01 · **Visitors see:** nothing · **Neon version:** unchanged

**Branch:** `feature/p02-benchmark-registry` · **Preview:** `npm run preview:deploy -- p02-benchmark-registry` → `https://p02-benchmark-registry.opengpubenchmarker.com`

## Goal
The app runs through a `Benchmark` interface, with Neon Flythrough as its only implementation. There
is no visible change.

## Read first
- `src/benchmark/catalog.ts`
- `src/benchmark/presets.ts`
- `src/benchmark/metrics.ts` (`scoreFor`)
- `src/app/run.ts`
- `src/app/lab.ts`
- `src/app/capture.ts`
- `scripts/capture.mjs`
- `src/engine/scenes.ts`
- `src/benchmark/types.ts`
- the storyboard's "Benchmark Architecture" panel

## Scope
- Create `src/benchmark/registry.ts` with a `Benchmark` interface. The names follow the storyboard and
  the exact shape is up to this plan:
  - `id` (slug, e.g. `neon-flythrough`), `gameId`, `name`, `version`, and a version-history doc
    comment
  - `status: "hidden" | "preview" | "live"` (Neon is `live`)
  - `requirements: "webgl2" | "webgpu"`
  - `presets`, `scoreTests`, `stressTests` (+ lap length), and `score(avgFps)`. Neon's is today's
    `scoreFor`.
  - `createRenderer(canvas): Promise<Renderer>`. Neon wraps its synchronous `WebGLRenderer` creation.
    The await happens before warm-up, so timing is unaffected.
  - `build(config): BenchmarkBuild`, the existing `{ render, features, timing, counts, scene,
    camera, dispose }` contract
  - `gpuTimer` adapter (begin/end/poll), so `run.ts` doesn't call WebGL timer queries directly
  - `rendererInfo` adapter (renderer/vendor strings, max texture size, `graphicsApi`)
  - `getFeatures(): FeatureInfo`, the benchmark's feature record
  - `getShareCard(): ShareCard`, its theme hooks (used from P03 onward)
- Move Neon behind it. Either move the files to `src/benchmarks/neon-flythrough/` or wrap them in
  place; this plan decides, and smaller diffs are better.
- `run.ts`, `lab.ts` and `capture.ts` take a `Benchmark`. Today they get it from
  `getBenchmark("neon-flythrough")`.
- Keep the `BENCHMARK` / `BENCHMARK_VERSION` exports as deprecated aliases for now. P03 removes them.

## Out of scope
UI changes, copy changes, a second benchmark.

## Acceptance
- P01 goldens are byte-identical, and every existing test passes.
- Manual Neon runs at Low/720p and Extreme/4K report the same FPS as before, within run-to-run noise,
  and the same diagnostics.
- `lab.ts` and `capture.mjs` still work.
