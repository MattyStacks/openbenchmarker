// Pure scene layout: positions and sizes only, no GPU objects, so tests can check every solid
// and every moving thing against the camera path.
import * as THREE from "three";
import { stream } from "./rng";
import { CLEAR_MOVING, FLIGHT, HALF, JOURNEY_SECONDS, clearOfPath } from "./world";

/** An axis-aligned box. */
export interface Box {
  minX: number;
  minY: number;
  minZ: number;
  maxX: number;
  maxY: number;
  maxZ: number;
}

export const box = (minX: number, minY: number, minZ: number, maxX: number, maxY: number, maxZ: number): Box => ({ minX, minY, minZ, maxX, maxY, maxZ });
export const boxClear = (b: Box, r?: number) => clearOfPath(b.minX, b.minY, b.minZ, b.maxX, b.maxY, b.maxZ, r);

/** Uniform XZ grid of solid boxes, for "does this volume hit anything solid?" queries. */
export class SolidIndex {
  static readonly CELL = 48;
  readonly boxes: Box[] = [];
  private readonly cells = new Map<number, number[]>();
  private static key(cx: number, cz: number): number {
    return (cx + 4096) * 8192 + (cz + 4096);
  }
  add(b: Box): void {
    const id = this.boxes.push(b) - 1;
    const C = SolidIndex.CELL;
    for (let cx = Math.floor(b.minX / C); cx <= Math.floor(b.maxX / C); cx++)
      for (let cz = Math.floor(b.minZ / C); cz <= Math.floor(b.maxZ / C); cz++) {
        const k = SolidIndex.key(cx, cz);
        let c = this.cells.get(k);
        if (!c) this.cells.set(k, (c = []));
        c.push(id);
      }
  }
  /** True when the box, grown by `margin`, overlaps any solid. */
  hits(b: Box, margin = 0): boolean {
    const C = SolidIndex.CELL;
    const x0 = b.minX - margin, x1 = b.maxX + margin, y0 = b.minY - margin, y1 = b.maxY + margin, z0 = b.minZ - margin, z1 = b.maxZ + margin;
    for (let cx = Math.floor(x0 / C); cx <= Math.floor(x1 / C); cx++)
      for (let cz = Math.floor(z0 / C); cz <= Math.floor(z1 / C); cz++) {
        const cell = this.cells.get(SolidIndex.key(cx, cz));
        if (!cell) continue;
        for (const id of cell) {
          const s = this.boxes[id];
          if (s.minX < x1 && s.maxX > x0 && s.minY < y1 && s.maxY > y0 && s.minZ < z1 && s.maxZ > z0) return true;
        }
      }
    return false;
  }
}

/** A tower footprint (x, z centre; w, d size; h height). */
export interface BuildingSpot {
  x: number;
  z: number;
  w: number;
  d: number;
  h: number;
}

// ---------------------------------------------------------------------------------------------
// Drones
// ---------------------------------------------------------------------------------------------
/**
 * A horizontal orbit (a figure-eight when `eight`): centre, radius, altitude, bob amplitude,
 * angular speed (rad/s, signed) and phase. Position is a pure function of t, see orbitAt.
 */
export interface Orbit {
  cx: number;
  cz: number;
  y: number;
  r: number;
  bob: number;
  w: number;
  p: number;
  eight: boolean;
}

export function orbitAt(o: Orbit, t: number, out: THREE.Vector3): THREE.Vector3 {
  const a = o.p + o.w * t;
  return out.set(o.cx + Math.cos(a) * o.r, o.y + Math.sin(t * 1.3 + o.p) * o.bob, o.cz + (o.eight ? Math.sin(2 * a) * 0.5 : Math.sin(a)) * o.r);
}

/** The orbit's whole swept volume. */
export const orbitBox = (o: Orbit, pad = 0): Box =>
  box(o.cx - o.r - pad, o.y - o.bob - pad, o.cz - o.r - pad, o.cx + o.r + pad, o.y + o.bob + pad, o.cz + o.r + pad);

/**
 * Near drones: readable quadcopters, mostly placed beside the flight path (so they're seen up
 * close), the rest across the city. Every swept volume keeps CLEAR_MOVING from the camera path
 * and stays out of solids.
 */
export function layoutDrones(count: number, seed: number, solids: SolidIndex): Orbit[] {
  const rnd = stream(seed, 6);
  const out: Orbit[] = [];
  const p = new THREE.Vector3(), q = new THREE.Vector3();
  for (let attempt = 0; out.length < count && attempt < count * 60; attempt++) {
    let cx: number, cz: number, y: number;
    if (rnd() < 0.7) {
      const tp = rnd() * JOURNEY_SECONDS;
      FLIGHT.pointAt(tp, p);
      FLIGHT.pointAt(tp + 0.2, q);
      const hx = q.x - p.x, hz = q.z - p.z, hl = Math.hypot(hx, hz) || 1;
      const side = rnd() < 0.5 ? -1 : 1, off = 24 + rnd() * 70;
      cx = p.x + (-hz / hl) * side * off;
      cz = p.z + (hx / hl) * side * off;
      y = Math.max(14, p.y + (rnd() * 2 - 1) * 30);
    } else {
      cx = (rnd() * 2 - 1) * HALF * 0.9;
      cz = (rnd() * 2 - 1) * HALF * 0.9;
      y = 20 + rnd() * 160;
    }
    const r = 4 + rnd() * 14;
    const o: Orbit = { cx, cz, y, r, bob: 1 + rnd() * 2, w: ((6 + rnd() * 10) / r) * (rnd() < 0.5 ? 1 : -1), p: rnd() * Math.PI * 2, eight: rnd() < 0.35 };
    const b = orbitBox(o, 2.5);
    if (!boxClear(b, CLEAR_MOVING) || solids.hits(b, 1)) continue;
    out.push(o);
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Traffic: stacked two-way lanes along the streets
// ---------------------------------------------------------------------------------------------
/** Lane altitudes, in the order presets add them: street, 50, 25, 80, 120. */
export const LANE_LEVELS = [0.8, 50, 25, 80, 120] as const;
/** Cross-street (z-running) lanes sit this much higher so crossing traffic never collides. */
export const CROSS_LIFT = 3;
export const LANE_OFFSET = 3;

export interface Lane {
  /** 0: runs along x at z = c; 1: runs along z at x = c. */
  axis: 0 | 1;
  c: number;
  y: number;
  dir: 1 | -1;
  speed: number;
  level: number;
}

export interface Car {
  lane: number;
  /** Position along the lane at t = 0, in [-HALF, HALF). */
  phase: number;
  /** Level changers: the lane whose altitude it swings to, and the swing period (s). */
  lane2: number;
  period: number;
  tint: number;
  glow: number;
}

/** The volume a car can occupy on a lane (whole street length), from altitude y0 to y1. */
export function laneBox(l: Pick<Lane, "axis" | "c">, y0: number, y1: number): Box {
  return l.axis === 0 ? box(-HALF, y0 - 0.9, l.c - 1.4, HALF, y1 + 1.5, l.c + 1.4) : box(l.c - 1.4, y0 - 0.9, -HALF, l.c + 1.4, y1 + 1.5, HALF);
}

export function carPos(lane: Lane, phase: number, t: number): number {
  const span = HALF * 2;
  return ((((phase + HALF + lane.dir * lane.speed * t) % span) + span) % span) - HALF;
}

/** Altitude of a car at t (level changers swing smoothly between their two lanes). */
export function carY(car: Car, lanes: Lane[], t: number): number {
  const a = lanes[car.lane].y;
  if (car.lane2 < 0) return a;
  const b = lanes[car.lane2].y;
  const ph = (((t / car.period + car.phase / 997) % 1) + 1) % 1;
  const tri = ph < 0.5 ? ph * 2 : 2 - ph * 2;
  const s = Math.min(1, Math.max(0, (tri - 0.2) / 0.6));
  return a + (b - a) * s * s * (3 - 2 * s);
}

/**
 * Lanes on `levels` altitude levels over every street of the central city, each whole lane kept
 * CLEAR_MOVING from the camera path and out of every solid (a lane that would cross a sky bridge
 * or the flight is left empty). Cars spread over the lanes, favouring lanes the flight passes,
 * at least 9 units apart; a few swing between two levels where the whole column is clear.
 */
export function layoutTraffic(levels: number, cars: number, seed: number, solids: SolidIndex): { lanes: Lane[]; cars: Car[] } {
  const rnd = stream(seed, 40);
  const lanes: Lane[] = [];
  const blocks = Math.round(HALF / 64);
  for (let lv = 0; lv < Math.min(levels, LANE_LEVELS.length); lv++)
    for (const axis of [0, 1] as const)
      for (let k = -blocks + 1; k < blocks; k++)
        for (const dir of [1, -1] as const) {
          const c = k * 64 + (axis === 0 ? -dir : dir) * LANE_OFFSET;
          const y = LANE_LEVELS[lv] + (lv > 0 && axis === 1 ? CROSS_LIFT : 0);
          const b = laneBox({ axis, c }, y, y);
          if (!boxClear(b, CLEAR_MOVING) || solids.hits(b)) continue;
          lanes.push({ axis, c, y, dir, speed: lv === 0 ? 20 + rnd() * 10 : 42 + rnd() * 34, level: lv });
        }
  const weight = lanes.map((l) => {
    const b = laneBox(l, l.y, l.y);
    return FLIGHT.index.distToBox(b.minX, b.minY, b.minZ, b.maxX, b.maxY, b.maxZ, 120) < 120 ? 1 : 0.35;
  });
  const total = weight.reduce((a, b) => a + b, 0);
  const taken = lanes.map(() => [] as number[]);
  const out: Car[] = [];
  for (let tries = 0; out.length < cars && lanes.length && tries < cars * 30; tries++) {
    let r = rnd() * total, li = 0;
    while (li < lanes.length - 1 && (r -= weight[li]) > 0) li++;
    const phase = (rnd() * 2 - 1) * HALF;
    if (taken[li].some((p) => Math.abs(p - phase) < 9 || Math.abs(Math.abs(p - phase) - HALF * 2) < 9)) continue;
    taken[li].push(phase);
    const L = lanes[li];
    let lane2 = -1;
    if (L.level > 0 && rnd() < 0.07) {
      const j = lanes.findIndex((m) => m !== L && m.axis === L.axis && m.c === L.c && m.dir === L.dir && m.level > 0 && Math.abs(m.y - L.y) <= 32);
      if (j >= 0) {
        const b = laneBox(L, Math.min(L.y, lanes[j].y), Math.max(L.y, lanes[j].y));
        if (boxClear(b, CLEAR_MOVING) && !solids.hits(b)) lane2 = j;
      }
    }
    out.push({ lane: li, phase, lane2, period: 9 + rnd() * 8, tint: Math.floor(rnd() * 6), glow: Math.floor(rnd() * 4) });
  }
  return { lanes, cars: out };
}

/** Closest approach of the camera path to a horizontal circle (radius r, at altitude y ± bob). */
export function pathDistToRing(cx: number, cz: number, y: number, r: number, bob: number, cap: number): number {
  let best = cap;
  FLIGHT.index.someIn(cx - r - cap, y - bob - cap, cz - r - cap, cx + r + cap, y + bob + cap, cz + r + cap, (x, py, z) => {
    const radial = Math.abs(Math.hypot(x - cx, z - cz) - r);
    const dy = Math.max(0, Math.abs(py - y) - bob);
    best = Math.min(best, Math.hypot(radial, dy));
    return best < 1;
  });
  return best - 0.5;
}

/**
 * Far swarm: thousands of blinking specks circling across the whole sky. Circles only (cheap to
 * check), each keeping CLEAR_MOVING from the camera path.
 */
export function layoutSwarm(count: number, seed: number): Orbit[] {
  const rnd = stream(seed, 8);
  const out: Orbit[] = [];
  for (let attempt = 0; out.length < count && attempt < count * 20; attempt++) {
    const a = rnd() * Math.PI * 2, d = Math.pow(rnd(), 0.7) * HALF * 1.35;
    const cx = Math.cos(a) * d, cz = Math.sin(a) * d;
    const y = 45 + Math.pow(rnd(), 0.8) * 240;
    const r = 15 + rnd() * 135;
    const bob = rnd() * 4;
    if (pathDistToRing(cx, cz, y, r, bob, CLEAR_MOVING + 1) < CLEAR_MOVING) continue;
    out.push({ cx, cz, y, r, bob, w: ((10 + rnd() * 18) / r) * (rnd() < 0.5 ? 1 : -1), p: rnd() * Math.PI * 2, eight: false });
  }
  return out;
}
