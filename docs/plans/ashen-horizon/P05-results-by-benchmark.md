# P05: Results by benchmark

**Track:** Platform · **Depends on:** P04 · **Visitors see:** benchmark badges and a filter in My
Results · **Neon version:** unchanged

## Goal
Results, history, compare and About are ready for more than one benchmark, and never mix them.

## Read first
- `src/app/history-view.ts`
- `src/app/results-view.ts`
- `src/app/compare-view.ts`
- `src/app/compare.ts`
- `src/app/about-view.ts`
- `src/app/result-display.ts`
- `tests/compare.test.ts`
- `tests/about.test.ts`

## Scope
- **My Results:**
  - each row shows a benchmark badge (name + API)
  - a benchmark filter, kept in memory only like the other filters today
  - per-benchmark sorting and averages
- **Compare:**
  - refuses to compare results from different benchmarks, with a clear message
  - challenge links from one benchmark can't be answered with a run of another
- **Results page:** a header with the benchmark name, API badge and settings line (preset · resolution
  · duration), as on the storyboard's results card.
- **CSV-all** stays one file. The `game_id` column already separates benchmarks; byte-identical for
  Neon-only history.
- **About page:** a per-benchmark "how a run works" section. Neon's text is unchanged, and the
  structure is ready for Ashen's section.
- Tests use the fake second benchmark from P03 to show mixed history behaves correctly.

## Out of scope
Share card and codec (P06).

## Acceptance
- P01 goldens are unchanged.
- The mixed-history fixture test passes.
- `check:share` (including My Results rows) is green.
