import { DURATIONS, getPreset, getResolution, normalizeResolution, type PresetId, type ResolutionId } from "../benchmark/presets";
import { emptySystem, type BenchResult } from "../benchmark/types";

// ---------------------------------------------------------------------------
// Local history (this browser only)
// ---------------------------------------------------------------------------
const STORE_KEY = "ogb.results.v1";
const CONFIG_KEY = "ogb.config.v1";

function loadHistory(): BenchResult[] {
  try {
    const raw = JSON.parse(localStorage.getItem(STORE_KEY) || "[]");
    return Array.isArray(raw)
      ? raw.map((r) => ({ ...r, resolution: normalizeResolution(r.resolution), system: { ...emptySystem(), ...(r.system || {}) } }))
      : [];
  } catch {
    return [];
  }
}
function saveHistory(list: BenchResult[]): void {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(list));
  } catch {
    /* storage unavailable: results still shown for this session */
  }
}
let history = loadHistory();

export function allResults(): BenchResult[] {
  return history;
}
export function reloadResults(): BenchResult[] {
  history = loadHistory();
  return history;
}
export function findResult(id: string): BenchResult | undefined {
  return history.find((x) => x.id === id);
}
export function upsertResult(r: BenchResult): void {
  const i = history.findIndex((x) => x.id === r.id);
  if (i >= 0) history[i] = r;
  else history.unshift(r);
  saveHistory(history);
}
export function removeResult(id: string): void {
  history = history.filter((x) => x.id !== id);
  saveHistory(history);
}

// ---------------------------------------------------------------------------
// Last-used run configuration
// ---------------------------------------------------------------------------
export interface RunConfig {
  resolution: ResolutionId;
  preset: PresetId;
  duration: number;
}

export function loadConfig(): RunConfig {
  const def: RunConfig = { resolution: "1080p", preset: "High", duration: 60 };
  try {
    const c = JSON.parse(localStorage.getItem(CONFIG_KEY) || "{}");
    return {
      resolution: getResolution(c.resolution)?.id ?? def.resolution,
      preset: getPreset(c.preset)?.id ?? def.preset,
      duration: (DURATIONS as readonly number[]).includes(c.duration) ? c.duration : def.duration,
    };
  } catch {
    return def;
  }
}

export function saveConfig(c: RunConfig): void {
  try {
    localStorage.setItem(CONFIG_KEY, JSON.stringify(c));
  } catch {
    /* ignore */
  }
}
