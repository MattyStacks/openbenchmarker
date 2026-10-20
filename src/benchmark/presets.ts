export type ResolutionId = "720p" | "1080p" | "1440p" | "4K" | "native";

export interface Resolution {
  id: ResolutionId;
  label: string;
  width: number;
  height: number;
}

/**
 * Fixed render sizes, named the way upstream records them (720p, 1080p, 1440p, 4K).
 * "native" is resolved at run time from the display.
 */
export const RESOLUTIONS: Resolution[] = [
  { id: "720p", label: "720p (1280×720)", width: 1280, height: 720 },
  { id: "1080p", label: "1080p (1920×1080)", width: 1920, height: 1080 },
  { id: "1440p", label: "1440p (2560×1440)", width: 2560, height: 1440 },
  { id: "4K", label: "4K (3840×2160)", width: 3840, height: 2160 },
  { id: "native", label: "Native", width: 0, height: 0 },
];

export type PresetId = "Low" | "Medium" | "High" | "Ultra" | "Extreme";

export interface Preset {
  id: PresetId;
  buildings: number;
  rain: number;
  signs: number;
  cars: number;
  drones: number;
  holos: number;
  /** UnrealBloom strength; 0 disables the composer (plain render). */
  bloom: number;
  /** Shadow map size; 0 disables shadows. */
  shadowMap: number;
  /** Composer render-target MSAA samples. */
  msaa: number;
  /** Reflector render scale; 0 disables planar reflections. */
  reflections: number;
}

// Ultra/Extreme counts are raised above the original spec table (800/12000/140/240/44/9 and
// 1800/45000/320/600/110/22): measured per-frame cost only grew ~1.5x per tier at those values.
export const PRESETS: Preset[] = [
  { id: "Low", buildings: 120, rain: 800, signs: 24, cars: 36, drones: 8, holos: 2, bloom: 0, shadowMap: 0, msaa: 0, reflections: 0 },
  { id: "Medium", buildings: 240, rain: 2500, signs: 48, cars: 80, drones: 16, holos: 4, bloom: 0.55, shadowMap: 1024, msaa: 0, reflections: 0 },
  { id: "High", buildings: 420, rain: 5000, signs: 80, cars: 150, drones: 28, holos: 6, bloom: 0.85, shadowMap: 2048, msaa: 4, reflections: 0 },
  { id: "Ultra", buildings: 1100, rain: 24000, signs: 200, cars: 400, drones: 70, holos: 14, bloom: 1.15, shadowMap: 2048, msaa: 4, reflections: 0.75 },
  { id: "Extreme", buildings: 2800, rain: 110000, signs: 560, cars: 1400, drones: 260, holos: 40, bloom: 1.45, shadowMap: 4096, msaa: 8, reflections: 1 },
];

export const DURATIONS = [30, 60, 90] as const;
export type Duration = (typeof DURATIONS)[number];
export const WARMUP_SECONDS = 3;

export function getPreset(id: string): Preset | undefined {
  return PRESETS.find((p) => p.id === id);
}

export function getResolution(id: string): Resolution | undefined {
  return RESOLUTIONS.find((r) => r.id === id);
}

/** Physical pixel size of the display, used for the "Native" option. */
export function nativeSize(screenW: number, screenH: number, dpr: number): { width: number; height: number } {
  return { width: Math.max(1, Math.round(screenW * dpr)), height: Math.max(1, Math.round(screenH * dpr)) };
}

/**
 * The resolution string recorded in the result. Upstream writes 1280x720 as 720p, 1920x1080 as 1080p, 2560x1440 as
 * 1440p and 3840x2160 as 4K, and any other size as WIDTHxHEIGHT, so a Native run that lands on one
 * of the standard sizes gets the standard name.
 */
export function resolutionLabel(id: ResolutionId, width: number, height: number): string {
  if (id !== "native") return id;
  const named = RESOLUTIONS.find((r) => r.id !== "native" && r.width === width && r.height === height);
  return named ? named.id : `${width}x${height}`;
}

/** Older saved results used "2160p"; upstream calls that size "4K". */
export function normalizeResolution(label: string): string {
  return label === "2160p" ? "4K" : label;
}
