# P07: Settings helpers

**Track:** Platform · **Depends on:** P04 · **Visitors see:** tier descriptions, recommended
settings and estimated VRAM for Neon · **Neon version:** unchanged (measurement and output untouched)

## Goal
Add the storyboard's "Settings & Presets" helpers, built per benchmark and shipped first for Neon.

## Read first
- `src/app/home.ts`
- `src/benchmark/presets.ts`
- `src/benchmark/sysinfo.ts`
- `src/benchmark/diagnose.ts`
- `docs/high-res-memory.md`
- the storyboard's "Settings & Presets" panel

## Scope
- **Tier descriptions** from the registry, shown next to each tier:
  - Low: mobile friendly, simplified effects
  - Medium: balanced for most GPUs
  - High: full effects, higher density
  - Ultra: high-end GPUs (Ashen adds "RT effects")
  - Extreme: pushes top hardware, 4K
- **Recommended settings:**
  - a "Recommend for this device" action that **suggests** a tier and resolution from the detected
    device type, GPU label and max texture size
  - it applies only when the visitor taps it, and the suggestion is labelled
  - each benchmark supplies its own `recommend(device)`
  - it never touches `system` fields (honest-data rules)
- **Estimated VRAM:**
  - each benchmark supplies `estimateVram(preset, resolution)`, computed from what it allocates:
    render targets, shadow maps, reflector, textures, buffers
  - shown as "≈ X GB (estimated, benchmark allocations only)"
  - warn when it exceeds a conservative device guess
  - Neon's implementation is checked against `docs/high-res-memory.md`
- "Validate WebGPU support" and "Record actual features used" are always-on behaviours (P09, and
  per-benchmark `getFeatures()`), not toggles.

## Out of scope
Ashen's recommendations and VRAM figures (P22).

## Acceptance
- P01 goldens are unchanged.
- Recommendations never change a setting without a tap.
- Neon's VRAM estimate is within about 15% of measured allocation on the test bench at 4K Extreme
  (record the method in `docs/high-res-memory.md`).
