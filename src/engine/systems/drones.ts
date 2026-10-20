import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import type { BuildCtx } from "../ctx";
import { makeGlow } from "../glow";
import { layoutDrones, layoutSwarm, orbitAt } from "../layout";
import { stream } from "../rng";

/** Drone scale: about 3.9 units rotor tip to rotor tip. */
const S = 1.4;
const ARM = 0.78; // arm tip offset along x and z (unscaled)

/** One quadcopter as a single vertex-coloured geometry: body, canopy, cargo pod, 4 arms, motors, rotors. */
function droneGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const add = (g: THREE.BufferGeometry, hex: number) => {
    const c = new THREE.Color(hex);
    const n = g.getAttribute("position").count;
    const col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) col.set([c.r, c.g, c.b], i * 3);
    g.setAttribute("color", new THREE.BufferAttribute(col, 3));
    parts.push(g.index ? g.toNonIndexed() : g);
  };
  add(new THREE.BoxGeometry(1.1, 0.4, 1.4), 0x23232f);
  add(new THREE.BoxGeometry(0.7, 0.2, 0.8).translate(0, 0.3, -0.05), 0x3a3d55);
  add(new THREE.BoxGeometry(0.6, 0.35, 0.6).translate(0, -0.38, 0), 0x2c2033);
  for (const [sx, sz] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) {
    const len = Math.hypot(ARM, ARM) * 2;
    add(new THREE.BoxGeometry(0.16, 0.12, len / 2).translate(0, 0.05, len / 4).rotateY(Math.atan2(sx, sz)), 0x1b1b26);
    add(new THREE.CylinderGeometry(0.15, 0.15, 0.26, 8).translate(sx * ARM, 0.12, sz * ARM), 0x15151e);
    add(new THREE.CylinderGeometry(0.62, 0.62, 0.03, 16).translate(sx * ARM, 0.28, sz * ARM), 0x1e1e2c);
  }
  const g = mergeGeometries(parts)!;
  parts.forEach((p) => p.dispose());
  g.scale(S, S, S);
  return g;
}

/** Nav light offsets in drone space (scaled): red port, green starboard, white strobe, cyan belly. */
const NAV = [
  { o: [-ARM, 0.18, ARM], c: [2.6, 0.15, 0.2], size: 0.16, blink: [0, 0, 1] },
  { o: [ARM, 0.18, ARM], c: [0.2, 2.6, 0.45], size: 0.16, blink: [0, 0, 1] },
  { o: [0, 0.45, -0.75], c: [4, 4, 4], size: 0.2, blink: [1.1, 0, 0.12] },
  { o: [0, -0.62, 0], c: [0.25, 1.1, 1.8], size: 0.42, blink: [0, 0, 1] },
] as const;

/**
 * Near drones (readable quadcopters on orbits beside the flight path and across the city) and the
 * far swarm (blinking specks whose orbits run entirely in the vertex shader).
 */
export function buildDrones(ctx: BuildCtx): void {
  const { group, track, preset } = ctx;
  const rnd = stream(ctx.seed, 9);

  // --- Near quadcopters --------------------------------------------------------------------
  const orbits = layoutDrones(preset.drones, ctx.seed, ctx.solids);
  const n = orbits.length;
  const bodies = new THREE.InstancedMesh(
    track(droneGeometry()),
    track(new THREE.MeshStandardMaterial({ vertexColors: true, metalness: 0.65, roughness: 0.4, emissive: 0x0a0614 })),
    Math.max(1, n),
  );
  bodies.count = n;
  bodies.frustumCulled = false;
  bodies.castShadow = ctx.shadows;
  group.add(bodies);

  const navColor = new Float32Array(n * 4 * 3);
  const navParams = new Float32Array(n * 4 * 4);
  for (let i = 0; i < n; i++)
    NAV.forEach((L, k) => {
      const j = i * 4 + k;
      navColor.set(L.c, j * 3);
      navParams.set([L.size * S, L.blink[0] * (0.85 + rnd() * 0.3), rnd(), L.blink[2]], j * 4);
    });
  const nav = makeGlow(ctx, { count: n * 4, color: navColor, params: navParams, minPx: 1.4 });

  const p = new THREE.Vector3(), q = new THREE.Vector3(), v = new THREE.Vector3();
  const m = new THREE.Matrix4(), quat = new THREE.Quaternion(), e = new THREE.Euler(0, 0, 0, "YXZ"), one = new THREE.Vector3(1, 1, 1);
  ctx.onUpdate((t) => {
    for (let i = 0; i < n; i++) {
      const o = orbits[i];
      orbitAt(o, t, p);
      orbitAt(o, t + 0.1, q);
      const yaw = Math.atan2(q.x - p.x, q.z - p.z);
      const speed = q.distanceTo(p) * 10;
      e.set(0.012 * speed, yaw, Math.sin(t * 0.9 + o.p) * 0.06);
      quat.setFromEuler(e);
      m.compose(p, quat, one);
      bodies.setMatrixAt(i, m);
      for (let k = 0; k < 4; k++) {
        const L = NAV[k];
        v.set(L.o[0] * S, L.o[1] * S, L.o[2] * S).applyMatrix4(m);
        nav.pos.set([v.x, v.y, v.z], (i * 4 + k) * 3);
      }
    }
    bodies.instanceMatrix.needsUpdate = true;
    nav.markDirty();
  });

  // --- Far swarm ---------------------------------------------------------------------------
  const swarm = layoutSwarm(preset.farDrones, ctx.seed);
  const m2 = swarm.length;
  const orbitA = new Float32Array(m2 * 4), orbitB = new Float32Array(m2 * 4);
  const color = new Float32Array(m2 * 3), params = new Float32Array(m2 * 4);
  swarm.forEach((o, i) => {
    orbitA.set([o.cx, o.cz, o.r, o.w], i * 4);
    orbitB.set([o.y, o.bob, o.p, 1.3], i * 4);
    const kind = rnd();
    color.set(kind < 0.45 ? [3.2, 0.25, 0.3] : kind < 0.8 ? [3, 3, 3.2] : [0.4, 2.2, 3.4], i * 3);
    const blinks = rnd() < 0.5;
    params.set([0.5 + rnd() * 0.5, blinks ? 0.5 + rnd() : 0, rnd(), 0.5], i * 4);
  });
  makeGlow(ctx, { count: m2, color, params, orbitA, orbitB, minPx: 1.3 });

  ctx.counts.drones = n;
  ctx.counts.farDrones = m2;
}
