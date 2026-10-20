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

/** v1 loop, kept while the engine is rebuilt; replaced by the v2 journey in the camera stage. */
export const FLIGHT_KEYS: readonly FlightKey[] = [
  { p: [-330, 42, -320] },
  { p: [-90, 30, -370] },
  { p: [170, 56, -330] },
  { p: [372, 44, -150] },
  { p: [350, 34, 110] },
  { p: [250, 62, 318] },
  { p: [10, 38, 380] },
  { p: [-250, 28, 316] },
  { p: [-392, 52, 70] },
  { p: [-370, 40, -170] },
];
export const JOURNEY_SECONDS = 64;

export const FLIGHT = new FlightPath(FLIGHT_KEYS, JOURNEY_SECONDS);

/** Closest approach of the camera path to an axis-aligned box (conservative by 0.5 units). */
export function pathDistToBox(minX: number, minY: number, minZ: number, maxX: number, maxY: number, maxZ: number, cap = 200): number {
  return FLIGHT.index.distToBox(minX, minY, minZ, maxX, maxY, maxZ, cap) - 0.5;
}

/** True when the box keeps at least `r` from the camera path. */
export function clearOfPath(minX: number, minY: number, minZ: number, maxX: number, maxY: number, maxZ: number, r = CLEAR_SOLID): boolean {
  return pathDistToBox(minX, minY, minZ, maxX, maxY, maxZ, r + 1) >= r;
}
