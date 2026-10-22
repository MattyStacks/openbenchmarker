export type ResolutionId = "720p" | "1080p" | "1440p" | "4K";

export interface Resolution {
  id: ResolutionId;
  label: string;
  width: number;
  height: number;
}

/**
 * The only render sizes, named the way upstream records them. The id is also the resolution
 * string recorded in results; only these four can be submitted.
 */
export const RESOLUTIONS: Resolution[] = [
  { id: "720p", label: "720p (1280×720)", width: 1280, height: 720 },
  { id: "1080p", label: "1080p (1920×1080)", width: 1920, height: 1080 },
  { id: "1440p", label: "1440p (2560×1440)", width: 2560, height: 1440 },
  { id: "4K", label: "4K (3840×2160)", width: 3840, height: 2160 },
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
  /** Shadow map size; 0 disables shadows. Capped at the GPU's MAX_TEXTURE_SIZE (recorded as a fallback). */
  shadowMap: number;
  /** Composer render-target MSAA samples. */
  msaa: number;
  /** Reflector render scale; 0 disables planar reflections. */
  reflections: number;
  /** Far-field drone swarm: blinking specks across the sky (in addition to `drones`). */
  farDrones: number;
  /** Tower detail kit: 0 shells + shopfronts, 1 + ledges/roof clutter/AC/lanterns, 2 + pipes/ribs, 3 + balconies/scaffolding. */
  towerDetail: number;
  /** Traffic altitude levels in use: street, then sky-lanes at 50, 25, 80 and 120. */
  skyLanes: number;
  /** Far skyline rings out to the horizon (0-4). */
  skylineLayers: number;
  /** Low cloud layers lit from below (0-3). */
  cloudLayers: number;
  /** Rooftop searchlight beams; 3x as many light spills under the biggest signs. */
  lightShafts: number;
  /** Volumetric light scattering ray-march steps per pixel; 0 disables (needs bloom's composer). */
  volumetrics: number;
}

export const PRESETS: Preset[] = [
  { id: "Low", buildings: 260, rain: 3000, signs: 120, cars: 90, drones: 8, holos: 2, bloom: 0.4, shadowMap: 0, msaa: 0, reflections: 0, farDrones: 120, towerDetail: 0, skyLanes: 2, skylineLayers: 1, cloudLayers: 1, lightShafts: 2, volumetrics: 0 },
  { id: "Medium", buildings: 520, rain: 5000, signs: 260, cars: 200, drones: 16, holos: 4, bloom: 0.55, shadowMap: 1024, msaa: 8, reflections: 0, farDrones: 300, towerDetail: 1, skyLanes: 3, skylineLayers: 2, cloudLayers: 1, lightShafts: 4, volumetrics: 0 },
  { id: "High", buildings: 900, rain: 8000, signs: 500, cars: 400, drones: 28, holos: 6, bloom: 0.6, shadowMap: 2048, msaa: 8, reflections: 0, farDrones: 700, towerDetail: 2, skyLanes: 4, skylineLayers: 3, cloudLayers: 2, lightShafts: 8, volumetrics: 6 },
  { id: "Ultra", buildings: 1600, rain: 24000, signs: 1100, cars: 900, drones: 70, holos: 14, bloom: 0.7, shadowMap: 2048, msaa: 8, reflections: 1, farDrones: 2000, towerDetail: 3, skyLanes: 5, skylineLayers: 4, cloudLayers: 3, lightShafts: 14, volumetrics: 12 },
  { id: "Extreme", buildings: 2700, rain: 330000, signs: 2600, cars: 2200, drones: 260, holos: 40, bloom: 0.7, shadowMap: 8192, msaa: 8, reflections: 1, farDrones: 6000, towerDetail: 3, skyLanes: 5, skylineLayers: 4, cloudLayers: 3, lightShafts: 24, volumetrics: 24 },
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

/**
 * The standard resolution a result was rendered at: its recorded name must be one of the four
 * and its pixel size must match that name exactly. Older results from the removed "Native" option
 * qualify only if the display happened to be one of these sizes.
 */
export function standardResolution(label: string, width: number, height: number): Resolution | undefined {
  const r = getResolution(normalizeResolution(label));
  return r && r.width === width && r.height === height ? r : undefined;
}

/** Older saved results used "2160p"; upstream calls that size "4K". */
export function normalizeResolution(label: string): string {
  return label === "2160p" ? "4K" : label;
}

export type ScoreTestId = "entry" | "extreme";

export interface ScoreTest {
  id: ScoreTestId;
  name: string;
  preset: PresetId;
  resolution: ResolutionId;
  duration: Duration;
}

/**
 * Locked configurations that produce an official score, like 3DMark's fixed tests. One fixed
 * duration means every score covers the same stretch of the flight (scene time follows wall-clock).
 * Entry is the lightest setting; on fast GPUs it is often CPU-limited, which the diagnostics show.
 */
export const SCORE_TESTS: ScoreTest[] = [
  { id: "entry", name: "Score: Entry", preset: "Low", resolution: "720p", duration: 60 },
  { id: "extreme", name: "Score: Extreme", preset: "Extreme", resolution: "4K", duration: 60 },
];

export function getScoreTest(id: string | undefined): ScoreTest | undefined {
  return SCORE_TESTS.find((t) => t.id === id);
}

/** True when a run's settings are exactly the score test's locked configuration. */
export function matchesScoreTest(t: ScoreTest, preset: string, resolution: string, width: number, height: number, durationS: number): boolean {
  const res = getResolution(t.resolution)!;
  return preset === t.preset && resolution === t.resolution && width === res.width && height === res.height && durationS === t.duration;
}
