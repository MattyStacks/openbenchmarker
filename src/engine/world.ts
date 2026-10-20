import { FlightPath, type FlightKey } from "./path";

/** City grid: street centre lines every BLOCK units, buildings inside blocks. */
export const BLOCK = 64;
export const STREET = 18;
/** Half-extent of the central city (11 blocks each side): traffic, drones, flight. */
export const HALF = 704;
/** Half-extent of the tower lot grid (16 blocks each side); outer lots only fill on high presets. */
export const CITY_HALF = 1024;

/** Nothing solid (towers, parts, bridges, signs) comes closer than this to the camera path. */
export const CLEAR_SOLID = 14;
/** Moving things (cars, drones) keep at least this far from the camera path. */
export const CLEAR_MOVING = 10;

/**
 * The v2 journey: one 96 s loop on the street grid (streets every 64 units), so no run (3 s
 * warm-up + up to 90 s) ever repeats a frame. Altitudes sit between the traffic levels
 * (street 0.8, 25/28, 50/53, 80/83, 120/123) where the camera cruises:
 *  1. cruise east at 100 over the z=-320 avenue toward the tall centre,
 *  2. bank right into the x=-64 canyon and dive to 13, just above the street traffic,
 *  3. skim the street under two stacked sky bridges (landmark at z=-96),
 *  4. weave left/right through the z=64, x=128, z=192 streets, under a second bridge,
 *  5. climb to 65 and fly between the 50 and 80 sky-lanes,
 *  6. climb to 165 heading north on x=448: skyline reveal of the megatowers on the left,
 *  7. sweep west at 135 along z=-448, then a U-turn back to the start.
 * `v` is relative speed: slower low down, faster up high.
 */
export const FLIGHT_KEYS: readonly FlightKey[] = [
  { p: [-540, 100, -320], v: 1.2 },
  { p: [-330, 100, -320], v: 1.25 },
  { p: [-160, 92, -320], v: 1.15 },
  { p: [-92, 74, -314], v: 1.05 },
  { p: [-66, 50, -262], v: 1.0 },
  { p: [-64, 22, -190], v: 0.9 },
  { p: [-64, 13, -120], v: 0.8 },
  { p: [-64, 13, -40], v: 0.8 },
  { p: [-62, 13, 30], v: 0.8 },
  { p: [-40, 14, 60], v: 0.8 },
  { p: [10, 14, 64], v: 0.82 },
  { p: [96, 15, 66], v: 0.85 },
  { p: [124, 15, 96], v: 0.85 },
  { p: [128, 16, 156], v: 0.85 },
  { p: [150, 18, 190], v: 0.9 },
  { p: [220, 32, 192], v: 0.95 },
  { p: [300, 62, 192], v: 1.0 },
  { p: [400, 65, 192], v: 1.0 },
  { p: [446, 85, 160], v: 1.05 },
  { p: [448, 125, 70], v: 1.1 },
  { p: [448, 160, -60], v: 1.2 },
  { p: [448, 165, -250], v: 1.25 },
  { p: [425, 155, -420], v: 1.3 },
  { p: [300, 140, -448], v: 1.4 },
  { p: [20, 135, -448], v: 1.45 },
  { p: [-300, 125, -448], v: 1.4 },
  { p: [-530, 112, -446], v: 1.25 },
  { p: [-576, 106, -400], v: 1.15 },
  { p: [-574, 102, -345], v: 1.15 },
];
export const JOURNEY_SECONDS = 96;

/**
 * Sky bridges the flight always passes under, each between two forced towers across a street:
 * `street` is the street line (axis 0: an x = street line, bridge spans x; axis 1: a z = street
 * line, bridge spans z), `at` the position along the street, `ys` the deck altitudes.
 */
export const LANDMARK_BRIDGES = [
  { axis: 0, street: -64, at: -96, ys: [30.6, 51] },
  { axis: 1, street: 64, at: 40, ys: [34] },
] as const;

export const FLIGHT = new FlightPath(FLIGHT_KEYS, JOURNEY_SECONDS);

/** Closest approach of the camera path to an axis-aligned box (conservative by 0.5 units). */
export function pathDistToBox(minX: number, minY: number, minZ: number, maxX: number, maxY: number, maxZ: number, cap = 200): number {
  return FLIGHT.index.distToBox(minX, minY, minZ, maxX, maxY, maxZ, cap) - 0.5;
}

/** True when the box keeps at least `r` from the camera path. */
export function clearOfPath(minX: number, minY: number, minZ: number, maxX: number, maxY: number, maxZ: number, r = CLEAR_SOLID): boolean {
  return pathDistToBox(minX, minY, minZ, maxX, maxY, maxZ, r + 1) >= r;
}
