# P22: Preset tuning

**Track:** Release · **Depends on:** P19 · **Visitors see:** final presets, VRAM estimates and
recommendations for Ashen · **Ashen version:** next minor

## Goal
Make the five tiers mean something across real hardware, from phones to the test bench.

## Read first
- every Ashen preset field in the registry
- `estimateVram`
- `recommend`
- `docs/device-test-matrix.md`
- `docs/high-res-memory.md`

## Scope
- **Targets:**
  - Low/720p runs smoothly on a current iPhone and a mid-range Android
  - Extreme/4K keeps the fastest current consumer GPU on the test bench well short of coasting, and
    GPU-bound
  - Medium, High and Ultra are spaced roughly evenly in GPU cost
- **VRAM:** Ashen's `estimateVram` matches measured allocation within about 15% at every tier, and
  Extreme at 4K stays inside a documented budget.
- **Recommendations:** Ashen's `recommend(device)` maps device types and GPU classes to a tier and
  resolution (P07 rules: suggestion only).
- **Tier descriptions** final, including "RT effects" on Ultra and Extreme.
- Record the tuning data (GPU, tier, resolution, FPS, GPU-busy) in `docs/ashen-horizon-tuning.md`.

## Acceptance
- Every target above is met and recorded.
- No tier exceeds the VRAM budget.
