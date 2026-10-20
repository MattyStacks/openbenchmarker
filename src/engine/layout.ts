// Pure scene layout: positions and sizes only, no GPU objects, so tests can check every solid
// against the camera path.
import { stream } from "./rng";
import { BLOCK, HALF, STREET, clearOfPath } from "./world";

/** An axis-aligned solid the camera must never touch. */
export interface Box {
  minX: number;
  minY: number;
  minZ: number;
  maxX: number;
  maxY: number;
  maxZ: number;
}

export interface BuildingSpot {
  x: number;
  z: number;
  w: number;
  d: number;
  h: number;
}

export const spotBox = (s: BuildingSpot): Box => ({ minX: s.x - s.w / 2, minY: 0, minZ: s.z - s.d / 2, maxX: s.x + s.w / 2, maxY: s.h, maxZ: s.z + s.d / 2 });

/** Seeded, path-respecting building layout. */
export function layoutBuildings(count: number, seed: number): BuildingSpot[] {
  const rnd = stream(seed, 1);
  const blocks = Math.round(HALF / BLOCK);
  const interior = (BLOCK - STREET) / 2;
  const out: BuildingSpot[] = [];
  for (let attempt = 0; out.length < count && attempt < count * 80; attempt++) {
    const bx = Math.floor(rnd() * blocks * 2) - blocks;
    const bz = Math.floor(rnd() * blocks * 2) - blocks;
    const w = 12 + rnd() * (interior * 2 - 14);
    const d = 12 + rnd() * (interior * 2 - 14);
    const x = (bx + 0.5) * BLOCK + (rnd() * 2 - 1) * (interior - w / 2);
    const z = (bz + 0.5) * BLOCK + (rnd() * 2 - 1) * (interior - d / 2);
    const centre = 1 - Math.min(1, Math.hypot(x, z) / (HALF * 1.1));
    const h = 24 + Math.pow(rnd(), 1.8) * (90 + 180 * centre);
    const s = { x, z, w, d, h };
    const b = spotBox(s);
    if (!clearOfPath(b.minX, b.minY, b.minZ, b.maxX, b.maxY, b.maxZ)) continue;
    out.push(s);
  }
  return out;
}
