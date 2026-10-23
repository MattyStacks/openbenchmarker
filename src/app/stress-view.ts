import { lapChange, stability, stabilityBand, type StabilityBand } from "../benchmark/metrics";
import { STEADY_STABILITY, getStressTest, matchesStressTest, type StressTest } from "../benchmark/presets";
import type { SharedRun } from "../benchmark/share-codec";
import type { BenchResult } from "../benchmark/types";
import { esc } from "./dom";

// ---------------------------------------------------------------------------
// Stress tests on the results, shared and comparison pages: stability, the plain-words reading,
// the lap chart and the lap table. The text helpers are pure (no DOM), so they're unit-tested.
// ---------------------------------------------------------------------------

/** "96.4%" */
export const pctText = (x: number) => `${(x * 100).toFixed(1)}%`;
/** "+1.2%" or "−3.5%" */
export const changeText = (x: number) => `${x >= 0 ? "+" : "−"}${Math.abs(x * 100).toFixed(1)}%`;

/** The stress test a saved result completed: valid, locked settings, every lap. Undefined otherwise. */
export function completedStress(r: BenchResult): StressTest | undefined {
  const t = getStressTest(r.stressTest);
  return t && r.valid && matchesStressTest(t, r.preset, r.resolution, r.width, r.height, r.durationS, r.laps?.length ?? 0) ? t : undefined;
}

/** "96.4%": a shared stress run's stability; "" for other runs. */
export function stabilityPct(r: SharedRun): string {
  const s = r.stress ? stabilityOf(r.stress.laps) : null;
  return s === null ? "" : pctText(s);
}

/** Stability of a list of lap avg FPS values; null when there are none. */
export function stabilityOf(lapFps: readonly number[]): number | null {
  return stability(lapFps.map((avgFps) => ({ avgFps, p1Low: 0 })));
}

export interface StressReading {
  band: StabilityBand;
  title: string;
  body: string;
}

/** What a run's laps say, in plain words. `cpuLimited` comes from the run's diagnosis. */
export function stressReading(lapFps: readonly number[], cpuLimited = false): StressReading | null {
  const s = stabilityOf(lapFps);
  if (s === null) return null;
  const band = stabilityBand(s);
  const drop = pctText(1 - s);
  const change = lapChange(lapFps.map((avgFps) => ({ avgFps, p1Low: 0 })));
  // Say how the last lap compares with the first, unless that's the same drop (fastest first, slowest last).
  const trend =
    change === null || change > -(1 - STEADY_STABILITY)
      ? ""
      : Math.abs(-change - (1 - s)) < 0.0005
        ? " It got slower from the first lap to the last."
        : ` The last lap was ${pctText(-change)} slower than the first.`;
  const text: Record<StabilityBand, [string, string]> = {
    steady: ["Steady: no sign of throttling", `The slowest lap was within ${drop} of the fastest, so performance held for the whole run.`],
    slowed: [
      "Slowed a little",
      `The slowest lap was ${drop} below the fastest.${trend} A small drop like this is often the GPU easing off its boost clock as it warms up, or other work on the device during one lap.`,
    ],
    throttled: [
      "Throttled: performance fell as the run went on",
      `The slowest lap was ${drop} below the fastest.${trend} This usually means the device slowed itself down as it heated up (thermal throttling), hit a power limit, or switched to a battery saver.`,
    ],
  };
  const [title, body] = text[band];
  const cpu = cpuLimited ? " This run was limited by the CPU or browser rather than the GPU, so a drop here points at the processor slowing down." : "";
  return { band, title, body: `${body}${cpu}` };
}

/** Clean tick step (1, 2 or 5 × 10^n) for about `count` intervals over `span`. */
function niceStep(span: number, count: number): number {
  const raw = span / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const f = raw / mag;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * mag;
}

const fmt = (x: number) => (x >= 1000 ? Math.round(x).toLocaleString("en-US") : x.toFixed(1));

/**
 * One drawing of the lap chart, `W` wide in SVG units. The page shows each at about 1:1 (see
 * lapChartSvg), so the 12 px labels stay 12 px on screen.
 */
function lapPlot(lapFps: readonly number[], W: number, cls: string): string {
  const n = lapFps.length;
  const H = 180, L = 52, R = 28, T = 16, B = 28;
  const max = Math.max(...lapFps), min = Math.min(...lapFps);
  const hi = max * 1.01;
  const lo = Math.min(min, max * 0.95);
  const x = (i: number) => (n === 1 ? L + (W - L - R) / 2 : L + (i * (W - L - R)) / (n - 1));
  const y = (v: number) => T + ((hi - v) * (H - T - B)) / (hi - lo);
  const f = (v: number) => v.toFixed(1);
  const steadyY = y(max * STEADY_STABILITY);
  // The 97% line is labelled on the axis like a tick; value ticks that would touch it are dropped.
  const step = niceStep(hi - lo, 3);
  const ticks: string[] = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step)
    if (Math.abs(y(v) - steadyY) >= 14)
      ticks.push(`<line class="lc-grid" x1="${L}" x2="${W - R}" y1="${f(y(v))}" y2="${f(y(v))}"/><text class="lc-tick" x="${L - 8}" y="${f(y(v) + 4)}" text-anchor="end">${fmt(v)}</text>`);
  const pts = lapFps.map((v, i) => `${f(x(i))},${f(y(v))}`).join(" ");
  const marks = lapFps
    .map(
      (v, i) =>
        `<g class="lc-pt" tabindex="0"><title>Lap ${i + 1}: ${fmt(v)} FPS</title><circle class="lc-hit" cx="${f(x(i))}" cy="${f(y(v))}" r="14"/><circle class="lc-dot" cx="${f(x(i))}" cy="${f(y(v))}" r="5"/></g>` +
        `<text class="lc-tick" x="${f(x(i))}" y="${H - 6}" text-anchor="middle">${n > 8 ? i + 1 : `Lap ${i + 1}`}</text>`,
    )
    .join("");
  // Direct labels on the first and last laps only, above their markers and anchored inward (clear of
  // the axis labels); the table and tooltips carry the rest.
  const ends = [...new Set([0, n - 1])]
    .map((i) => `<text class="lc-val" x="${f(x(i))}" y="${f(y(lapFps[i]) - 12)}" text-anchor="${n === 1 ? "middle" : i === 0 ? "start" : "end"}">${fmt(lapFps[i])}</text>`)
    .join("");
  return `<svg class="${cls}" viewBox="0 0 ${W} ${H}" aria-hidden="true">
    ${ticks.join("")}
    <line class="lc-steady" x1="${L}" x2="${W - R}" y1="${f(steadyY)}" y2="${f(steadyY)}"/>
    <text class="lc-tick lc-steady-label" x="${L - 8}" y="${f(steadyY + 4)}" text-anchor="end">97%</text>
    <polyline class="lc-line" points="${pts}"/>
    ${marks}${ends}
  </svg>`;
}

/**
 * Lap avg FPS as a line with a marker per lap. The y axis always spans at least 95%–101% of the
 * fastest lap, so a steady run looks flat and a real drop stands out, whatever the FPS. The hairline
 * marks 97% of the fastest lap (the steady threshold). Hover a marker for its value. Drawn twice,
 * narrow for phones and wide for larger screens; CSS shows one.
 */
export function lapChartSvg(lapFps: readonly number[], label = "Average FPS per lap"): string {
  if (lapFps.length === 0) return "";
  const s = stabilityOf(lapFps)!;
  return `<figure class="lap-chart" role="img" aria-label="${esc(`${label}: ${lapFps.map((v, i) => `lap ${i + 1} ${fmt(v)}`).join(", ")}. Stability ${pctText(s)}.`)}">
  ${lapPlot(lapFps, 340, "lc-narrow")}${lapPlot(lapFps, 640, "lc-wide")}
  <figcaption>${esc(label)}. The faint line marked 97% is 97% of the fastest lap: laps above it count as steady.</figcaption>
</figure>`;
}

/** Lap table: avg FPS, change against lap 1 and (local results only) each lap's 1% low. */
export function lapTableHtml(lapFps: readonly number[], lapP1?: readonly number[]): string {
  if (lapFps.length === 0) return "";
  const rows = lapFps
    .map(
      (v, i) =>
        `<tr><td>Lap ${i + 1}</td><td class="num">${fmt(v)}</td><td class="num">${i === 0 ? "–" : changeText(v / lapFps[0] - 1)}</td>${lapP1 ? `<td class="num">${fmt(lapP1[i])}</td>` : ""}</tr>`,
    )
    .join("");
  return `<table class="lap-table"><thead><tr><th>Lap</th><th class="num">Avg FPS</th><th class="num">vs lap 1</th>${lapP1 ? `<th class="num">1% low</th>` : ""}</tr></thead><tbody>${rows}</tbody></table>`;
}

/** Score cards that lead a completed stress run: stability, avg over all laps, first → last lap. */
export function stressCardsHtml(test: StressTest, lapFps: readonly number[], avgFps: number): string {
  const s = stabilityOf(lapFps)!;
  const change = lapChange(lapFps.map((avgFps) => ({ avgFps, p1Low: 0 })));
  return `<div class="score hero-score"><span>${esc(test.name)} · stability</span><b id="res-stability">${pctText(s)}</b><span class="score-test">slowest lap ÷ fastest lap</span></div>
      <div class="score"><span>Average FPS (all laps)</span><b id="res-avg">${avgFps.toFixed(1)}</b></div>
      <div class="score"><span>Last lap (lap ${lapFps.length})</span><b>${fmt(lapFps[lapFps.length - 1])}</b><span class="score-test">lap 1: ${fmt(lapFps[0])}${change !== null ? ` · ${changeText(change)}` : ""}</span></div>`;
}

/** The laps section: reading, chart and table. */
export function lapsSectionHtml(lapFps: readonly number[], lapP1?: readonly number[], cpuLimited = false, complete = true): string {
  if (lapFps.length === 0) return "";
  const reading = complete ? stressReading(lapFps, cpuLimited) : null;
  return `<section class="laps-section" aria-labelledby="laps-title">
    <h2 class="section-title" id="laps-title">Laps</h2>
    ${reading ? `<div class="stress-reading" data-band="${reading.band}"><p><b>${esc(reading.title)}.</b> ${esc(reading.body)}</p><p class="muted tiny">A browser can't read temperatures or clock speeds, so this comes from the frame rate alone.</p></div>` : ""}
    ${lapChartSvg(lapFps)}
    ${lapTableHtml(lapFps, lapP1)}
  </section>`;
}
