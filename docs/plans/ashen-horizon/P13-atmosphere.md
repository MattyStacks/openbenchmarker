# P13: Highway, part 2: atmosphere

**Track:** Beats · **Depends on:** P12 · **Visitors see:** nothing (`hidden`) · **Ashen version:** 0.6.0

**Branch:** `feature/p13-atmosphere` · **Preview:** `npm run preview:deploy -- p13-atmosphere` → `https://p13-atmosphere.opengpubenchmarker.com`

## Goal
Give the highway the storyboard look (volumetric fog, falling ash, wet surfaces, overcast light), as
modules the later beats reuse and push harder.

## Read first
- `docs/ashen-horizon-storyboard.md` (Highway)
- the storyboard's Highway frame
- `src/engine/volumetric.ts` (Neon's ray-march, for reference only)
- `docs/high-res-memory.md`

## Scope
- **Froxel volumetric fog** (`gpu/froxels.ts`):
  - a compute 3D grid with temporal reprojection
  - lit by the sun and any local lights registered by beats
  - preset fields: grid resolution, steps, temporal history
- **Ash particles** (`gpu/particles.ts`):
  - compute simulation with a wind field and collision against the heightfield
  - lit by the fog volume
  - preset: particle count, reaching millions on Extreme
  - reused later for smoke and embers
- **Wet surfaces:** a shared material with puddle masks and wetness on the road and car bodies.
  Reflections use screen-space reflections here; P19 adds traced reflections on Ultra/Extreme.
- **Sky and lighting:**
  - overcast sky and cloud layer
  - dim directional light through cloud, with cascaded shadow maps (preset: resolution, cascades)
  - a desaturated grade with tone mapping
- **Anti-aliasing:** decide between TAA and MSAA with Matt (open question). Record the choice in
  features.
- Check the VRAM budget at 4K Extreme and feed the allocations into `estimateVram`.

## Out of scope
Local lights and interiors (P15), auto-exposure (P16).

## Acceptance
- Visuals match the storyboard's mood (Matt signs off on the preview deploy).
- Deterministic per `t`.
- Features are recorded.
- No hitches from shader compiles during timing.
