import type { PresetId, ResolutionId } from "./presets";

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
}

export const LINUX_ONLY_FIELDS = ["distro", "kernel", "mesa", "proton"] as const;

export function emptySystem(): SystemInfo {
  return { gpuId: "", os: "", osDetail: "", cpu: "", memoryGb: "", memoryType: "", driver: "", distro: "", kernel: "", mesa: "", proton: "" };
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
  /** Recorded verbatim: "1080p", or "WIDTHxHEIGHT" for Native. */
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
  /** Fraction of timed wall-clock spent inside measured frames (loop busy-ness). */
  loopBusy: number;
  valid: boolean;
  invalidReason: string;
  /** Run on a phone or tablet. Saved and exported locally, but not submittable (yet). */
  mobile?: boolean;
  system: SystemInfo;
}
