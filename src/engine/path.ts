import * as THREE from "three";

/**
 * The camera's flight: a closed 3D Catmull-Rom loop with a speed profile, sampled densely so the
 * camera pose is a pure function of scene time t (no frame-rate dependence). It also provides the
 * clearance index the layout uses so nothing solid comes near the camera.
 */
export interface FlightKey {
  /** Control point x, y, z (world units; y is altitude). */
  p: readonly [number, number, number];
  /** Relative speed around this point (1 = average). */
  v?: number;
}

const DENSE = 16000;

export class FlightPath {
  readonly duration: number;
  readonly length: number;
  /** Dense loop samples x,y,z, DENSE + 1 of them (the last equals the first). */
  readonly pts: Float64Array;
  /** Scene time at each dense sample; time[DENSE] = duration. */
  private readonly time: Float64Array;
  readonly index: PathIndex;

  constructor(keys: readonly FlightKey[], duration: number) {
    this.duration = duration;
    const curve = new THREE.CatmullRomCurve3(
      keys.map((k) => new THREE.Vector3(k.p[0], k.p[1], k.p[2])),
      true,
      "centripetal",
    );
    const n = keys.length;
    const pts = new Float64Array((DENSE + 1) * 3);
    const v = new THREE.Vector3();
    for (let i = 0; i <= DENSE; i++) {
      curve.getPoint((i % DENSE) / DENSE, v);
      pts[i * 3] = v.x;
      pts[i * 3 + 1] = v.y;
      pts[i * 3 + 2] = v.z;
    }
    // Speed multiplier: cosine blend of the key speeds over the curve parameter.
    const speedAt = (u: number) => {
      const f = u * n;
      const i = Math.floor(f) % n;
      const a = keys[i].v ?? 1, b = keys[(i + 1) % n].v ?? 1;
      const s = (1 - Math.cos((f - Math.floor(f)) * Math.PI)) / 2;
      return a + (b - a) * s;
    };
    const time = new Float64Array(DENSE + 1);
    let len = 0, raw = 0;
    for (let i = 1; i <= DENSE; i++) {
      const ds = Math.hypot(pts[i * 3] - pts[i * 3 - 3], pts[i * 3 + 1] - pts[i * 3 - 2], pts[i * 3 + 2] - pts[i * 3 - 1]);
      len += ds;
      raw += ds / speedAt((i - 0.5) / DENSE);
      time[i] = raw;
    }
    for (let i = 0; i <= DENSE; i++) time[i] *= duration / raw;
    this.pts = pts;
    this.time = time;
    this.length = len;
    this.index = new PathIndex(pts, DENSE);
  }

  /** Position on the loop at scene time t (seconds; the loop repeats after `duration`). */
  pointAt(t: number, out: THREE.Vector3): THREE.Vector3 {
    const T = this.duration;
    const tt = ((t % T) + T) % T;
    const time = this.time;
    let lo = 0, hi = DENSE;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (time[mid] <= tt) lo = mid;
      else hi = mid;
    }
    const f = (tt - time[lo]) / Math.max(1e-9, time[hi] - time[lo]);
    const p = this.pts;
    return out.set(
      p[lo * 3] + (p[hi * 3] - p[lo * 3]) * f,
      p[lo * 3 + 1] + (p[hi * 3 + 1] - p[lo * 3 + 1]) * f,
      p[lo * 3 + 2] + (p[hi * 3 + 2] - p[lo * 3 + 2]) * f,
    );
  }

  /** Signed yaw rate (rad/s) at t, from the heading change over a short window. */
  yawRate(t: number): number {
    const a = this.pointAt(t - 0.25, _a), b = this.pointAt(t, _b), c = this.pointAt(t + 0.25, _c);
    const h1 = Math.atan2(b.x - a.x, b.z - a.z), h2 = Math.atan2(c.x - b.x, c.z - b.z);
    let d = h2 - h1;
    if (d > Math.PI) d -= Math.PI * 2;
    if (d < -Math.PI) d += Math.PI * 2;
    return d / 0.25;
  }

  /**
   * Camera pose at time t: position, a look target slightly ahead, and the returned roll (bank)
   * from the turn rate, smoothed over about a second so it eases in and out.
   */
  pose(t: number, pos: THREE.Vector3, look: THREE.Vector3): number {
    this.pointAt(t, pos);
    // Averaging a few look-ahead points keeps the aim steady through tight S-bends.
    look.set(0, 0, 0);
    for (let i = 1; i <= 3; i++) look.add(this.pointAt(t + 0.22 * i, _a));
    look.multiplyScalar(1 / 3);
    look.y -= 1.2;
    let rate = 0;
    for (let i = -2; i <= 2; i++) rate += this.yawRate(t + i * 0.25) * (3 - Math.abs(i));
    rate /= 9;
    return Math.max(-0.42, Math.min(0.42, -rate * 0.32));
  }
}
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3();

/**
 * Uniform XZ grid over the dense path samples. Answers "how close does the camera ever get to
 * this box?" with a few hundred point tests instead of the whole path.
 */
export class PathIndex {
  static readonly CELL = 32;
  private readonly cells = new Map<number, number[]>();
  constructor(
    private readonly pts: Float64Array,
    count: number,
  ) {
    for (let i = 0; i < count; i++) {
      const key = PathIndex.key(Math.floor(pts[i * 3] / PathIndex.CELL), Math.floor(pts[i * 3 + 2] / PathIndex.CELL));
      let c = this.cells.get(key);
      if (!c) this.cells.set(key, (c = []));
      c.push(i);
    }
  }
  private static key(cx: number, cz: number): number {
    return (cx + 4096) * 8192 + (cz + 4096);
  }
  /**
   * Smallest 3D distance from any path sample to the box, capped at `cap`. Samples are well under
   * one unit apart, so the continuous path never gets closer than the result minus 0.5.
   */
  distToBox(minX: number, minY: number, minZ: number, maxX: number, maxY: number, maxZ: number, cap: number): number {
    const C = PathIndex.CELL, p = this.pts;
    let best = cap * cap;
    const cx1 = Math.floor((maxX + cap) / C), cz1 = Math.floor((maxZ + cap) / C);
    for (let cx = Math.floor((minX - cap) / C); cx <= cx1; cx++)
      for (let cz = Math.floor((minZ - cap) / C); cz <= cz1; cz++) {
        const cell = this.cells.get(PathIndex.key(cx, cz));
        if (!cell) continue;
        for (const i of cell) {
          const x = p[i * 3], y = p[i * 3 + 1], z = p[i * 3 + 2];
          const dx = x < minX ? minX - x : x > maxX ? x - maxX : 0;
          const dy = y < minY ? minY - y : y > maxY ? y - maxY : 0;
          const dz = z < minZ ? minZ - z : z > maxZ ? z - maxZ : 0;
          const d = dx * dx + dy * dy + dz * dz;
          if (d < best) best = d;
        }
      }
    return Math.sqrt(best);
  }
  distToPoint(x: number, y: number, z: number, cap: number): number {
    return this.distToBox(x, y, z, x, y, z, cap);
  }
}
