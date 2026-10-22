import { getResolution, type PresetId, type ResolutionId, type ScoreTestId } from "../benchmark/presets";

// ---------------------------------------------------------------------------
// Crash detection for runs the OS kills (out of memory on phones). A killed page can't run
// JavaScript, so a small "run in progress" record is written before the run and cleared when it
// ends in any way; a record still there on the next load means the run never finished.
// Local only: nothing here is shared, submitted or sent anywhere.
// ---------------------------------------------------------------------------
export const IN_PROGRESS_KEY = "ogb.runInProgress.v1";
export const UNFINISHED_KEY = "ogb.unfinished.v1";

/** Where the run was when the record was last written: building the scene, warm-up or timed. */
export type RunPhase = "building" | "warmup" | "timed";

export interface InProgressRun {
  resolution: ResolutionId;
  preset: PresetId;
  duration: number;
  scoreTest?: ScoreTestId;
  /** ISO time the run started. */
  startedAt: string;
  phase: RunPhase;
}

/** A resolution/preset combo that didn't finish on this device. Shown as a hint, never blocks. */
export interface UnfinishedCombo {
  resolution: ResolutionId;
  preset: PresetId;
  count: number;
  /** ISO time of the most recent unfinished run. */
  lastAt: string;
  lastPhase: RunPhase;
}

type KV = Pick<Storage, "getItem" | "setItem" | "removeItem">;

/** localStorage, or null where it is unavailable (private mode, blocked storage, Node tests). */
function defaultStore(): KV | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

function read<T>(key: string, store: KV | null): T | null {
  try {
    const raw = store?.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function write(key: string, value: unknown, store: KV | null): void {
  try {
    if (value === null) store?.removeItem(key);
    else store?.setItem(key, JSON.stringify(value));
  } catch {
    /* storage unavailable: crash detection is skipped, the run itself is unaffected */
  }
}

export function beginRun(r: Omit<InProgressRun, "startedAt" | "phase">, now = new Date(), store = defaultStore()): void {
  write(IN_PROGRESS_KEY, { ...r, startedAt: now.toISOString(), phase: "building" } satisfies InProgressRun, store);
}

export function setRunPhase(phase: RunPhase, store = defaultStore()): void {
  const r = read<InProgressRun>(IN_PROGRESS_KEY, store);
  if (r) write(IN_PROGRESS_KEY, { ...r, phase }, store);
}

/** The run ended (finished, invalid, aborted, context lost, failed to start, or the page closed normally). */
export function endRun(store = defaultStore()): void {
  write(IN_PROGRESS_KEY, null, store);
}

export function unfinishedCombos(store = defaultStore()): UnfinishedCombo[] {
  const list = read<UnfinishedCombo[]>(UNFINISHED_KEY, store);
  return Array.isArray(list) ? list.filter((c) => c && getResolution(c.resolution) && typeof c.preset === "string") : [];
}

export function didNotFinish(resolution: string, preset: string, store = defaultStore()): UnfinishedCombo | undefined {
  return unfinishedCombos(store).find((c) => c.resolution === resolution && c.preset === preset);
}

/** A run at this combo finished, so it no longer needs the "didn't finish" hint. */
export function markFinished(resolution: string, preset: string, store = defaultStore()): void {
  const list = unfinishedCombos(store);
  const next = list.filter((c) => !(c.resolution === resolution && c.preset === preset));
  if (next.length !== list.length) write(UNFINISHED_KEY, next.length ? next : null, store);
}

/**
 * Call once on page load. A leftover record means the last run never ended: it is moved into the
 * unfinished list and returned so the page can explain what happened. Returns null otherwise.
 */
export function takeLeftoverRun(store = defaultStore()): InProgressRun | null {
  const r = read<InProgressRun>(IN_PROGRESS_KEY, store);
  write(IN_PROGRESS_KEY, null, store);
  if (!r || !getResolution(r.resolution) || typeof r.preset !== "string") return null;
  const list = unfinishedCombos(store);
  const prev = list.find((c) => c.resolution === r.resolution && c.preset === r.preset);
  const entry: UnfinishedCombo = { resolution: r.resolution, preset: r.preset, count: (prev?.count ?? 0) + 1, lastAt: r.startedAt, lastPhase: r.phase };
  write(UNFINISHED_KEY, [entry, ...list.filter((c) => c !== prev)], store);
  return r;
}

/** The next resolution down to suggest after a run didn't finish; null at 720p (only a lighter preset is left). */
export function saferResolution(r: ResolutionId): ResolutionId | null {
  if (r === "4K" || r === "1440p") return "1080p";
  if (r === "1080p") return "720p";
  return null;
}

/**
 * Combos whose full-size render buffers (canvas, two composer targets, bloom chain, reflector)
 * come to roughly 0.6 GB or more at a phone's 4x MSAA (docs/high-res-memory.md). On the first
 * phone tested, 1440p High (~0.5 GB) finished and 1440p Ultra (~0.7 GB, adds the full-size
 * reflector) crashed; 1080p Extreme (~0.4 GB) finished. 4K Low has no MSAA (~0.4 GB).
 */
export function isMemoryHeavy(r: ResolutionId, preset: PresetId): boolean {
  if (r === "4K") return preset !== "Low";
  if (r === "1440p") return preset === "Ultra" || preset === "Extreme";
  return false;
}

/**
 * Phones and tablets get a one-tap confirmation before a memory-heavy run, unless that
 * resolution and preset has already finished in this browser. Never a hard block.
 */
export function needsHighResWarning(r: ResolutionId, preset: PresetId, mobile: boolean, finished: Iterable<{ resolution: string; preset: string }>): boolean {
  if (!mobile || !isMemoryHeavy(r, preset)) return false;
  for (const f of finished) if (f.resolution === r && f.preset === preset) return false;
  return true;
}

export function leftoverMessage(r: InProgressRun): { title: string; body: string; suggest: ResolutionId | null } {
  const suggest = saferResolution(r.resolution);
  const where = r.phase === "building" ? " while the city was loading" : r.phase === "warmup" ? " during the warm-up" : "";
  const tip = suggest ? `Try ${suggest === "1080p" ? "1080p or 720p" : "720p"}.` : "Try a lighter preset.";
  return {
    title: `Your last run (${r.resolution} · ${r.preset}) didn't finish${where}.`,
    body: `Your browser may have closed it because it ran out of memory. This happens on some phones at higher resolutions. ${tip}`,
    suggest,
  };
}
