import { sharedRunFrom, type SharedRun } from "../benchmark/share-codec";
import type { BenchResult } from "../benchmark/types";
import { browserLabel, osLabel, settingsLabel } from "./share";

// ---------------------------------------------------------------------------
// Comparing two runs, worded neutrally: comparing browsers or devices is as valid a use as
// comparing with someone else. Pure (no DOM), so the wording is unit-tested.
// ---------------------------------------------------------------------------

/** Within this, two runs are "about the same": run-to-run noise is usually around 1%. */
export const SAME_PCT = 0.5;

const major = (v: string) => v.split(".")[0];
const sameSettings = (a: SharedRun, b: SharedRun) => a.resolution === b.resolution && a.preset === b.preset && a.durationS === b.durationS;

export interface Comparison {
  /** How much faster (+) or slower (−) run B was than run A, in %; null when the versions can't be compared. */
  pct: number | null;
  verdict: string;
  notes: string[];
  likeForLike: boolean;
}

/**
 * Compare run B against run A. Labels name them in the verdict, e.g. ("the shared run", "Your run")
 * gives "Your run was 8.9% faster than the shared run".
 */
export function compareRuns(a: SharedRun, b: SharedRun, labels = { a: "the shared run", b: "Your run" }): Comparison {
  const notes: string[] = [];
  const likeForLike = sameSettings(a, b);
  if (!likeForLike) notes.push(`Not like-for-like: ${labels.a} used ${settingsLabel(a)}, ${labels.b.toLowerCase()} used ${settingsLabel(b)}.`);
  const majorsDiffer = major(a.benchmarkVersion) !== major(b.benchmarkVersion);
  if (majorsDiffer) notes.push(`Different benchmark versions (${major(a.benchmarkVersion)}.x vs ${major(b.benchmarkVersion)}.x), so the FPS can't be compared.`);
  else if (a.benchmarkVersion !== b.benchmarkVersion) notes.push(`Benchmark versions differ (${a.benchmarkVersion} vs ${b.benchmarkVersion}); numbers may differ slightly.`);
  const da = a.device, db = b.device;
  const gpuKnown = !!(da.gpuLabel && db.gpuLabel);
  const sameGpu = gpuKnown && da.gpuLabel === db.gpuLabel;
  const sameBrowser = da.browser === db.browser && da.browser !== "other";
  if (sameGpu && da.os === db.os && da.os !== "other" && !sameBrowser && da.browser !== "other" && db.browser !== "other")
    notes.push(`Same GPU and OS, different browser (${browserLabel(da)} vs ${browserLabel(db)}): this compares browsers.`);
  else if (sameBrowser && gpuKnown && !sameGpu) notes.push(`Same browser, different GPU (${da.gpuLabel} vs ${db.gpuLabel}).`);
  if (majorsDiffer || !(a.avgFps > 0)) return { pct: null, verdict: "", notes, likeForLike };
  const pct = ((b.avgFps - a.avgFps) / a.avgFps) * 100;
  const verdict =
    Math.abs(pct) < SAME_PCT
      ? `About the same: within ${SAME_PCT}% of each other.`
      : `${labels.b} was ${Math.abs(pct).toFixed(1)}% ${pct > 0 ? "faster" : "slower"} than ${labels.a}.`;
  return { pct, verdict, notes, likeForLike };
}

/** "8.9% apart", "about the same" or "" (versions can't be compared). */
export function apartLabel(c: Comparison): string {
  if (c.pct === null) return "";
  return Math.abs(c.pct) < SAME_PCT ? "about the same" : `${Math.abs(c.pct).toFixed(1)}% apart`;
}

/**
 * The viewer's own saved runs that can sit next to a shared run: valid, same major version,
 * resolution and preset. Same duration first, then newest.
 */
export function matchLocal(list: readonly BenchResult[], run: SharedRun): BenchResult[] {
  return list
    .filter((r) => r.valid && major(r.benchmarkVersion) === major(run.benchmarkVersion) && r.resolutionId === run.resolution && r.preset === run.preset)
    .sort((x, y) => Number(y.durationS === run.durationS) - Number(x.durationS === run.durationS) || `${y.date} ${y.time}`.localeCompare(`${x.date} ${x.time}`));
}

/** Other saved runs to compare one of mine against: same settings first, then everything else valid. */
export function otherRunsFor(list: readonly BenchResult[], mine: BenchResult): { run: BenchResult; sameSettings: boolean }[] {
  const me = sharedRunFrom(mine);
  return list
    .filter((r) => r.valid && r.id !== mine.id)
    .map((r) => ({ run: r, sameSettings: sameSettings(me, sharedRunFrom(r)) && major(r.benchmarkVersion) === major(mine.benchmarkVersion) }))
    .sort((x, y) => Number(y.sameSettings) - Number(x.sameSettings) || `${y.run.date} ${y.run.time}`.localeCompare(`${x.run.date} ${x.run.time}`));
}

const who = (r: SharedRun) => [r.device.gpuLabel, browserLabel(r.device)].filter(Boolean).join(" · ");

/** Share text for an invite to compare (link type "challenge"). Neutral: no "beat", no "friend". */
export function inviteText(r: SharedRun): string {
  return `${r.avgFps.toFixed(1)} FPS avg at ${settingsLabel(r)} in the Neon Flythrough browser GPU benchmark (${who(r)}). Run the same test on your device or browser and compare:`;
}

/** Share text for a comparison link. */
export function comparisonText(a: SharedRun, b: SharedRun): string {
  const c = compareRuns(a, b);
  const settings = c.likeForLike ? settingsLabel(a) : `${settingsLabel(a)} vs ${settingsLabel(b)}`;
  const apart = apartLabel(c);
  return `Neon Flythrough at ${settings}: ${b.avgFps.toFixed(1)} vs ${a.avgFps.toFixed(1)} FPS avg${apart ? ` (${apart})` : ""}. ${who(b)} vs ${who(a)}. Compare your own:`;
}

/** Short device text for a comparison column: "Edge 141 · Windows". */
export function browserOs(r: SharedRun): string {
  return [browserLabel(r.device), r.device.os !== "other" ? osLabel(r.device) : ""].filter(Boolean).join(" · ");
}
