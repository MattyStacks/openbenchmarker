import * as THREE from "three";
import type { Preset } from "../benchmark/presets";
import type { BuildCtx } from "./ctx";
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
  buildSky(ctx);
  buildAtmosphere(ctx);
  const plan = buildTowers(ctx);
  ctx.spots = plan.towers;
  buildSigns(ctx, plan);
  buildRain(ctx);
  buildTraffic(ctx);
  buildDrones(ctx);
  buildFx(ctx);
  return {
    group,
    counts: ctx.counts,
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
