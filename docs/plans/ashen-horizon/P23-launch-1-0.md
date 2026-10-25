# P23: Launch Ashen Horizon 1.0

**Track:** Release · **Depends on:** P22 · **Visitors see:** Ashen Horizon 1.0 with Score tests,
submissions and a **New** badge · **Ashen version:** 1.0.0

## Goal
Ashen Horizon leaves preview.

## Read first
- the README open questions
- `src/benchmark/registry.ts`
- `src/benchmark/validate.ts`
- `src/benchmark/exporter.ts`
- `docs/share-links.md`
- `docs/upstream-submission-changes.md`
- `docs/device-test-matrix.md`

## Scope
- **Decide with Matt and record in the README:**
  - **Score formula and scale.** The storyboard mockup shows 8,432 at 120.4 FPS, not ×100. It stays
    per benchmark, and Neon's is unchanged.
  - **Linux policy:** allow submissions from the default-on configurations (Chrome on Intel Gen12+,
    NVIDIA 535.183.01+ on Wayland), or none yet. Flagged setups stay local-only either way.
  - Whether the official-vs-community chart split and the extra CPU test beds (OptiPlex 9020,
    5600X3D) apply to Ashen.
- **Lock** `scoreTests` (Entry and Extreme: preset, resolution, duration, canonical route, fixed
  seed), `stressTests` and the lap length.
- **Variance validation:**
  - on the test bench, 5 runs per Score test to measure run-to-run noise
  - if P21 shipped, measure the variants against that noise
  - publish the measured spread on the About page
- Set `status: "live"` and version `1.0.0`:
  - the Preview badge becomes **New**, and Neon's badge stays **Current**
  - Score and stress tests appear
  - YAML submission is enabled (subject to the Linux policy)
- **Upstream:** `gamesYamlEntry` for Ashen. Prepare the upstream `games.yaml` PR and mark it in
  `docs/upstream-todos.md`.
- **Share links:** freeze the format, add real-link decode fixtures to `share-keeps-link.test.ts`, and
  state in `docs/share-links.md` that links decode forever from here on.
- **Device matrix** in `docs/device-test-matrix.md`:
  - Windows: Chrome, Edge, Firefox
  - macOS: Safari, Chrome
  - iOS 26 Safari, Android Chrome
  - Linux Chrome default-on (Intel Gen12+, NVIDIA on Wayland) and flagged (local only)
- **README:** Ashen sections (how a run works, beats, presets, measurement notes, Linux policy,
  software-RT label) and the updated "Layout".
- `TODO.md`: official Ashen runs on the test bench.

## Acceptance
- The device matrix passes.
- All goldens pass.
- A full export, share and submit dry run works for both benchmarks.
- Invariant 4 gates pass.
- Matt approves the preview deploy before production.
