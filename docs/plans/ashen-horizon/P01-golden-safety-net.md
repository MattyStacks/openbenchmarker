# P01: Golden safety net

**Track:** Platform · **Depends on:** nothing · **Visitors see:** nothing · **Neon version:** unchanged

**Branch:** `feature/p01-golden-safety-net` · **Preview:** `npm run preview:deploy -- p01-golden-safety-net` → `https://p01-golden-safety-net.opengpubenchmarker.com`

## Goal
Freeze Neon Flythrough's current outputs and share behaviour, so every later plan can prove it
changed nothing for Neon.

## Read first
- `src/benchmark/exporter.ts`
- `src/benchmark/share-codec.ts`
- `src/app/share.ts`
- `src/app/store.ts`
- `tests/share-keeps-link.test.ts`
- `tests/share-codec.test.ts`
- `tests/csv.ts`
- `scripts/check-share.mjs`
- `docs/share-links.md`

## Scope
- **Fixtures** in `tests/fixtures/`: saved results covering:
  - normal, Score Entry, Score Extreme, stress (complete and aborted)
  - invalid, mobile, suggested fields, challenge
  - old versions (1.0, 1.1, 2.0, 2.1)
  - pre-diagnostics and pre-`device`
- **Goldens** in `tests/golden/`, plus a test that compares byte for byte:
  - `toYaml`, `toJson`, `toCsv` (single and CSV-all) and `gamesYamlEntry`
  - share text for result, challenge and comparison
  - suggested file names
- **Share links**, which are not byte-frozen (README Invariant 3):
  - a round-trip test: encode → decode → equals the shareable subset of the result, for every
    fixture that can be shared
  - a QR test: the `uqr` matrix on the share card encodes the same URL as the link
- **Share behaviour snapshot:** for each payload type, the `ShareData` handed to `navigator.share`
  has a `#/r/` url, the expected text and no `files`.
- **Storage:** loading every fixture through `store.ts` from a raw `ogb.results.v1` blob gives the
  same objects.
- A `npm run test:golden -- --update` path (or equivalent) that regenerates goldens only when run
  deliberately, documented in the README.

## Out of scope
Any refactor or behaviour change.

## Acceptance
- Goldens are committed and pass.
- Changing one character in any exporter output makes a test fail.
- `npm run check:share` is green.
