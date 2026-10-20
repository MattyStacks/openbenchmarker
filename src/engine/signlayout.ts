// Pure sign placement on tower faces, plus lantern strings across streets. Atlas cells are only
// referenced by kind and index here; the atlas itself is drawn in signatlas.ts.
import { stream } from "./rng";
import type { Box } from "./layout";
import type { Face, Tower } from "./towergen";
import { CLEAR_SOLID, FLIGHT, STREET, clearOfPath } from "./world";

/** Atlas cells: horizontal 4:1, vertical 1:4, billboard 2:1. */
export const CELLS = { h: 32, v: 16, b: 8 } as const;
export type CellKind = keyof typeof CELLS;

export interface Sign {
  /** Centre of the quad. */
  x: number;
  y: number;
  z: number;
  /** Quad normal (horizontal). */
  nx: number;
  nz: number;
  w: number;
  h: number;
  kind: CellKind;
  cell: number;
  colA: number;
  colB: number;
  /** Flicker seed (0..1) and mode (0 steady, 1 broken tube, 2 slow blink). */
  fx: [number, number];
  blade: boolean;
}

export const SIGN_COLORS = [0xff3edb, 0x2ee9ff, 0x9b6bff, 0xffb340, 0x4dffb4, 0xff4060, 0xcfe8ff, 0xff3edb, 0x2ee9ff];

/** World-space bounding box of a sign (with a little thickness). */
export function signBox(s: Sign): Box {
  const ex = Math.abs(s.nz) * s.w * 0.5 + Math.abs(s.nx) * 0.15;
  const ez = Math.abs(s.nx) * s.w * 0.5 + Math.abs(s.nz) * 0.15;
  return { minX: s.x - ex, minY: s.y - s.h / 2, minZ: s.z - ez, maxX: s.x + ex, maxY: s.y + s.h / 2, maxZ: s.z + ez };
}

interface Slot {
  u0: number;
  u1: number;
  y0: number;
  y1: number;
}

/**
 * Place `count` signs on tower faces, favouring faces near and facing the flight path: hero
 * billboards on the tallest towers, horizontal and vertical panels, blade signs sticking out from
 * corners, and stacked columns of mixed signs. Every sign keeps CLEAR_SOLID from the camera path
 * and never overlaps another sign on the same face.
 */
export function layoutSigns(faces: Face[], count: number, seed: number): Sign[] {
  const rnd = stream(seed, 30);
  const out: Sign[] = [];
  if (!faces.length || count <= 0) return out;
  const used = faces.map(() => [] as Slot[]);
  const near = { x: 0, y: 0, z: 0 };
  const weight = faces.map((f) => {
    const mid = (f.y0 + f.y1) / 2;
    const p = FLIGHT.index.nearest(f.x, mid, f.z, 160, near);
    const facing = p ? (p.x - f.x) * f.nx + (p.z - f.z) * f.nz > 0 : false;
    const d = p ? Math.hypot(p.x - f.x, p.y - mid, p.z - f.z) : 999;
    const prox = d < 60 ? 1 : d < 110 ? 0.45 : d < 160 ? 0.15 : 0.05;
    return prox * (facing ? 1 : 0.2) * Math.min(1, (f.y1 - f.y0) / 12) * Math.min(1, f.w / 8);
  });
  const cum: number[] = [];
  let total = 0;
  for (const w of weight) cum.push((total += w));
  const pickFace = () => {
    const r = rnd() * total;
    let lo = 0, hi = cum.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (cum[mid] < r) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  };
  const color = () => SIGN_COLORS[Math.floor(rnd() * SIGN_COLORS.length)];
  const fx = (): [number, number] => {
    const r = rnd();
    return [rnd(), r < 0.86 ? 0 : r < 0.93 ? 1 : 2];
  };

  /** Try to place one sign on face fi at along-face offset u (centre) and vertical centre y. */
  const place = (fi: number, kind: CellKind, w: number, h: number, u: number, y: number, blade: boolean, colA: number, colB: number): boolean => {
    const f = faces[fi];
    const tx = -f.nz, tz = f.nx; // face tangent
    const half = blade ? 0.7 : w / 2;
    const slot = { u0: u - half - 0.4, u1: u + half + 0.4, y0: y - h / 2 - 0.4, y1: y + h / 2 + 0.4 };
    if (slot.u0 < -f.w / 2 || slot.u1 > f.w / 2 || slot.y0 < Math.max(f.y0, 4.2) || slot.y1 > f.y1) return false;
    if (used[fi].some((s) => s.u0 < slot.u1 && s.u1 > slot.u0 && s.y0 < slot.y1 && s.y1 > slot.y0)) return false;
    const s: Sign = blade
      ? { x: f.x + tx * u + f.nx * (0.4 + w / 2), y, z: f.z + tz * u + f.nz * (0.4 + w / 2), nx: tx, nz: tz, w, h, kind, cell: 0, colA, colB, fx: fx(), blade }
      : { x: f.x + tx * u + f.nx * 0.22, y, z: f.z + tz * u + f.nz * 0.22, nx: f.nx, nz: f.nz, w, h, kind, cell: 0, colA, colB, fx: fx(), blade };
    const b = signBox(s);
    if (!clearOfPath(b.minX, b.minY, b.minZ, b.maxX, b.maxY, b.maxZ, CLEAR_SOLID)) return false;
    s.cell = Math.floor(rnd() * CELLS[kind]);
    used[fi].push(slot);
    out.push(s);
    return true;
  };

  // Hero billboards near the tops of the tallest towers.
  const heroes = faces
    .map((f, fi) => ({ f, fi }))
    .filter(({ f, fi }) => f.top > 130 && f.y1 >= f.top - 1 && f.w >= 14 && weight[fi] > 0.1)
    .sort((a, b) => b.f.top - a.f.top);
  const heroCount = Math.max(2, Math.round(count * 0.04));
  for (const { f, fi } of heroes) {
    if (out.length >= heroCount) break;
    const w = Math.min(f.w * 0.88, 16 + rnd() * 22), h = w / 2;
    place(fi, "b", w, h, 0, f.y1 - h / 2 - 2.5, false, color(), color());
  }

  for (let tries = 0; out.length < count && tries < count * 25; tries++) {
    const fi = pickFace();
    const f = faces[fi];
    const r = rnd();
    const colA = color(), colB = rnd() < 0.5 ? colA : color();
    const yIn = (h: number) => Math.max(f.y0, 4.6) + h / 2 + rnd() * Math.max(0, f.y1 - Math.max(f.y0, 4.6) - h - 1);
    if (r < 0.32) {
      const w = Math.min(f.w * 0.9, 7 + rnd() * 16), h = w / 4;
      place(fi, "h", w, h, (rnd() - 0.5) * (f.w - w), yIn(h), false, colA, colB);
    } else if (r < 0.5) {
      const h = Math.min(f.y1 - f.y0 - 3, 10 + rnd() * 22), w = h / 4;
      if (h > 4) place(fi, "v", w, h, (rnd() - 0.5) * (f.w - w), yIn(h), false, colA, colB);
    } else if (r < 0.72) {
      // Blades stay narrow (<= 4.5 out from the wall) so they never reach the traffic lanes.
      const h = Math.min(f.y1 - f.y0 - 3, 8 + rnd() * 10), w = h / 4;
      const u = (rnd() < 0.5 ? -1 : 1) * (f.w / 2 - 1.2 - rnd() * 2);
      if (h > 4) place(fi, "v", w, h, u, yIn(h), true, colA, colB);
    } else if (r < 0.86) {
      // A stacked column: 3-6 mixed signs, one above the other.
      const n = 3 + Math.floor(rnd() * 4), blade = rnd() < 0.5;
      const u = blade ? (rnd() < 0.5 ? -1 : 1) * (f.w / 2 - 1.2) : (rnd() - 0.5) * (f.w - 7);
      let y = Math.max(f.y0, 4.6) + rnd() * Math.max(0, (f.y1 - f.y0) * 0.4);
      for (let k = 0; k < n && out.length < count; k++) {
        const vert = rnd() < 0.5;
        const h = vert ? 6 + rnd() * 10 : 1.8 + rnd() * 1.6, w = vert ? h / 4 : h * 4;
        if (blade && !vert) continue;
        if (!place(fi, vert ? "v" : "h", w, h, u, y + h / 2, blade, color(), color())) break;
        y += h + 0.9;
      }
    } else {
      const w = Math.min(f.w * 0.9, 10 + rnd() * 14), h = w / 2;
      place(fi, "b", w, h, (rnd() - 0.5) * (f.w - w), yIn(h), false, colA, colB);
    }
  }
  return out;
}

/** A string of lanterns across a street: catenary between two facing towers. */
export interface LanternString {
  pts: [number, number, number][];
  color: 0 | 1;
}

/** Lantern strings low over the streets between facing towers, clear of the camera path. */
export function layoutLanternStrings(towers: Tower[], count: number, seed: number): LanternString[] {
  const rnd = stream(seed, 31);
  const out: LanternString[] = [];
  for (let k = 0; k < towers.length * 3 && out.length < count; k++) {
    const a = towers[Math.floor(rnd() * towers.length)];
    const axis = rnd() < 0.5 ? 0 : 1;
    // Find the tower across the street on that axis with overlapping extent.
    const aEdge = axis === 0 ? a.x + a.w / 2 : a.z + a.d / 2;
    const b = towers.find((t) => {
      const bEdge = axis === 0 ? t.x - t.w / 2 : t.z - t.d / 2;
      const gap = bEdge - aEdge;
      if (gap < STREET - 2 || gap > STREET + 14) return false;
      return axis === 0 ? Math.abs(t.z - a.z) < Math.min(a.d, t.d) / 2 : Math.abs(t.x - a.x) < Math.min(a.w, t.w) / 2;
    });
    if (!b) continue;
    const bEdge = axis === 0 ? b.x - b.w / 2 : b.z - b.d / 2;
    const across = axis === 0 ? (a.z + b.z) / 2 + (rnd() - 0.5) * 4 : (a.x + b.x) / 2 + (rnd() - 0.5) * 4;
    const y = 6 + rnd() * 6, sag = 1 + rnd() * 1.6, n = 7 + Math.floor(rnd() * 8);
    const pts: [number, number, number][] = [];
    for (let i = 0; i < n; i++) {
      const s = (i + 0.5) / n;
      const along = aEdge + (bEdge - aEdge) * s;
      const yy = y - sag * 4 * s * (1 - s);
      pts.push(axis === 0 ? [along, yy, across] : [across, yy, along]);
    }
    const xs = pts.map((p) => p[0]), zs = pts.map((p) => p[2]);
    if (!clearOfPath(Math.min(...xs) - 0.5, y - sag - 0.6, Math.min(...zs) - 0.5, Math.max(...xs) + 0.5, y + 0.6, Math.max(...zs) + 0.5, CLEAR_SOLID)) continue;
    out.push({ pts, color: rnd() < 0.65 ? 0 : 1 });
  }
  return out;
}
