import * as THREE from "three";
import { NEON, writeOriented, type BuildCtx } from "../ctx";
import { stream } from "../rng";

/** Drones orbiting between towers (v1; replaced by quadcopters + far swarm). */
export function buildDrones(ctx: BuildCtx): void {
  const { group, track, preset, spots } = ctx;
  const rnd = stream(ctx.seed, 6);
  const spec = Array.from({ length: preset.drones }, () => {
    const s = spots[Math.floor(rnd() * spots.length)] ?? { x: 0, z: 0, h: 60, w: 20, d: 20 };
    return { cx: s.x, cz: s.z, y: 20 + rnd() * (s.h + 20), r: Math.max(s.w, s.d) * 0.7 + 6 + rnd() * 18, w: (0.4 + rnd()) * (rnd() < 0.5 ? 1 : -1), p: rnd() * 6.28 };
  });
  const drones = new THREE.InstancedMesh(
    track(new THREE.OctahedronGeometry(1.3)),
    track(new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false })),
    Math.max(1, spec.length),
  );
  drones.count = spec.length;
  const col = new THREE.Color();
  spec.forEach((_, i) => drones.setColorAt(i, col.set(NEON[i % NEON.length]).multiplyScalar(3)));
  drones.frustumCulled = false;
  group.add(drones);
  ctx.onUpdate((t) => {
    const a = drones.instanceMatrix.array as Float32Array;
    spec.forEach((d, i) => {
      const ang = d.p + t * d.w;
      writeOriented(a, i * 16, 0, 1, 1, 1, 1, d.cx + Math.cos(ang) * d.r, d.y + Math.sin(t * 1.7 + d.p) * 3, d.cz + Math.sin(ang) * d.r);
    });
    drones.instanceMatrix.needsUpdate = true;
  });
  ctx.counts.drones = spec.length;
}
