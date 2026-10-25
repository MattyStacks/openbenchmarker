# P06: Share codec v2 and share card

**Track:** Platform · **Depends on:** P05 · **Visitors see:** a new link format, and GPU frame time
on the card and shared view · **Neon version:** unchanged

## Goal
A share-link format that handles several benchmarks cleanly, and a share card that matches the
storyboard's results panel. **Sharing must not regress at any point** (README Invariant 4).

## Read first
- `docs/share-links.md` (whole file, including the share-flow history)
- `src/benchmark/share-codec.ts`
- `src/app/share.ts`
- `src/app/shared-view.ts`
- `src/app/share-env.ts`
- `tests/share-codec.test.ts`
- `tests/share-keeps-link.test.ts`
- `tests/share-env.test.ts`
- `scripts/check-share.mjs`
- the storyboard's "Results & Sharing" panel

## Scope
- **Review the v1 format against what it now needs to carry:**
  - several benchmarks with **per-benchmark feature fields**
  - `graphicsApi: "WebGPU"`
  - GPU frame time (`diag.gpuMs`)
  - benchmark status (preview results are marked)
  - optional `seed` and `variant` (Ashen only)
  - stress laps, comparisons and challenges
- **Decide:** extend v1, or replace it with v2 (e.g. a shared header plus a per-benchmark field
  section with its own table). Breaking old links is allowed (Invariant 3). Choose whichever is
  simpler to maintain for two or more benchmarks and stays QR-friendly.
- **Card** (`getShareCard()` per benchmark):
  - benchmark name, API badge
  - preset · resolution · duration
  - Score (only on Score tests), Avg FPS, 1% Low, **GPU frame time** when known
  - a Preview label when the result came from a preview version
- **Shared view:** shows GPU frame time when present.
- Update `docs/share-links.md`: layout, length and QR-size table.
- Tests:
  - round-trip (P01) on the new format
  - a fake second benchmark round-trips
  - unknown benchmark, newer version and tampered links decode to the right errors
- Extend `check:share` to seed a fake-benchmark result and click its Share buttons.

## Out of scope
Ashen's real feature fields (P08 fills in the table entries).

## Acceptance
- Every README Invariant 4 gate passes, including the manual iPhone and desktop Test steps recorded in
  the device table.
- QR codes still scan off a full-screen card and off a screenshot sent through iMessage.
- Exports are unchanged (P01 goldens).
