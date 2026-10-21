import type { TimingMethod } from "./metrics";
import type { PresetId, ResolutionId, ScoreTestId } from "./presets";

export type GraphicsApi = "WebGL2" | "WebGL1";

/** Everything the user provides. Every field starts blank; nothing is ever auto-filled. */
export interface SystemInfo {
  gpuId: string;
  os: string; // "" | "windows" | "linux"
  osDetail: string;
  cpu: string;
  memoryGb: string;
  memoryType: string;
  driver: string;
  // Linux-only
  distro: string;
  kernel: string;
  mesa: string;
  proton: string;
  /** "" (not said), "yes" or "no": whether the GPU ran above its stock clocks or power limit. */
  overclocked: string;
}

export const LINUX_ONLY_FIELDS = ["distro", "kernel", "mesa", "proton"] as const;

export function emptySystem(): SystemInfo {
  return { gpuId: "", os: "", osDetail: "", cpu: "", memoryGb: "", memoryType: "", driver: "", distro: "", kernel: "", mesa: "", proton: "", overclocked: "" };
}

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
  features: { bloom: boolean; msaa: number; shadowMap: number; reflections: number; fallbackReason: string };
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
  /** Absent on results from before diagnostics were recorded. */
  diag?: RunDiagnostics;
  system: SystemInfo;
}
