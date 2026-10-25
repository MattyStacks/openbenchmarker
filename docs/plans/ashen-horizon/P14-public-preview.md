# P14: Public preview

**Track:** Release · **Depends on:** P13 · **Visitors see:** an **Ashen Horizon (Preview)** card,
with the highway beat playable · **Ashen version:** 0.7.0

## Goal
Put Ashen Horizon in front of visitors early. From here on, each beat plan deploys straight into the
public preview.

## Read first
- `src/benchmark/registry.ts`
- `src/app/home.ts` (hub, P04)
- `src/app/results-view.ts`
- `src/app/share.ts`
- `src/app/about-view.ts`
- the storyboard's "Multi-Benchmark Platform", "Platform Support" and "Results & Sharing" panels

## Scope
- Set `status: "preview"`.
- **Hub card:**
  - thumbnail captured from the highway
  - WebGPU badge, **Preview** badge
  - blurb: "A cinematic, post-apocalyptic scene built to push modern GPUs with advanced rendering
    techniques."
  - Run Benchmark
- **Settings:**
  - tiers, resolutions and durations as for Neon
  - **no Score tests or stress tests** while in preview (hidden, with a short "Coming at 1.0" note)
- **Results:**
  - labelled "Preview v0.x: not comparable across preview versions"
  - JSON and CSV export, and sharing, all work
  - YAML shows "Submissions open at 1.0"
- **Share card:** Ashen theme (grey ash, ember accents) from `getShareCard()`, with the Preview label.
- **About:** an Ashen Horizon section (what a run does, beats built so far, the preview caveat, WebGPU
  requirements link) and the Linux note.
- Run playback follows the P11 rule: only built beats, looping.

## Out of scope
New content.

## Acceptance
- Every README Invariant 4 gate passes for an Ashen preview result on an iPhone and one desktop.
- Neon goldens are unchanged.
- Matt approves the preview deploy before `npm run deploy`.
