# P16: Tunnel

**Track:** Beats · **Depends on:** P15 · **Visitors see:** the tunnel added to the preview run · **Ashen version:** next minor

**Branch:** `feature/p16-tunnel` · **Preview:** `npm run preview:deploy -- p16-tunnel` → `https://p16-tunnel.opengpubenchmarker.com`

## Goal
Build beat 3: enter a dark tunnel with volumetric lighting, dynamic shadows, wet surfaces and dense
atmosphere, then emerge at the far end. It's a stress test for lighting, reflections, post-processing
and **exposure transitions**.

## Read first
- `docs/ashen-horizon-storyboard.md` (Tunnel)
- the storyboard's Tunnel frame
- `gpu/froxels.ts`
- the lighting from P15

## Scope
- **Procedural tunnel:**
  - curved tube with ribs, abandoned vehicles, cables, puddles
  - a broken light fixture or two, flickering
  - debris at both mouths
- **Heavy froxel fog:** the densest fog yet, with light shafts from the fixtures and the mouths.
  Preset: grid resolution and steps (higher here).
- **Dynamic lights and shadows:** moving light (e.g. swinging fixtures, a vehicle's headlights) as
  seeded functions of `t`.
- **Auto-exposure** (`gpu/exposure.ts`):
  - a compute luminance histogram
  - adaptation is a **deterministic function of the histogram and `t`**, never of wall-clock
  - the entry and exit transitions are this beat's signature
- Wet surfaces and reflections on the tunnel floor.
- Set the beat to `status: "built"`, and update features and `estimateVram`.

## Model candidates
Procedural by default (README Invariant 7). Props that would look clearly better as hand-built models: tunnel light fixtures, cable trays, ventilation fans, abandoned vehicles inside the tunnel. Matt decides per set whether a PM-series plan builds them **before** this beat, or the beat ships procedurally and the models replace the stand-ins later.

## Acceptance
- The exposure transition looks right at every tier.
- Results are deterministic.
- The preview plays three beats.
- Invariant 4 gates pass.
