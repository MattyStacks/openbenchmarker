import * as THREE from "three";
import type { Preset } from "../benchmark/presets";
import type { BuildCtx, GlowLight } from "./ctx";
import { SolidIndex } from "./layout";
import { SEED } from "./rng";
import { buildAtmosphere } from "./systems/atmosphere";
import { buildDrones } from "./systems/drones";
import { buildFx } from "./systems/fx";
import { buildRain } from "./systems/rain";
import { buildSigns } from "./systems/signs";
import { buildSky } from "./systems/sky";
import { buildTowers } from "./systems/towers";
import { buildTraffic } from "./systems/traffic";

export interface City {
  group: THREE.Group;
  counts: Record<string, number>;
  /** Bright neon sources (for effects that light the air). */
  lights: GlowLight[];
  update(t: number, camera: THREE.Camera): void;
  dispose(): void;
}

/** Assemble every scene system for a preset. Deterministic: seeded streams, motion from t only. */
export function buildCity(preset: Preset, size: { w: number; h: number }, seed = SEED): City {
  const group = new THREE.Group();
  const disposables: { dispose(): void }[] = [];
  const updaters: ((t: number, camera: THREE.Camera) => void)[] = [];
  const ctx: BuildCtx = {
    preset,
    seed,
    size,
    group,
    shadows: preset.shadowMap > 0,
    track: (x) => (disposables.push(x), x),
    onUpdate: (fn) => void updaters.push(fn),
    counts: {},
    spots: [],
    lights: [],
    solids: new SolidIndex(),
  };
  // Each system builds into its own named group (dev captures can time them one by one).
  const sub = <T>(name: string, build: () => T): T => {
    const g = new THREE.Group();
    g.name = name;
    group.add(g);
    ctx.group = g;
    return build();
  };
  sub("sky", () => buildSky(ctx));
  sub("atmosphere", () => buildAtmosphere(ctx));
  const plan = sub("towers", () => buildTowers(ctx));
  ctx.spots = plan.towers;
  sub("signs", () => buildSigns(ctx, plan));
  sub("rain", () => buildRain(ctx));
  sub("traffic", () => buildTraffic(ctx));
  sub("drones", () => buildDrones(ctx));
  sub("fx", () => buildFx(ctx));
  return {
    group,
    counts: ctx.counts,
    lights: ctx.lights,
    update(t, camera) {
      for (const u of updaters) u(t, camera);
    },
    dispose() {
      for (const d of disposables) d.dispose();
      disposables.length = 0;
      group.clear();
    },
  };
}
