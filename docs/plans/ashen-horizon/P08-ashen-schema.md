# P08: Ashen Horizon registration and schema

**Track:** Ashen foundation · **Depends on:** P06 · **Visitors see:** nothing (`hidden`) · **Ashen version:** 0.1.0

**Branch:** `feature/p08-ashen-schema` · **Preview:** `npm run preview:deploy -- p08-ashen-schema` → `https://p08-ashen-schema.opengpubenchmarker.com`

## Goal
Ashen Horizon exists in the registry and the data model, so its results can be saved, exported and
shared, before it renders anything real.

## Read first
- `src/benchmark/registry.ts` (P02)
- `src/benchmark/types.ts`
- `src/benchmark/exporter.ts`
- `src/benchmark/validate.ts`
- `src/benchmark/fields.ts`
- `src/benchmark/share-codec.ts` (P06)
- `docs/upstream-submission-changes.md`

## Scope
- Confirm the `gameId` (proposed `openbenchmarker_ashen_horizon`) and register Ashen Horizon:
  - `id: "ashen-horizon"`, `status: "hidden"`, `requirements: "webgpu"`, version `0.1.0`
  - presets, Score and stress tests are placeholders
  - `build()` throws "not built yet"; P09 replaces it
- `GraphicsApi` gains `"WebGPU"`. `diag.backend` keeps its ANGLE meaning; for WebGPU it holds the
  adapter's backend if exposed, or `""`.
- `diag.features` becomes a union by `gameId`. Neon's shape is unchanged. Ashen's shape is a first
  draft, extended by later plans:
  - culling, volumetric grid, particle count, shadow setup, local lights, AA mode, RT mode, VRAM
    estimate, fallback reason
- Optional `seed` and `variant` fields on Ashen results (README Invariant 8).
- **Exporter:**
  - Ashen's YAML settings block lists its own preset fields
  - `gamesYamlEntry` notes: "Browser WebGPU benchmark; cinematic post-apocalyptic flythrough with
    per-frame timing."
  - Neon is byte-identical
- **Validation:**
  - Ashen results with a `0.x` version are **never submittable**, with the reason "Preview version"
  - Linux Ashen results are not submittable until P23 sets the policy
  - JSON and CSV export always work
- Share codec: add Ashen's table entries and feature fields in the P06 format.
- Document Ashen's `game_id`, settings fields and `games.yaml` entry in
  `docs/upstream-submission-changes.md`, marked "not yet submitted".
- Fixtures and goldens for synthetic Ashen results: normal, preview, Linux, Score.

## Out of scope
Rendering, UI.

## Acceptance
- Neon goldens are unchanged.
- Ashen fixtures round-trip through store, YAML, JSON, CSV and share links.
- `check:share` is green with an Ashen fixture seeded.
