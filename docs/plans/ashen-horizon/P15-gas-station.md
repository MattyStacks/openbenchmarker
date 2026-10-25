# P15: Gas station

**Track:** Beats · **Depends on:** P14 · **Visitors see:** the gas station added to the preview run · **Ashen version:** next minor

**Branch:** `feature/p15-gas-station` · **Preview:** `npm run preview:deploy -- p15-gas-station` → `https://p15-gas-station.opengpubenchmarker.com`

## Goal
Build beat 2 from the storyboard: fly into a ruined gas station with detailed props, destroyed
assets, flickering signs and fires.

## Read first
- `docs/ashen-horizon-storyboard.md` (Gas Station)
- the storyboard's Gas Station frame
- `gpu/froxels.ts`
- `gpu/particles.ts`
- `gpu/cull.ts`
- the wet-surface material (P13)

## Scope
- **Set** (procedural, or PM-series models if built):
  - canopy, pumps, a store building with an interior
  - wrecked cars, collapsed sections, debris, a "GAS" sign
- **Local lighting:**
  - many point and spot lights: flickering signs, fires, embers
  - **shadowed** local lights indoors
  - the flicker is a seeded function of `t`
  - preset fields: number of shadowed local lights, local-light shadow resolution
- **Fires:** emissive geometry plus particle flames and embers (particles module), registered as
  light sources for the froxel fog.
- **Reflections** on wet surfaces of the fire and sign light. Screen-space reflections here; RT in
  P19.
- **Shadowed interiors:** GTAO and contact shadows (preset: AO quality).
- Replace the greybox with this beat and set `status: "built"`.
- Add the new features to `getFeatures()` and update `estimateVram`.

## Model candidates
Procedural by default (README Invariant 7). Props that would look clearly better as hand-built models: gas pumps, the canopy, the store building and interior props (shelves, counter, fridges), the "GAS" sign, wrecked cars at the pumps. Matt decides per set whether a PM-series plan builds them **before** this beat, or the beat ships procedurally and the models replace the stand-ins later.

## Acceptance
- Light count scales by preset.
- Deterministic per `t`.
- The preview run plays highway → gas station.
- No new hitches.
- Invariant 4 gates pass.
