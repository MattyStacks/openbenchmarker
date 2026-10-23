import { DURATIONS, getPreset, getResolution, normalizeResolution, type PresetId, type ResolutionId, type ScoreTestId } from "../benchmark/presets";
import { emptySystem, unknownDevice, type BenchResult, type BrowserId, type DeviceContext } from "../benchmark/types";
import { normalizeGpuLabel } from "./share-env";

// ---------------------------------------------------------------------------
// Local history (this browser only)
// ---------------------------------------------------------------------------
const STORE_KEY = "ogb.results.v1";
const CONFIG_KEY = "ogb.config.v1";

// "Chrome N" is left out: browserName() also records Samsung Internet, Vivaldi and other Chromium browsers that way.
const BROWSER_BY_NAME: Record<string, BrowserId> = { Brave: "brave", Edge: "edge", Firefox: "firefox", Safari: "safari", Opera: "opera" };

/**
 * Fill `device` for results saved before it existed. Only what is safe is
 * inferred: OS from the user-filled `system.os`, browser from the recorded
 * `diag.browser` ("Edge 141"; not "Chrome", which is ambiguous), GPU label from the recorded renderer.
 * Everything else stays unknown; nothing is guessed.
 */
export function migrateDevice(r: BenchResult): DeviceContext {
  if (r.device?.browser) return { ...unknownDevice(), ...r.device };
  const d = unknownDevice();
  const sysOs = (r.system?.os ?? "").trim();
  if (sysOs === "windows") d.os = "windows";
  else if (sysOs === "linux") d.os = "linux";
  const m = /^(\w+)\s+(\d+)$/.exec((r.diag?.browser ?? "").trim());
  if (m && BROWSER_BY_NAME[m[1]]) {
    d.browser = BROWSER_BY_NAME[m[1]];
    d.browserMajor = parseInt(m[2], 10) || null;
  }
  if (r.diag?.renderer) d.gpuLabel = normalizeGpuLabel(r.diag.renderer, r.diag.vendor);
  return d;
}

function loadHistory(): BenchResult[] {
  try {
    const raw = JSON.parse(localStorage.getItem(STORE_KEY) || "[]");
    return Array.isArray(raw)
      ? raw.map((r) => {
          const base: BenchResult = { ...r, resolution: normalizeResolution(r.resolution), system: { ...emptySystem(), ...(r.system || {}) } };
          return { ...base, device: migrateDevice(base) };
        })
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

/** "Clear my saved results": every saved result in this browser. */
export function clearResults(): void {
  history = [];
  try {
    localStorage.removeItem(STORE_KEY);
  } catch {
    /* storage unavailable: the in-memory list is cleared anyway */
  }
}

// ---------------------------------------------------------------------------
// Last-used run configuration
// ---------------------------------------------------------------------------
export interface RunConfig {
  resolution: ResolutionId;
  preset: PresetId;
  duration: number;
  /** Set only for a locked score test run; never saved as the last-used custom config. */
  scoreTest?: ScoreTestId;
  /** Share code of the run being compared with ("Set up the same test"); copied onto the result. */
  challenge?: string;
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
