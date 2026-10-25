# PMxx: <model set name> (template)

Copy this file to `PMxx-<slug>.md` for each model set, e.g. `PM02-highway-vehicles.md`, and fill it
in.

**Track:** 3D models · **Depends on:** PM01, and the beat it serves if it replaces procedural props · **Visitors see:** better models in <beat> · **Ashen version:** next minor

**Branch:** `feature/pmxx-<slug>` · **Preview:** `npm run preview:deploy -- pmxx-<slug>` → `https://pmxx-<slug>.opengpubenchmarker.com`

## Goal
Build the hand-made models for <beat>, so it matches the storyboard frame more closely than
procedural geometry can.

## Read first
- README Invariant 7
- `PM01-asset-pipeline.md`
- the beat's plan and its "Model candidates" list
- the storyboard frame for the beat
- `docs/ashen-horizon-storyboard.md`

## Scope
- **Models:** list each one with its role, e.g. a hero wrecked sedan with 3 damage variants, gas
  pumps, the canopy, a "GAS" sign. Give each a target triangle count per LOD and a texture budget.
- **Variation:** procedural variation on top of the models (seeded colour, rust, ash, decals,
  rotation), so instancing doesn't look repeated.
- **Build:** run through `scripts/build-assets.mjs`, and record licences in `LICENSES.md`.
- **Integration:** replace the beat's procedural stand-ins; keep procedural props where they already
  look fine.
- **Budgets to record in the PR:**
  - download size per tier (Low must stay small for phones)
  - VRAM added per tier (update `estimateVram`)
  - FPS impact at Low/720p on a phone and Extreme/4K on the test bench

## Acceptance
- Matt approves the look on the branch preview.
- Per-tier download size and VRAM are within budget.
- No downloads after timing starts.
- Results are still deterministic.
