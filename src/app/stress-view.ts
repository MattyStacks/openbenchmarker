import { lapChange, stability, stabilityBand, type StabilityBand } from "../benchmark/metrics";
import { STEADY_STABILITY, getStressTest, matchesStressTest, type StressTest } from "../benchmark/presets";
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
  const trend = change !== null && change <= -(1 - STEADY_STABILITY) ? ` The last lap was ${changeText(change)} against the first.` : "";
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
 * Lap avg FPS as a line with a marker per lap. The y axis always spans at least 95%–101% of the
 * fastest lap, so a steady run looks flat and a real drop stands out, whatever the FPS. The hairline
 * marks 97% of the fastest lap (the steady threshold). Hover a marker for its value.
 */
export function lapChartSvg(lapFps: readonly number[], label = "Average FPS per lap"): string {
  const n = lapFps.length;
  if (n === 0) return "";
  const W = 560, H = 190, L = 52, R = 64, T = 14, B = 30;
  const max = Math.max(...lapFps), min = Math.min(...lapFps);
  const hi = max * 1.01;
  const lo = Math.min(min, max * 0.95);
  const step = niceStep(hi - lo, 3);
  const x = (i: number) => (n === 1 ? L + (W - L - R) / 2 : L + (i * (W - L - R)) / (n - 1));
  const y = (v: number) => T + ((hi - v) * (H - T - B)) / (hi - lo);
  const ticks: string[] = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step)
    ticks.push(`<line class="lc-grid" x1="${L}" x2="${W - R}" y1="${y(v).toFixed(1)}" y2="${y(v).toFixed(1)}"/><text class="lc-tick" x="${L - 8}" y="${(y(v) + 4).toFixed(1)}" text-anchor="end">${fmt(v)}</text>`);
  const steadyY = y(max * STEADY_STABILITY).toFixed(1);
  const pts = lapFps.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  const marks = lapFps
    .map(
      (v, i) =>
        `<g class="lc-pt" tabindex="0"><title>Lap ${i + 1}: ${fmt(v)} FPS</title><circle class="lc-hit" cx="${x(i).toFixed(1)}" cy="${y(v).toFixed(1)}" r="14"/><circle class="lc-dot" cx="${x(i).toFixed(1)}" cy="${y(v).toFixed(1)}" r="5"/></g>` +
        `<text class="lc-tick" x="${x(i).toFixed(1)}" y="${H - 8}" text-anchor="middle">Lap ${i + 1}</text>`,
    )
    .join("");
  // Direct labels on the first and last laps only; the table and tooltips carry the rest.
  const ends = [0, n - 1]
    .filter((i, k, a) => a.indexOf(i) === k)
    .map((i) => `<text class="lc-val" x="${(x(i) + (i === n - 1 ? 10 : 0)).toFixed(1)}" y="${(y(lapFps[i]) - 12).toFixed(1)}" text-anchor="${i === n - 1 && n > 1 ? "start" : "middle"}">${fmt(lapFps[i])}</text>`)
    .join("");
  const s = stabilityOf(lapFps)!;
  return `<figure class="lap-chart">
  <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(`${label}: ${lapFps.map((v, i) => `lap ${i + 1} ${fmt(v)}`).join(", ")}. Stability ${pctText(s)}.`)}">
    ${ticks.join("")}
    <line class="lc-steady" x1="${L}" x2="${W - R}" y1="${steadyY}" y2="${steadyY}"/>
    <text class="lc-tick" x="${W - R + 6}" y="${(Number(steadyY) + 4).toFixed(1)}">97%</text>
    <polyline class="lc-line" points="${pts}"/>
    ${marks}${ends}
  </svg>
  <figcaption>${esc(label)}. The faint line is 97% of the fastest lap: laps above it count as steady.</figcaption>
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
      <div class="score"><span>Lap 1 → lap ${lapFps.length}</span><b>${fmt(lapFps[0])} → ${fmt(lapFps[lapFps.length - 1])}</b>${change !== null ? `<span class="score-test">${changeText(change)}</span>` : ""}</div>`;
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
