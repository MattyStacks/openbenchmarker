# P04: Benchmarks hub

**Track:** Platform · **Depends on:** P03 · **Visitors see:** the new hub with a Neon card, a Future
Benchmarks card and the new nav · **Neon version:** unchanged

## Goal
Build the storyboard's "Multi-Benchmark Platform" home with Neon as the only real card. Settings
render from the selected benchmark.

## Read first
- `index.html` (nav and home markup)
- `src/app/home.ts`
- `src/app/router.ts`
- `src/app/shell.ts`
- `src/app/store.ts` (`ogb.config.v1`)
- `src/style.css`
- `tests/home-layout.test.ts`
- the storyboard panels "Multi-Benchmark Platform" and "Settings & Presets"

## Scope
- **Nav:** decide between the storyboard's Benchmarks / Results / Compare / About and the current
  Benchmark / My Results / About (open question in the README). Every existing hash keeps working:
  `#/`, `#/result/…`, `#/r/…`, `#/history`, `#/about…`.
- **Hub cards**, one per benchmark with status `preview` or `live`:
  - thumbnail (a static image generated with `scripts/capture.mjs`, kept in `public/`)
  - name, API badge (WebGL2 / WebGPU), status badge (Current / New / Preview), one-line blurb
  - Run Benchmark
- **Future Benchmarks** placeholder card (non-interactive): "Additional benchmarks can be added
  using the same interface and system."
- **Selecting a card** shows that benchmark's settings:
  - tiers, resolution, duration, Score tests and stress tests, all from the registry
  - Run starts that benchmark
- **Routing:** `#/b/<id>` selects a benchmark, and `#/` defaults to the last-used benchmark, falling
  back to Neon. Remember the last-used benchmark in `ogb.config.v1` as a new optional key; old configs
  default to Neon.
- **Hidden benchmarks** never appear on the hub. `?preview=<id>` shows them for testing (it may be
  remembered in `sessionStorage`, never a cookie).
- Phone-first layout: no sideways scroll at 390 px, and update `home-layout.test.ts`.
- Fix storyboard copy typos ("Neen" → "Neon").

## Out of scope
Results views, the Ashen card (P14), recommended settings (P07).

## Acceptance
- P01 goldens are unchanged.
- An old `ogb.config.v1` still restores the last settings.
- Every old hash works.
- `check:share` is green.
- Checked at phone and desktop width.
