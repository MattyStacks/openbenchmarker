import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { BENCHMARKS } from "../src/benchmark/catalog";
import { PRESETS, getPreset } from "../src/benchmark/presets";
import { SolidIndex, layoutDrones, layoutSwarm, orbitAt, orbitBox, type Box } from "../src/engine/layout";
import { mulberry32 } from "../src/engine/rng";
import { layoutLanternStrings, layoutSigns, signBox } from "../src/engine/signlayout";
import { partBox, planCity } from "../src/engine/towergen";
import { CLEAR_MOVING, CLEAR_SOLID, FLIGHT, JOURNEY_SECONDS, pathDistToBox } from "../src/engine/world";

/** Brute force: closest approach of the dense path to a box. */
function bruteDist(b: Box): number {
  const p = FLIGHT.pts;
  let best = Infinity;
  for (let i = 0; i < p.length / 3; i++) {
    const x = p[i * 3], y = p[i * 3 + 1], z = p[i * 3 + 2];
    const dx = Math.max(b.minX - x, 0, x - b.maxX), dy = Math.max(b.minY - y, 0, y - b.maxY), dz = Math.max(b.minZ - z, 0, z - b.maxZ);
    best = Math.min(best, Math.hypot(dx, dy, dz));
  }
  return best;
}

const expectClear = (b: Box, r: number, what: string) => {
  const d = pathDistToBox(b.minX, b.minY, b.minZ, b.maxX, b.maxY, b.maxZ, r + 1);
  if (d < r) throw new Error(`${what} is ${d.toFixed(2)} from the camera path (needs ${r}): ${JSON.stringify(b)}`);
};

describe("flight path", () => {
  it("is a closed loop: the pose at t and t + duration match", () => {
    const a = FLIGHT.pointAt(7.3, new THREE.Vector3()), b = FLIGHT.pointAt(7.3 + JOURNEY_SECONDS, new THREE.Vector3());
    expect(a.distanceTo(b)).toBeLessThan(1e-6);
  });

  it("moves smoothly: no jumps between frames at 1000 fps", () => {
    const a = new THREE.Vector3(), b = new THREE.Vector3();
    let maxStep = 0;
    for (let t = 0; t < JOURNEY_SECONDS; t += 0.001) {
      FLIGHT.pointAt(t, a);
      FLIGHT.pointAt(t + 0.001, b);
      maxStep = Math.max(maxStep, a.distanceTo(b));
    }
    expect(maxStep).toBeLessThan(0.5); // < 500 units/s anywhere
  });

  it("stays above the street", () => {
    for (let i = 0; i < FLIGHT.pts.length / 3; i++) expect(FLIGHT.pts[i * 3 + 1]).toBeGreaterThanOrEqual(6);
  });

  it("pose is a pure function of t", () => {
    const p1 = new THREE.Vector3(), l1 = new THREE.Vector3(), p2 = new THREE.Vector3(), l2 = new THREE.Vector3();
    for (const t of [0, 3.25, 41.7, 90.1]) {
      const r1 = FLIGHT.pose(t, p1, l1), r2 = FLIGHT.pose(t, p2, l2);
      expect([p1.toArray(), l1.toArray(), r1]).toEqual([p2.toArray(), l2.toArray(), r2]);
      expect(Math.abs(r1)).toBeLessThanOrEqual(0.42);
    }
  });

  it("the clearance index agrees with brute force", () => {
    const rnd = mulberry32(5);
    for (let i = 0; i < 300; i++) {
      const x = (rnd() * 2 - 1) * 500, z = (rnd() * 2 - 1) * 500, y = rnd() * 120;
      const b: Box = { minX: x, minY: y, minZ: z, maxX: x + rnd() * 30, maxY: y + rnd() * 60, maxZ: z + rnd() * 30 };
      const brute = bruteDist(b);
      const fast = FLIGHT.index.distToBox(b.minX, b.minY, b.minZ, b.maxX, b.maxY, b.maxZ, 60);
      expect(fast).toBeCloseTo(Math.min(brute, 60), 6);
    }
  });
});

const plans = new Map(PRESETS.map((p) => [p.id, planCity(p.buildings, p.towerDetail, 1984)]));
const solidsFor = (id: (typeof PRESETS)[number]["id"]) => {
  const s = new SolidIndex();
  for (const p of plans.get(id)!.parts) s.add(partBox(p));
  return s;
};

describe("camera clearance", () => {
  it("every tower part, bridge and light bar keeps CLEAR_SOLID from the path, at any preset", () => {
    for (const preset of PRESETS) {
      const plan = plans.get(preset.id)!;
      expect(plan.towers.length).toBe(preset.buildings);
      for (const p of plan.parts) expectClear(partBox(p), CLEAR_SOLID, `${preset.id} part kind ${p.k}`);
    }
  });

  it("every sign and lantern string keeps CLEAR_SOLID from the path, at any preset", () => {
    for (const preset of PRESETS) {
      const plan = plans.get(preset.id)!;
      const signs = layoutSigns(plan.faces, preset.signs, 1984);
      expect(signs.length).toBeGreaterThanOrEqual(preset.signs * 0.9);
      for (const s of signs) expectClear(signBox(s), CLEAR_SOLID, `${preset.id} sign`);
      for (const l of layoutLanternStrings(plan.towers, Math.round(preset.signs / 10), 1984))
        for (const [x, y, z] of l.pts) expectClear({ minX: x, minY: y, minZ: z, maxX: x, maxY: y, maxZ: z }, CLEAR_SOLID, `${preset.id} lantern`);
    }
  });

  it("the city is deterministic for a seed, and higher presets add detail", () => {
    expect(planCity(80, 2, 7)).toEqual(planCity(80, 2, 7));
    const low = plans.get("Low")!, ultra = plans.get("Ultra")!;
    expect(ultra.parts.length).toBeGreaterThan(low.parts.length * 6);
    expect(ultra.bridges).toBeGreaterThan(0);
    const arches = new Set(ultra.towers.map((t) => t.arche));
    expect([...arches].sort()).toEqual(["mega", "podium", "round", "slab", "tiered"]);
  });

  it("near drones keep CLEAR_MOVING from the path and stay out of solids, at any preset", () => {
    for (const preset of PRESETS) {
      const solids = solidsFor(preset.id);
      const drones = layoutDrones(preset.drones, 1984, solids);
      expect(drones.length).toBe(preset.drones);
      for (const o of drones) {
        expectClear(orbitBox(o), CLEAR_MOVING, `${preset.id} drone`);
        expect(solids.hits(orbitBox(o))).toBe(false);
      }
    }
  });

  it("far-swarm orbits keep CLEAR_MOVING from the path (sampled along each ring)", () => {
    const extreme = getPreset("Extreme")!;
    const swarm = layoutSwarm(extreme.farDrones, 1984);
    expect(swarm.length).toBe(extreme.farDrones);
    const v = new THREE.Vector3();
    for (const o of swarm.slice(0, 400))
      for (let k = 0; k < 64; k++) {
        orbitAt(o, (k / 64) * ((Math.PI * 2) / Math.abs(o.w)), v);
        expect(FLIGHT.index.distToPoint(v.x, v.y, v.z, CLEAR_MOVING + 1) - 0.5).toBeGreaterThanOrEqual(CLEAR_MOVING - 1e-9);
      }
  });
});

describe("benchmark", () => {
  it("there is exactly one benchmark", () => {
    expect(BENCHMARKS).toHaveLength(1);
    expect(BENCHMARKS[0].gameId).toBe("openbenchmarker_neon_flythrough");
  });
});

describe("preset scaling", () => {
  const low = getPreset("Low")!, extreme = getPreset("Extreme")!;
  it("Extreme is far heavier than Low", () => {
    expect(extreme.cars).toBeGreaterThanOrEqual(low.cars * 10);
    expect(extreme.rain).toBeGreaterThanOrEqual(low.rain * 50);
    expect(extreme.buildings).toBeGreaterThanOrEqual(low.buildings * 8);
    expect(extreme.towerDetail).toBeGreaterThan(low.towerDetail);
    expect(extreme.reflections).toBeGreaterThan(low.reflections);
  });
  it("only Ultra and Extreme have reflections", () => {
    expect(PRESETS.filter((p) => p.reflections > 0).map((p) => p.id)).toEqual(["Ultra", "Extreme"]);
  });
  it("every numeric knob is non-decreasing from Low to Extreme", () => {
    const keys = Object.keys(low).filter((k) => typeof (low as unknown as Record<string, unknown>)[k] === "number");
    expect(keys.length).toBeGreaterThanOrEqual(10);
    for (let i = 1; i < PRESETS.length; i++)
      for (const k of keys)
        expect((PRESETS[i] as unknown as Record<string, number>)[k], `${PRESETS[i].id}.${k}`).toBeGreaterThanOrEqual((PRESETS[i - 1] as unknown as Record<string, number>)[k]);
  });
});
