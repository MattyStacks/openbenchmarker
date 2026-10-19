import { describe, expect, it } from "vitest";
import { BENCHMARKS } from "../src/benchmark/catalog";
import { PRESETS, getPreset } from "../src/benchmark/presets";
import { CORRIDOR, FLIGHT_CURVE, FLIGHT_POINTS, distToPath, layoutBuildings } from "../src/engine/city";

describe("flight corridor", () => {
  it("flight points lie on the path", () => {
    for (const [x, , z] of FLIGHT_POINTS) expect(distToPath(x, z)).toBeCloseTo(0, 6);
  });

  it("points offset sideways from the path clear the corridor", () => {
    for (let i = 0; i < 50; i++) {
      const u = i / 50;
      const p = FLIGHT_CURVE.getPointAt(u);
      const tan = FLIGHT_CURVE.getTangentAt(u);
      const nx = -tan.z, nz = tan.x;
      const len = Math.hypot(nx, nz);
      // 40 units sideways is at least the corridor away (curve may bend back, so allow >= CORRIDOR).
      expect(distToPath(p.x + (nx / len) * 40, p.z + (nz / len) * 40)).toBeGreaterThanOrEqual(CORRIDOR);
    }
  });

  it("no building footprint intrudes into the corridor, at any preset", () => {
    for (const preset of PRESETS) {
      const spots = layoutBuildings(preset.buildings, 1984);
      expect(spots.length).toBe(preset.buildings);
      for (const s of spots) expect(distToPath(s.x, s.z) - 0.5 * Math.hypot(s.w, s.d)).toBeGreaterThanOrEqual(CORRIDOR);
    }
  });

  it("layout is deterministic for a seed", () => {
    expect(layoutBuildings(50, 7)).toEqual(layoutBuildings(50, 7));
  });

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
    expect(extreme.buildings).toBeGreaterThanOrEqual(low.buildings * 10);
    expect(extreme.reflections).toBeGreaterThan(low.reflections);
  });
  it("only Ultra and Extreme have reflections", () => {
    expect(PRESETS.filter((p) => p.reflections > 0).map((p) => p.id)).toEqual(["Ultra", "Extreme"]);
  });
  it("every tier is at least as heavy as the one below", () => {
    for (let i = 1; i < PRESETS.length; i++)
      for (const k of ["buildings", "rain", "signs", "cars", "drones", "holos", "bloom", "shadowMap", "msaa", "reflections"] as const)
        expect(PRESETS[i][k]).toBeGreaterThanOrEqual(PRESETS[i - 1][k]);
  });
});
