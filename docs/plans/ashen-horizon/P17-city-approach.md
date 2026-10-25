# P17: City approach

**Track:** Beats · **Depends on:** P16 · **Visitors see:** the city approach added to the preview run · **Ashen version:** next minor

**Branch:** `feature/p17-city-approach` · **Preview:** `npm run preview:deploy -- p17-city-approach` → `https://p17-city-approach.opengpubenchmarker.com`

## Goal
Build beat 4: come out of the tunnel into a sprawling ruined city, moving from enclosed to open
space. It exercises auto-exposure, global lighting and **massive draw counts**.

## Read first
- `docs/ashen-horizon-storyboard.md` (City Approach)
- the storyboard's City Approach frame
- `gpu/cull.ts`
- `gpu/exposure.ts`
- `src/engine/towergen.ts` (for ideas only; Ashen gets its own generator)

## Scope
- **Ruined-city generator** (`ashen-horizon/citygen.ts`):
  - procedural damaged towers and blocks, collapsed floors, exposed structure, scaffolding
  - an elevated highway and overpass for the camera path
  - all seeded
- **GPU-driven culling at scale:** the indirect-draw path from P12 drives tens of thousands of
  instances. Preset: city density, view distance.
- **Light shafts** through gaps between towers, and volumetrics over a large outdoor volume.
- **Exposure adaptation** outdoors, continuing from the tunnel exit.
- Distant city silhouette ring for the horizon.
- Set the beat to `status: "built"`, and update features, `counts` and `estimateVram`.

## Model candidates
Procedural by default (README Invariant 7). Props that would look clearly better as hand-built models: landmark ruined towers, overpass sections, scaffolding kits, billboards. Matt decides per set whether a PM-series plan builds them **before** this beat, or the beat ships procedurally and the models replace the stand-ins later.

## Acceptance
- Draw and instance counts scale strongly by preset, as recorded in `counts`.
- Extreme/4K is heavier here than on the highway.
- The preview plays four beats.
- Invariant 4 gates pass.
