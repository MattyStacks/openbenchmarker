# P18: City core

**Track:** Beats · **Depends on:** P17 · **Visitors see:** the full five-beat run · **Ashen version:** next minor

**Branch:** `feature/p18-city-core` · **Preview:** `npm run preview:deploy -- p18-city-core` → `https://p18-city-core.opengpubenchmarker.com`

## Goal
Build beat 5, **the most demanding section of the benchmark**: fly through the heart of the city with
towering, crumbling buildings, fires, smoke and heavy atmosphere.

## Read first
- `docs/ashen-horizon-storyboard.md` (City Core)
- the storyboard's City Core frame
- `citygen.ts`
- `gpu/particles.ts`
- `gpu/froxels.ts`
- `gpu/cull.ts`

## Scope
- **Highest instance counts** in the run: dense tower canyon, rubble fields, vehicles, signage.
- **Fires and smoke:**
  - many fire sources (shadowed lights on higher tiers)
  - smoke columns as compute particles that feed the froxel density
  - embers
- **Dense volumetrics and particles:** the heaviest fog and particle settings per preset happen here.
- **Complex lighting:** mixed firelight, overcast sky and bounced fill. Reflections on wet streets
  (SSR until P19).
- Set the beat to `status: "built"`. **All five beats are now built.**
- Update features, `counts` and `estimateVram`.

## Model candidates
Procedural by default (README Invariant 7). Props that would look clearly better as hand-built models: hero collapsed skyscrapers, rubble kits, burned vehicles, street furniture. Matt decides per set whether a PM-series plan builds them **before** this beat, or the beat ships procedurally and the models replace the stand-ins later.

## Acceptance
- The city core is the slowest segment on every tier (check with P20's breakdown, or a `lab.ts`
  per-beat measure).
- The preview plays the full journey.
- Invariant 4 gates pass.
