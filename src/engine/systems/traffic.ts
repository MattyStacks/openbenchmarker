import * as THREE from "three";
import { NEON, writeOriented, type BuildCtx } from "../ctx";
import { stream } from "../rng";
import { BLOCK, HALF } from "../world";

/** Ground and flying cars with light trails (v1; replaced by sky-lanes). */
export function buildTraffic(ctx: BuildCtx): void {
  const { group, track, preset } = ctx;
  const rnd = stream(ctx.seed, 5);
  interface Car { axis: 0 | 1; lane: number; y: number; dir: number; speed: number; phase: number }
  const blocks = Math.round(HALF / BLOCK);
  const groundCount = Math.round(preset.cars * 0.5);
  const cars: Car[] = [];
  for (let i = 0; i < preset.cars; i++) {
    const flying = i >= groundCount;
    const dir = rnd() < 0.5 ? 1 : -1;
    const street = (Math.floor(rnd() * blocks * 2) - blocks + 1) * BLOCK;
    cars.push({
      axis: rnd() < 0.5 ? 0 : 1,
      lane: street + dir * (flying ? 3 + rnd() * 4 : 4),
      y: flying ? 30 + rnd() * 90 : 1.0,
      dir,
      speed: flying ? 70 + rnd() * 90 : 28 + rnd() * 30,
      phase: rnd() * HALF * 2,
    });
  }
  const bodies = new THREE.InstancedMesh(
    track(new THREE.BoxGeometry(2.4, 1.3, 5)),
    track(new THREE.MeshStandardMaterial({ color: 0x1b1d2e, metalness: 0.9, roughness: 0.3, emissive: 0x220a30 })),
    Math.max(1, cars.length),
  );
  bodies.count = cars.length;
  const trails = new THREE.InstancedMesh(
    track(new THREE.BoxGeometry(0.7, 0.45, 1).translate(0, 0, -0.5)),
    track(new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false })),
    Math.max(1, cars.length * 2),
  );
  trails.count = cars.length * 2;
  const col = new THREE.Color();
  cars.forEach((c, i) => {
    const flying = c.y > 2;
    col.set(flying ? NEON[Math.floor(rnd() * 3)] : c.dir > 0 ? 0xff2a3a : 0xfff0c8).multiplyScalar(flying ? 3 : 2.4);
    trails.setColorAt(i * 2, col);
    trails.setColorAt(i * 2 + 1, col);
  });
  bodies.frustumCulled = trails.frustumCulled = false;
  group.add(bodies, trails);
  const span = HALF * 2;
  ctx.onUpdate((t) => {
    const body = bodies.instanceMatrix.array as Float32Array;
    const tr = trails.instanceMatrix.array as Float32Array;
    for (let i = 0; i < cars.length; i++) {
      const c = cars[i];
      const s = ((((c.phase + c.dir * c.speed * t) % span) + span) % span) - HALF;
      const x = c.axis === 0 ? s : c.lane;
      const z = c.axis === 0 ? c.lane : s;
      const fx = c.axis === 0 ? c.dir : 0, fz = c.axis === 1 ? c.dir : 0;
      writeOriented(body, i * 16, fx, fz, 1, 1, 1, x, c.y, z);
      const len = c.y > 2 ? 26 : 9;
      writeOriented(tr, i * 32, fx, fz, 1, 1, len, x - fx * 2.5 + fz * 0.8, c.y, z - fz * 2.5 - fx * 0.8);
      writeOriented(tr, i * 32 + 16, fx, fz, 1, 1, len, x - fx * 2.5 - fz * 0.8, c.y, z - fz * 2.5 + fx * 0.8);
    }
    bodies.instanceMatrix.needsUpdate = true;
    trails.instanceMatrix.needsUpdate = true;
  });
  ctx.counts.cars = cars.length;
}
