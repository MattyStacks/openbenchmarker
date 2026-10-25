# P11: Camera path and beat timeline

**Track:** Ashen foundation · **Depends on:** P10 · **Visitors see:** nothing (`hidden`) · **Ashen version:** 0.4.0

**Branch:** `feature/p11-path-and-beats` · **Preview:** `npm run preview:deploy -- p11-path-and-beats` → `https://p11-path-and-beats.opengpubenchmarker.com`

## Goal
Lock the five-beat journey from the storyboard as data. Every beat exists from day one as greybox
blockout, so later plans replace greybox with real content without changing timing.

## Read first
- the storyboard (whole image)
- `src/engine/path.ts` (Neon's flight pattern)
- `src/engine/ctx.ts` (`onUpdate` contract)
- `src/engine/layout.ts` (`SolidIndex`)
- `src/app/lab.ts`

## Scope
- **`docs/ashen-horizon-storyboard.md`** turns the image into a spec. For each beat:
  - time range, location, camera move, what's in frame, lighting and mood
  - **primary GPU load** and the planned preset scaling
  - beats: Highway → Gas Station → Tunnel → City Approach → City Core (the most demanding)
- **Run length:**
  - recommended: one journey played in full for every duration, with path time scaled to the run
    length, so 30/60/90 s all cover every beat
  - Score tests stay 60 s
  - stress lap length to be decided
  - confirm with Matt
- **Beat timeline:** `src/benchmarks/ashen-horizon/beats.ts`, one entry per beat with:
  - id and normalized `[start, end)` of the journey
  - `build(ctx)`, `status: "built" | "greybox"`
  - camera keyframes (position, look-at, roll, FOV)
- **Path:** a pure `pose(t, variant = 0)` following the `path.ts` pattern:
  - smooth cinematic drone motion with no player controls
  - collision-free against `SolidIndex`-style volumes
- **Greybox** for every beat:
  - highway strip with car boxes
  - gas-station canopy and box
  - tunnel tube
  - city-block boxes, with taller boxes for the core
- **Preview playback rule:** in `preview` status, a run plays only beats with `status: "built"`, in
  order, looping to fill the duration. Greybox beats play only with `?preview=ashen-horizon`.
- **Beat boundaries:** record the frame index at each boundary in the run data, for P20.
- **`lab.ts`:** a beat scrubber and a path preview.

## Out of scope
Real content.

## Acceptance
- Matt approves the storyboard doc and a greybox fly-through of the full journey in `lab.ts`.
- The path is deterministic, and no camera-solid intersections are found by a test that samples the
  path.
