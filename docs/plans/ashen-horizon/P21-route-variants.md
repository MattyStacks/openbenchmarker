# P21 (optional): Route variants

**Track:** Extra · **Depends on:** P18 · **Visitors see:** slight route variation on custom runs · **Ashen version:** next minor

**Branch:** `feature/p21-route-variants` · **Preview:** `npm run preview:deploy -- p21-route-variants` → `https://p21-route-variants.opengpubenchmarker.com`

## Goal
Runs feel less canned, like a game where the route differs a little each time, while FPS stays
comparable (README Invariant 8).

## Read first
- `beats.ts`
- `pose(t, variant)` (P11)
- `src/app/lab.ts`

## Scope
- **Variants:** a small set of route branches within beats, e.g. the other side of the gas station,
  the left or right tunnel bore, a different street in the city core. Each branch has the **same beat
  mix and duration**.
- **Seeded variation:** event timing (ash gusts, sign flicker, collapses) and scatter reshuffles
  come from the seed only.
- **Load matching:**
  - `lab.ts` measures each variant against the canonical route on a desktop GPU and a phone
  - variants outside **±2–3%** in GPU time or 1% low get rebalanced or cut
- **Score tests:** always the canonical route with a fixed seed, until P23 decides otherwise.
- `seed` and `variant` are recorded in results, exports and share links.

## Acceptance
- Every shipped variant is within tolerance on both devices.
- Results are reproducible from the seed and variant.
