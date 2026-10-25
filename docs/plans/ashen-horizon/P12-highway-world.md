# P12: Highway, part 1: terrain, instancing and GPU-driven culling

**Track:** Beats · **Depends on:** P11 · **Visitors see:** nothing (`hidden`) · **Ashen version:** 0.5.0

**Branch:** `feature/p12-highway-world` · **Preview:** `npm run preview:deploy -- p12-highway-world` → `https://p12-highway-world.opengpubenchmarker.com`

## Goal
Build beat 1's geometry, plus the reusable **GPU-driven culling** module that the city beats will push
much harder.

## Read first
- `docs/ashen-horizon-storyboard.md` (Highway)
- the storyboard's Highway frame
- `src/engine/rng.ts`
- `src/engine/towergen.ts` (for ideas; don't modify Neon code)
- three r186 TSL compute and `IndirectStorageBufferAttribute` / indirect draw support

## Scope
- **Terrain:** a procedural heightfield from the seed:
  - LOD rings
  - a road spline cut in, with shoulders and an ash layer
  - distant mountains as a far ring
- **Instanced assets**, procedural unless a model set from the PM series exists:
  - abandoned and burned cars: a few procedural body types with damage variants
  - dead trees (dead forests)
  - rocks, debris, guardrails, poles
- **GPU-driven culling** module (`src/benchmarks/ashen-horizon/gpu/cull.ts`):
  - compute frustum culling plus Hi-Z occlusion (depth pyramid from the previous frame, or a depth
    prepass; this plan decides)
  - writes indirect draw arguments
  - reusable by later beats
- **Preset fields:**
  - instance density
  - view distance
  - terrain resolution
  - asset detail level
- Record scene stats in `counts` and culling stats in features.
- Set the highway beat's `status: "built"`.

## Out of scope
Fog, particles, wet surfaces, sky (P13).

## Model candidates
Procedural by default (README Invariant 7). Props that would look clearly better as hand-built models: hero wrecked cars and trucks (a few body types with damage variants), guardrails, road signs, a burned-out bus. Matt decides per set whether a PM-series plan builds them **before** this beat, or the beat ships procedurally and the models replace the stand-ins later.

## Acceptance
- Extreme/4K on the test bench is GPU-bound (high GPU-busy) on geometry alone.
- Low/720p on a phone holds a reasonable frame rate.
- Culling reduces drawn instances measurably (recorded in `counts`).
