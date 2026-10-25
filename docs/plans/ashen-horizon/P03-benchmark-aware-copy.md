# P03: Benchmark-aware copy, exports and version checks

**Track:** Platform · **Depends on:** P02 · **Visitors see:** nothing (Neon strings identical) · **Neon version:** unchanged

**Branch:** `feature/p03-benchmark-aware-copy` · **Preview:** `npm run preview:deploy -- p03-benchmark-aware-copy` → `https://p03-benchmark-aware-copy.opengpubenchmarker.com`

## Goal
Everything that names a benchmark, or checks a version, uses **the result's own benchmark**. That way a
second benchmark can't inherit Neon's name, version or upstream notes.

## Read first
- `src/app/share.ts`
- `src/app/compare.ts`
- `src/app/results-view.ts`
- `src/app/shared-view.ts`
- `src/app/shell.ts`
- `src/app/about-view.ts`
- `src/app/history-view.ts`
- `src/benchmark/exporter.ts`
- `src/benchmark/catalog.ts`

## Scope
- `getBenchmarkByGameId(gameId)` in the registry, with a safe result for unknown IDs: show "Unknown
  benchmark" rather than crash.
- Replace every hardcoded "Neon Flythrough" string with the result's benchmark name or its
  `getShareCard()` hooks:
  - share text and card eyebrow, PNG filename stem
  - compare text, results and shared-view headers
  - page titles in `shell.ts`
  - About "Benchmark" row
- Exporter:
  - YAML header, `gamesYamlEntry` name and notes, and `results-view` instructions come from the
    result's benchmark
  - Neon's notes string is unchanged
- **Version-age checks** (`history-view.ts`, `shared-view.ts`) compare against the version of **the
  result's benchmark**.
- Remove the deprecated `BENCHMARK` / `BENCHMARK_VERSION` aliases.
- Tests use a fake second benchmark registered only in the test, to prove that its name, version and
  notes flow through every string above.

## Out of scope
UI layout, nav, a real second benchmark.

## Acceptance
- P01 goldens are byte-identical.
- The fake-benchmark test passes.
- `grep -r "Neon Flythrough" src/app src/benchmark` finds hits only in Neon's own definition.
