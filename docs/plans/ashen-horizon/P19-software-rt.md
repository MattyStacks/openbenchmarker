# P19: Software ray tracing (Ultra and Extreme)

**Track:** Beats · **Depends on:** P18 · **Visitors see:** ray-traced effects on Ultra and Extreme · **Ashen version:** next minor

**Branch:** `feature/p19-software-rt` · **Preview:** `npm run preview:deploy -- p19-software-rt` → `https://p19-software-rt.opengpubenchmarker.com`

## Goal
A top-tier load, honestly labelled: ray tracing in compute shaders, mainly for the city core and the
wet surfaces.

## Read first
- `gpu/cull.ts`
- `citygen.ts`
- the wet-surface material
- the storyboard's City Core frame and "Ultra: RT effects" tier

## Scope
- **Acceleration structure:**
  - a BVH of the static world, built before timing (CPU or compute; this plan decides)
  - dynamic objects handled by a small top-level structure, or excluded from RT and documented
- **Traced effects** (one or more, by preset):
  - reflections on wet roads and puddles, replacing SSR
  - traced shadows for the sun or key fires
  - ray-traced AO
  - optionally one-bounce GI on Extreme
- **Preset fields:**
  - RT mode
  - rays per pixel
  - max distance
  - denoise quality
- **Limits:** if adapter limits block RT, fall back to SSR and record a `fallbackReason`.
- **Copy** on the About page and the tier description: "Software ray tracing in compute shaders. It
  does not use RT cores."
- Update features and `estimateVram`.

## Acceptance
- RT on/off is recorded in features.
- Results are deterministic.
- Ultra and Extreme are measurably heavier than without RT.
- Phones never get RT (Low/Medium/High don't use it).
