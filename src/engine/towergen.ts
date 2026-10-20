// Pure procedural city: lots, tower archetypes, detail kits, sky bridges. No GPU objects, so tests
// can check every part against the camera path. Everything is an axis-aligned box (cylinders by
// their bounding box), so clearance checks are exact.
import { mulberry32, stream } from "./rng";
import { BLOCK, CITY_HALF, CLEAR_SOLID, FLIGHT, HALF, STREET, pathDistToBox } from "./world";
import type { Box } from "./layout";

export const K = {
  /** Window-shaded box shell. */
  ShellBox: 0,
  /** Window-shaded 16-sided tower. */
  ShellRound: 1,
  /** Window-shaded octagonal tower. */
  ShellOct: 2,
  /** Dark metal box: ledges, AC units, ribs, frames, sheds, scaffolding. */
  DetBox: 3,
  /** Dark metal cylinder: pipes, tanks, masts, crowns. */
  DetCyl: 4,
  /** Spire cone. */
  DetCone: 5,
  /** Unlit emissive box: shopfronts, edge strips, bridge lights. */
  LightBar: 6,
} as const;
export type Kind = (typeof K)[keyof typeof K];

/** One instanced part: base centre (x, y, z), full size (sx, sy, sz). */
export interface Part {
  k: Kind;
  x: number;
  y: number;
  z: number;
  sx: number;
  sy: number;
  sz: number;
  /** DetBox/DetCyl/DetCone: tint (hex); LightBar: colour (hex). */
  c: number;
  /** LightBar intensity multiplier. */
  i?: number;
  /** Shells: window seed (0..1), palette (0..3), occupancy (0..1), style (0/1). */
  win?: [number, number, number, number];
}

export const partBox = (p: Part): Box => ({ minX: p.x - p.sx / 2, minY: p.y, minZ: p.z - p.sz / 2, maxX: p.x + p.sx / 2, maxY: p.y + p.sy, maxZ: p.z + p.sz / 2 });
const partClear = (p: Part) => {
  const b = partBox(p);
  return pathDistToBox(b.minX, b.minY, b.minZ, b.maxX, b.maxY, b.maxZ, CLEAR_SOLID + 1) >= CLEAR_SOLID;
};

/** A flat building face signs can attach to: centre (x, z) on the face, outward normal, extents. */
export interface Face {
  x: number;
  z: number;
  nx: number;
  nz: number;
  w: number;
  y0: number;
  y1: number;
  /** Tower height (for picking hero-sign faces). */
  top: number;
}

export interface Tower {
  x: number;
  z: number;
  w: number;
  d: number;
  /** Final height (after any truncation for the camera path). */
  h: number;
  /** Height of the base shell (sky bridges attach below this). */
  baseTop: number;
  arche: Arche;
}

export interface CityPlan {
  towers: Tower[];
  parts: Part[];
  faces: Face[];
  /** Rooftop beacons / antenna tips. */
  beacons: [number, number, number][];
  /** Street-level shop lanterns. */
  lanterns: [number, number, number, number][];
  bridges: number;
}

export type Arche = "slab" | "tiered" | "podium" | "round" | "mega";

const FLOOR = 3.4;
const snap = (h: number) => Math.max(FLOOR * 2, Math.round(h / FLOOR) * FLOOR);

const DARK = [0x1b1b28, 0x22222f, 0x191924, 0x262433, 0x1e1a26, 0x2a2630];
const SHOP = [0xffb347, 0xff7a3d, 0xffd9a0, 0xff3edb, 0x2ee9ff, 0x9b6bff, 0x4dffb4];
const EDGE = [0xff3edb, 0x2ee9ff, 0x9b6bff, 0xffb340];

interface Lot {
  x: number;
  z: number;
  w: number;
  d: number;
  h: number;
  seed: number;
  pal: number;
  arche: Arche;
  /** Sort key: distance to the flight path plus jitter (lower = built on lower presets). */
  pri: number;
}

/**
 * Split every block into lots, assign heights and archetypes, and order them so the lots that
 * matter most to the flight come first. Taking the first N lots gives each preset its towers.
 */
export function planLots(seed: number): Lot[] {
  const rnd = stream(seed, 20);
  const blocks = Math.round(CITY_HALF / BLOCK);
  const inner = BLOCK - STREET; // 46
  const lots: Lot[] = [];
  for (let bx = -blocks; bx < blocks; bx++)
    for (let bz = -blocks; bz < blocks; bz++) {
      const x0 = bx * BLOCK + STREET / 2, z0 = bz * BLOCK + STREET / 2;
      const r = rnd();
      const [nx, nz] = r < 0.22 ? [1, 1] : r < 0.42 ? [2, 1] : r < 0.6 ? [1, 2] : r < 0.9 ? [2, 2] : [3, 2];
      const cw = inner / nx, cd = inner / nz;
      for (let i = 0; i < nx; i++)
        for (let j = 0; j < nz; j++) {
          const inset = 1.5 + rnd() * 2.5;
          const w = cw - inset * 2, d = cd - inset * 2;
          const x = x0 + cw * (i + 0.5), z = z0 + cd * (j + 0.5);
          const centre = 1 - Math.min(1, Math.hypot(x, z) / (HALF * 1.05));
          const h = 22 + Math.pow(rnd(), 1.5) * (70 + 280 * centre * centre) + (rnd() < 0.04 ? 120 : 0);
          const big = Math.min(w, d);
          const a = rnd();
          const arche: Arche =
            h > 190 && big > 18 ? "mega" : big > 14 && a < 0.2 ? "round" : a < 0.45 ? "tiered" : a < 0.7 ? "podium" : "slab";
          const near = FLIGHT.index.distToBox(x - w / 2, 0, z - d / 2, x + w / 2, 400, z + d / 2, 600);
          lots.push({ x, z, w, d, h, seed: Math.floor(rnd() * 2 ** 31), pal: Math.floor(rnd() * 4), arche, pri: near + rnd() * 160 });
        }
    }
  lots.sort((a, b) => a.pri - b.pri);
  return lots;
}

interface Gen {
  parts: Part[];
  faces: Face[];
  beacons: [number, number, number][];
  lanterns: [number, number, number, number][];
  /** Shell parts in build order (bottom to top). */
  shells: Part[];
  top: number;
  baseTop: number;
}

/**
 * One tower on a lot, at most `hMax` tall, with detail level 0..3. Deterministic per lot seed:
 * calling again with a lower hMax regenerates the same tower, shorter.
 */
function genTower(L: Lot, w: number, d: number, hMax: number, detail: number): Gen {
  const rnd = mulberry32(L.seed);
  const g: Gen = { parts: [], faces: [], beacons: [], lanterns: [], shells: [], top: 0, baseTop: 0 };
  const H = Math.min(snap(L.h), Math.floor(hMax / FLOOR) * FLOOR);
  const occ = 0.22 + rnd() * 0.5;
  const style = rnd() < 0.5 ? 0 : 1;
  const wseed = rnd();
  const dark = () => DARK[Math.floor(rnd() * DARK.length)];
  const push = (p: Part) => (g.parts.push(p), p);

  const shell = (k: Kind, x: number, y: number, z: number, sx: number, sy: number, sz: number) => {
    const p = push({ k, x, y, z, sx, sy, sz, c: 0, win: [wseed, L.pal, occ, style] });
    g.shells.push(p);
    g.top = Math.max(g.top, y + sy);
    if (k === K.ShellBox)
      for (const [nx, nz] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const)
        g.faces.push({ x: x + (nx * sx) / 2, z: z + (nz * sz) / 2, nx, nz, w: nx ? sz : sx, y0: y, y1: y + sy, top: 0 });
    return p;
  };

  // Facade kit on one box shell: AC units, pipes, balconies, scaffolding.
  const facade = (s: Part) => {
    if (detail < 1) return;
    for (const [nx, nz] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const fw = nx ? s.sz : s.sx;
      const fx = s.x + (nx * s.sx) / 2, fz = s.z + (nz * s.sz) / 2;
      const along = (u: number) => [fx + (nz ? u : 0), fz + (nx ? u : 0)] as const;
      const out = (dist: number, u: number) => [along(u)[0] + nx * dist, along(u)[1] + nz * dist] as const;
      const nAc = Math.min(10, Math.floor(((fw * s.sy) / 700) * detail * (0.5 + rnd())));
      for (let i = 0; i < nAc; i++) {
        const u = (rnd() - 0.5) * (fw - 3);
        const y = s.y + 3 + Math.floor(rnd() * Math.max(1, (s.sy - 6) / FLOOR)) * FLOOR + 0.3;
        const [px, pz] = out(0.55, u);
        push({ k: K.DetBox, x: px, y, z: pz, sx: nx ? 1.1 : 1.7, sy: 1.1, sz: nx ? 1.7 : 1.1, c: 0x3a3a48 });
      }
      if (detail >= 2 && rnd() < 0.55) {
        const u = (rnd() - 0.5) * (fw - 2);
        const [px, pz] = out(0.45, u);
        const r = 0.28 + rnd() * 0.2;
        push({ k: K.DetCyl, x: px, y: s.y + 1, z: pz, sx: r * 2, sy: s.sy - 2, sz: r * 2, c: rnd() < 0.3 ? 0x4a3328 : 0x2a2a36 });
        if (rnd() < 0.5) {
          const [qx, qz] = out(0.45, u + (rnd() < 0.5 ? -1 : 1) * 0.9);
          push({ k: K.DetCyl, x: qx, y: s.y + 1, z: qz, sx: r * 1.4, sy: s.sy - 2, sz: r * 1.4, c: 0x2a2a36 });
        }
      }
      if (detail >= 3 && s.sy > 20 && rnd() < 0.35) {
        const bw = fw * (0.3 + rnd() * 0.4), u = (rnd() - 0.5) * (fw - bw);
        for (let y = s.y + 7 + FLOOR * Math.floor(rnd() * 3); y < s.y + s.sy - 4; y += FLOOR * (3 + Math.floor(rnd() * 3))) {
          const [px, pz] = out(0.7, u);
          push({ k: K.DetBox, x: px, y, z: pz, sx: nx ? 1.4 : bw, sy: 0.35, sz: nx ? bw : 1.4, c: dark() });
        }
      }
      if (detail >= 3 && s.sy > 24 && rnd() < 0.12) {
        const sw = Math.min(fw - 2, 8 + rnd() * 10), u = (rnd() - 0.5) * (fw - sw), sh = Math.min(s.sy - 4, 12 + rnd() * 20);
        const y0 = s.y + 2;
        for (let k = 0; k <= Math.round(sw / 3); k++) {
          const [px, pz] = out(1.4, u - sw / 2 + k * (sw / Math.round(sw / 3)));
          push({ k: K.DetBox, x: px, y: y0, z: pz, sx: 0.18, sy: sh, sz: 0.18, c: 0x3c3a44 });
        }
        for (let y = y0 + FLOOR; y < y0 + sh; y += FLOOR) {
          const [px, pz] = out(1.4, u);
          push({ k: K.DetBox, x: px, y, z: pz, sx: nx ? 0.16 : sw, sy: 0.16, sz: nx ? sw : 0.16, c: 0x3c3a44 });
        }
      }
    }
  };

  // Street level: lit shopfronts, awnings and lanterns on every side of the base.
  const shopfronts = (s: Part) => {
    for (const [nx, nz] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const fw = nx ? s.sz : s.sx;
      const sw = fw * (0.55 + rnd() * 0.35);
      const u = (rnd() - 0.5) * (fw - sw);
      const fx = s.x + (nx * s.sx) / 2 + (nz ? u : 0), fz = s.z + (nz * s.sz) / 2 + (nx ? u : 0);
      const col = SHOP[Math.floor(rnd() * SHOP.length)];
      const glass = rnd() < 0.75 ? 0xff9a48 : SHOP[Math.floor(rnd() * SHOP.length)];
      push({ k: K.LightBar, x: fx + nx * 0.06, y: 0.4, z: fz + nz * 0.06, sx: nx ? 0.12 : sw, sy: 2.6, sz: nx ? sw : 0.12, c: glass, i: 0.35 + rnd() * 0.45 });
      push({ k: K.LightBar, x: fx + nx * 0.2, y: 3.3, z: fz + nz * 0.2, sx: nx ? 0.25 : sw, sy: 0.3, sz: nx ? sw : 0.25, c: col, i: 2.2 });
      if (detail >= 1) {
        push({ k: K.DetBox, x: fx + nx * 0.9, y: 3.7, z: fz + nz * 0.9, sx: nx ? 1.8 : sw, sy: 0.22, sz: nx ? sw : 1.8, c: dark() });
        const n = Math.max(2, Math.round(sw / 3));
        for (let i = 0; i < n; i++) {
          const v = -sw / 2 + (i + 0.5) * (sw / n);
          g.lanterns.push([fx + nx * 1.6 + (nz ? v : 0), 3.1, fz + nz * 1.6 + (nx ? v : 0), rnd() < 0.7 ? 0 : 1]);
        }
      }
    }
  };

  // Rooftop clutter: tanks, AC boxes, sheds, antenna masts with spires and beacons, roof frames.
  const roof = (x: number, y: number, z: number, w: number, d: number) => {
    const at = (m: number) => [x + (rnd() - 0.5) * Math.max(0, w - m), z + (rnd() - 0.5) * Math.max(0, d - m)] as const;
    if (detail >= 1) {
      const r = Math.min(2.4, Math.min(w, d) * 0.15 + rnd());
      const [tx, tz] = at(r * 2 + 1);
      push({ k: K.DetCyl, x: tx, y, z: tz, sx: r * 2, sy: 3 + rnd() * 2.5, sz: r * 2, c: rnd() < 0.5 ? 0x3b2f2a : 0x2c2c38 });
    }
    const boxes = detail === 0 ? 1 : detail + 1 + Math.floor(rnd() * (detail + 1));
    for (let i = 0; i < boxes; i++) {
      const bw = 1.5 + rnd() * Math.min(6, w * 0.3), bd = 1.5 + rnd() * Math.min(6, d * 0.3);
      const [bx, bz] = at(Math.max(bw, bd) + 1);
      push({ k: K.DetBox, x: bx, y, z: bz, sx: bw, sy: 1.2 + rnd() * 2.5, sz: bd, c: dark() });
    }
    if (detail >= 1) push({ k: K.DetBox, x, y, z, sx: w + 0.6, sy: 0.9, sz: d + 0.6, c: dark() }); // parapet
    if (y > 70 && rnd() < 0.75) {
      const masts = detail >= 3 ? 2 : 1;
      for (let i = 0; i < masts; i++) {
        const [mx, mz] = at(2);
        const mh = 8 + rnd() * (y > 160 ? 34 : 18);
        push({ k: K.DetCyl, x: mx, y, z: mz, sx: 0.5, sy: mh, sz: 0.5, c: 0x30303c });
        if (detail >= 1) push({ k: K.DetCone, x: mx, y: y + mh, z: mz, sx: 0.9, sy: 3 + rnd() * 3, sz: 0.9, c: 0x30303c });
        g.beacons.push([mx, y + mh + (detail >= 1 ? 1 : 0.4), mz]);
      }
    }
  };

  const ledge = (x: number, y: number, z: number, w: number, d: number) => {
    if (detail < 1) return;
    push({ k: K.DetBox, x, y, z, sx: w + 1.4, sy: 0.7, sz: d + 1.4, c: dark() });
    if (rnd() < 0.35) push({ k: K.LightBar, x, y: y + 0.7, z, sx: w + 1.5, sy: 0.18, sz: d + 1.5, c: EDGE[Math.floor(rnd() * EDGE.length)], i: 1.8 });
  };

  const { x, z } = L;
  switch (L.arche) {
    case "slab": {
      const s = shell(K.ShellBox, x, 0, z, w, H, d);
      shopfronts(s);
      facade(s);
      if (detail >= 2) {
        const wide = w >= d;
        const span = wide ? w : d;
        const n = Math.floor(span / 5);
        for (let i = 1; i < n; i++) {
          const u = -span / 2 + (i * span) / n;
          for (const sgn of [-1, 1]) {
            const fx = wide ? x + u : x + sgn * (w / 2 + 0.4), fz = wide ? z + sgn * (d / 2 + 0.4) : z + u;
            push({ k: K.DetBox, x: fx, y: 4, z: fz, sx: wide ? 0.45 : 0.8, sy: H - 5, sz: wide ? 0.8 : 0.45, c: dark() });
          }
        }
      }
      roof(x, H, z, w, d);
      g.baseTop = H;
      break;
    }
    case "tiered":
    case "mega": {
      const tiers = L.arche === "mega" ? 3 + Math.floor(rnd() * 3) : 2 + Math.floor(rnd() * 3);
      let cw = w, cd = d, y = 0;
      for (let i = 0; i < tiers && H - y >= FLOOR * 3; i++) {
        const last = i === tiers - 1;
        const th = last ? H - y : snap((H - y) * (0.3 + rnd() * 0.25));
        const s = shell(K.ShellBox, x, y, z, cw, th, cd);
        if (i === 0) {
          shopfronts(s);
          g.baseTop = th;
        }
        facade(s);
        y += th;
        if (!last) {
          ledge(x, y, z, cw, cd);
          const k = 0.68 + rnd() * 0.18;
          cw = Math.max(8, cw * k);
          cd = Math.max(8, cd * k);
        }
      }
      if (L.arche === "mega" && detail >= 2) {
        const sx = rnd() < 0.5 ? 1 : -1, sz = rnd() < 0.5 ? 1 : -1;
        for (let i = 0; i < 3; i++)
          push({ k: K.DetCyl, x: x + sx * (w / 2 + 0.6), y: 1, z: z + sz * (d / 2 - 1.5 - i * 1.1), sx: 0.8, sy: g.baseTop - 2, sz: 0.8, c: i === 1 ? 0x463026 : 0x2a2a36 });
      }
      roof(x, y, z, cw, cd);
      break;
    }
    case "podium": {
      const ph = snap(6 + rnd() * 10);
      const p = shell(K.ShellBox, x, 0, z, w, Math.min(ph, H), d);
      shopfronts(p);
      g.baseTop = p.sy;
      if (H - ph >= FLOOR * 4) {
        ledge(x, ph, z, w, d);
        const tw = w * (0.55 + rnd() * 0.25), td = d * (0.55 + rnd() * 0.25);
        const ox = (rnd() - 0.5) * (w - tw), oz = (rnd() - 0.5) * (d - td);
        const t = shell(K.ShellBox, x + ox, ph, z + oz, tw, H - ph, td);
        facade(t);
        roof(x + ox, H, z + oz, tw, td);
      } else roof(x, p.sy, z, w, d);
      break;
    }
    case "round": {
      const ph = snap(5 + rnd() * 8);
      const p = shell(K.ShellBox, x, 0, z, w, Math.min(ph, H), d);
      shopfronts(p);
      g.baseTop = p.sy;
      if (H - ph >= FLOOR * 4) {
        ledge(x, ph, z, w, d);
        const dia = Math.min(w, d) * (0.62 + rnd() * 0.25);
        const k = rnd() < 0.5 ? K.ShellRound : K.ShellOct;
        shell(k, x, ph, z, dia, H - ph, dia);
        if (detail >= 1) push({ k: K.DetCyl, x, y: H - 3, z, sx: dia + 1.2, sy: 1.6, sz: dia + 1.2, c: dark() });
        if (detail >= 2) push({ k: K.LightBar, x, y: H - 1.2, z, sx: dia * 0.72, sy: 0.25, sz: dia * 0.72, c: EDGE[Math.floor(rnd() * EDGE.length)], i: 2 });
        roof(x, H, z, dia * 0.7, dia * 0.7);
      } else roof(x, p.sy, z, w, d);
      break;
    }
  }
  for (const f of g.faces) f.top = g.top;
  return g;
}

/**
 * Build `count` towers (the highest-priority lots) plus sky bridges, keeping every part at least
 * CLEAR_SOLID from the camera path: a failing upper tier truncates the tower, a failing base
 * shrinks the footprint (or the lot is left as a plaza), and failing details are dropped.
 */
export function planCity(count: number, detail: number, seed: number): CityPlan {
  const plan: CityPlan = { towers: [], parts: [], faces: [], beacons: [], lanterns: [], bridges: 0 };
  const lots = planLots(seed);
  for (const L of lots) {
    if (plan.towers.length >= count) break;
    let g: Gen | null = null;
    for (const shrink of [1, 0.78, 0.6]) {
      const w = L.w * shrink, d = L.d * shrink;
      let hMax = Infinity;
      for (let tries = 0; tries < 8; tries++) {
        const cand = genTower(L, w, d, hMax, detail);
        const bad = cand.shells.find((s) => !partClear(s));
        if (!bad) {
          g = cand;
          break;
        }
        if (bad === cand.shells[0]) break; // the base itself is in the way: shrink
        hMax = bad.y - 0.01; // cut the tower below the offending shell
      }
      if (g) break;
    }
    if (!g || g.top < FLOOR * 3) continue;
    const kept = g.parts.filter((p) => p.win || partClear(p));
    plan.parts.push(...kept);
    plan.faces.push(...g.faces);
    for (const b of g.beacons) if (pathDistToBox(b[0] - 1, b[1] - 1, b[2] - 1, b[0] + 1, b[1] + 1, b[2] + 1, CLEAR_SOLID + 1) >= CLEAR_SOLID) plan.beacons.push(b);
    for (const l of g.lanterns) if (pathDistToBox(l[0] - 0.5, l[1] - 0.6, l[2] - 0.5, l[0] + 0.5, l[1] + 0.6, l[2] + 0.5, CLEAR_SOLID + 1) >= CLEAR_SOLID) plan.lanterns.push(l);
    const base = g.shells[0];
    plan.towers.push({ x: base.x, z: base.z, w: base.sx, d: base.sz, h: g.top, baseTop: g.baseTop, arche: L.arche });
  }
  addBridges(plan, detail, seed);
  return plan;
}

/** Enclosed sky bridges across the street between tall neighbours whose bases face each other. */
function addBridges(plan: CityPlan, detail: number, seed: number): void {
  const rnd = stream(seed, 21);
  const tall = plan.towers.filter((t) => t.baseTop > 70 && t.arche !== "round");
  const max = Math.max(1, Math.floor(plan.towers.length / 25));
  for (const a of tall) {
    if (plan.bridges >= max) break;
    for (const b of tall) {
      if (plan.bridges >= max) break;
      // a's +x face to b's -x face across one street, or a's +z face to b's -z face.
      for (const axis of [0, 1] as const) {
        const aEdge = axis === 0 ? a.x + a.w / 2 : a.z + a.d / 2;
        const bEdge = axis === 0 ? b.x - b.w / 2 : b.z - b.d / 2;
        const gap = bEdge - aEdge;
        if (gap < STREET - 1 || gap > STREET + 12) continue;
        const lo = Math.max(axis === 0 ? a.z - a.d / 2 : a.x - a.w / 2, axis === 0 ? b.z - b.d / 2 : b.x - b.w / 2);
        const hi = Math.min(axis === 0 ? a.z + a.d / 2 : a.x + a.w / 2, axis === 0 ? b.z + b.d / 2 : b.x + b.w / 2);
        if (hi - lo < 10 || rnd() > 0.5) continue;
        const top = Math.min(a.baseTop, b.baseTop) - 8;
        const y = snap(30 + rnd() * Math.max(0, top - 40));
        const across = (lo + hi) / 2, mid = aEdge + gap / 2, bw = 6 + rnd() * 3;
        const deck: Part = axis === 0
          ? { k: K.ShellBox, x: mid, y, z: across, sx: gap + 0.4, sy: FLOOR * 1.4, sz: bw, c: 0, win: [rnd(), 1, 0.85, 1] }
          : { k: K.ShellBox, x: across, y, z: mid, sx: bw, sy: FLOOR * 1.4, sz: gap + 0.4, c: 0, win: [rnd(), 1, 0.85, 1] };
        const strip: Part = { ...deck, k: K.LightBar, y: y - 0.25, sy: 0.25, sx: axis === 0 ? deck.sx : 0.6, sz: axis === 0 ? 0.6 : deck.sz, c: 0x2ee9ff, i: 2.4, win: undefined };
        if (!partClear(deck) || !partClear(strip)) continue;
        plan.parts.push(deck, strip);
        if (detail >= 2) {
          const beam: Part = { ...deck, k: K.DetBox, y: y - 1.1, sy: 0.8, sx: axis === 0 ? deck.sx : bw + 0.8, sz: axis === 0 ? bw + 0.8 : deck.sz, c: 0x24232e, win: undefined };
          if (partClear(beam)) plan.parts.push(beam);
        }
        plan.bridges++;
        break;
      }
    }
  }
}
