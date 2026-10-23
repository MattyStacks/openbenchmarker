import type { TimingMethod } from "./metrics";
import type { PresetId, ResolutionId, ScoreTestId, StressTestId } from "./presets";

export type GraphicsApi = "WebGL2" | "WebGL1";

export type BrowserId = "chrome" | "edge" | "brave" | "firefox" | "safari" | "opera" | "vivaldi" | "samsung" | "other";
export type OsId = "windows" | "macos" | "linux" | "chromeos" | "android" | "ios" | "other";
export type DeviceType = "phone" | "tablet" | "desktop" | "unknown";

/**
 * Device context detected by the browser, for display and sharing only.
 * Deliberate exception to the browser-hints rule: it lives in its own field,
 * never fills `system` and is never submitted (see README honest-data rules).
 * `gpuLabel` is the WebGL renderer as reported by the browser, normalized;
 * null when the browser masks it or it carries no usable name.
 */
export interface DeviceContext {
  browser: BrowserId;
  browserMajor: number | null;
  os: OsId;
  deviceType: DeviceType;
  /** True on iOS/iPadOS, where every browser runs on WebKit. */
  webkitEngine: boolean;
  gpuLabel: string | null;
}

export function unknownDevice(): DeviceContext {
  return { browser: "other", browserMajor: null, os: "other", deviceType: "unknown", webkitEngine: false, gpuLabel: null };
}

/**
 * Everything the user provides. Fields start blank, except a marked best guess for details a
 * browser can't read (listed in BenchResult.suggested; the user can change or clear it).
 * Field rules live in the registry, src/benchmark/fields.ts.
 */
export interface SystemInfo {
  gpuId: string;
  os: string; // "" | "windows" | "linux"
  osDetail: string;
  cpu: string;
  memoryGb: string;
  memoryType: string;
  /** Whole number of memory channels in use, as digits; upstream memory_channels. */
  memoryChannels: string;
  driver: string;
  // Linux-only
  distro: string;
  kernel: string;
  mesa: string;
  proton: string;
  /** "" (not said), "yes" or "no": whether the GPU ran above its stock clocks or power limit. */
  overclocked: string;
}

export { LINUX_ONLY_FIELDS, emptySystem } from "./fields";

/**
 * Raw signals behind the "what limited this run" diagnosis, measured or detected by the run.
 * Stored as numbers so the verdict can be recomputed (src/benchmark/diagnose.ts).
 */
export interface RunDiagnostics {
  /** Share of timed wall-clock the GPU was busy with our frames (0-1); null without GPU timers. */
  gpuBusy: number | null;
  /** Mean GPU time per frame, ms; null without GPU timers. */
  gpuMs: number | null;
  /** Mean JS time per frame inside the frame calls (scene update + draw submission), ms. */
  cpuMs: number;
  /** The scene-update part of cpuMs, ms. */
  updateMs: number;
  /** Mean time per frame blocked waiting for the GPU at batch readbacks, ms. */
  syncMs: number;
  /** Mean wall-clock per frame (1000 / Avg FPS), ms. */
  frameMs: number;
  /** Main-thread stalls: yields delayed more than STALL_MS by other work. */
  stalls: number;
  stallMs: number;
  hitches: number;
  /** Hitches from GPU time alone (absent before 2.2.0). */
  gpuHitches?: number;
  frameStdMs: number;
  /** JS heap growth over the timed phase, MB (Chromium only). */
  heapGrowthMb: number | null;
  /** Detected by the browser; never used to fill user-provided fields. */
  renderer: string;
  vendor: string;
  /** ANGLE backend parsed from the renderer string (D3D11, Vulkan, OpenGL, Metal, ...), or "". */
  backend: string;
  maxTextureSize: number;
  cpuThreads: number | null;
  /** True if the device was running on battery at the start or end of the run; null if unknown. */
  onBattery: boolean | null;
  /** Browser name and major version, e.g. "Chrome 141". */
  browser: string;
  /** What the scene actually rendered with. */
  features: { bloom: boolean; msaa: number; shadowMap: number; reflections: number; /** Ray-march steps (absent before 2.2.0). */ volumetrics?: number; fallbackReason: string };
}

/** One lap of a stress test (one pass of the 96 s flight). */
export interface LapStat {
  avgFps: number;
  p1Low: number;
}

/** A completed run. Everything outside `system` is measured by the tool. */
export interface BenchResult {
  id: string;
  gameId: string;
  benchmarkVersion: string;
  /** Local run date YYYY-MM-DD and time HH:MM. */
  date: string;
  time: string;
  resolutionId: ResolutionId;
  /** Recorded verbatim: "720p", "1080p", "1440p" or "4K" ("WIDTHxHEIGHT" on old Native results). */
  resolution: string;
  width: number;
  height: number;
  preset: PresetId;
  durationS: number;
  graphicsApi: GraphicsApi;
  avgFps: number;
  p1Low: number;
  p5Low: number;
  worstMs: number;
  frameCount: number;
  /** Fraction of timed wall-clock spent rendering batches rather than yielding or updating the HUD. */
  loopBusy: number;
  /** How the per-frame times behind the lows were measured. Absent on 1.0.0 results (per-frame readback). */
  timing?: TimingMethod;
  valid: boolean;
  invalidReason: string;
  /** Run on a phone or tablet. Saved and exported locally, but not submittable (yet). */
  mobile?: boolean;
  /** Set when the run was started as a locked score test. */
  scoreTest?: ScoreTestId;
  /** Only on valid runs whose settings match `scoreTest` exactly (see scoreFor). */
  score?: number;
  /** Set when the run was started as a locked stress test (never together with scoreTest). */
  stressTest?: StressTestId;
  /** Stress runs only: every lap that finished, in order (an aborted run keeps the ones it completed). */
  laps?: LapStat[];
  /** Absent on results from before diagnostics were recorded. */
  diag?: RunDiagnostics;
  /** Device context as reported by the browser; display/sharing only, never submitted. Absent before Plan 1. */
  device?: DeviceContext;
  /**
   * The shared run this one was compared with (its share-link code, link type "challenge"), kept so
   * the comparison can be looked at again. Local only: never submitted, stripped from JSON export.
   */
  challenge?: string;
  system: SystemInfo;
  /**
   * System fields holding a suggested value (our best guess) the user hasn't confirmed, e.g.
   * memoryChannels on phones. Editing a field removes it from this list. Absent when none.
   */
  suggested?: (keyof SystemInfo)[];
}
