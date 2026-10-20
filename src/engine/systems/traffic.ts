import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import type { BuildCtx } from "../ctx";
import { FOG_DENSITY, FOG_FN } from "../fog";
import { makeGlow } from "../glow";
import { carPos, carY, layoutTraffic } from "../layout";
import { stream } from "../rng";
import { HALF } from "../world";

const TINTS = [0x2a2c3e, 0x3a2236, 0x1e2c38, 0x34322e, 0x2c2440, 0x40404c];
const GLOWS: [number, number, number][] = [
  [2.4, 0.3, 1.8],
  [0.3, 1.6, 2.6],
  [1.3, 0.5, 2.6],
  [2.6, 1.2, 0.3],
];

/** A wedge hover-car (nose +z): extruded side profile, canopy, side thrusters. Vertex-coloured. */
function carGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const add = (g: THREE.BufferGeometry, hex: number) => {
    const c = new THREE.Color(hex);
    const gi = g.index ? g.toNonIndexed() : g;
    gi.deleteAttribute("uv");
    const n = gi.getAttribute("position").count;
    const col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) col.set([c.r, c.g, c.b], i * 3);
    gi.setAttribute("color", new THREE.BufferAttribute(col, 3));
    parts.push(gi);
  };
  const profile = (pts: [number, number][], width: number) => {
    const s = new THREE.Shape(pts.map(([z, y]) => new THREE.Vector2(z, y)));
    // Extrude along +z of the shape space, then turn so the profile's x becomes world z.
    return new THREE.ExtrudeGeometry(s, { depth: width, bevelEnabled: false }).translate(0, 0, -width / 2).rotateY(-Math.PI / 2);
  };
  add(profile([[-2.3, 0.05], [2.3, 0.05], [2.45, 0.32], [1.3, 0.62], [-0.7, 0.78], [-2.25, 0.7], [-2.45, 0.35]], 2.1), 0xffffff);
  add(profile([[0.9, 0.62], [-0.5, 1.12], [-1.6, 1.05], [-1.9, 0.72]], 1.5), 0x0e1428);
  for (const sx of [-1, 1]) add(new THREE.CylinderGeometry(0.3, 0.36, 2.2, 8).rotateX(Math.PI / 2).translate(sx * 1.15, 0.22, -0.6), 0x18181f);
  const g = mergeGeometries(parts)!;
  parts.forEach((p) => p.dispose());
  return g;
}

/**
 * Flying traffic on the stacked sky-lanes plus street-level cars: wedge bodies, neon under-glow,
 * head and tail lights, fading light trails, and faint holographic markers along the sky-lanes.
 */
export function buildTraffic(ctx: BuildCtx): void {
  const { group, track, preset } = ctx;
  const rnd = stream(ctx.seed, 41);
  const { lanes, cars } = layoutTraffic(preset.skyLanes, preset.cars, ctx.seed, ctx.solids);
  const n = cars.length;

  const bodies = new THREE.InstancedMesh(
    track(carGeometry()),
    track(new THREE.MeshStandardMaterial({ vertexColors: true, metalness: 0.75, roughness: 0.32, emissive: 0x0c0614 })),
    Math.max(1, n),
  );
  bodies.count = n;
  const col = new THREE.Color();
  cars.forEach((c, i) => bodies.setColorAt(i, col.set(TINTS[c.tint])));
  bodies.frustumCulled = false;
  bodies.castShadow = ctx.shadows;
  group.add(bodies);

  // Light trails: two per car, fading toward the back (position.z runs 0 at the car to -1).
  const trailGeo = track(new THREE.BoxGeometry(1, 1, 1).translate(0, 0, -0.5));
  const trailMat = track(
    new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: { uFogDensity: { value: FOG_DENSITY } },
      vertexShader: /* glsl */ `
        uniform float uFogDensity;
        varying float vFade;
        varying vec3 vCol;
        ${FOG_FN}
        void main() {
          vFade = 1.0 + position.z;
          vCol = vec3(1.0);
          #ifdef USE_INSTANCING_COLOR
            vCol = instanceColor;
          #endif
          vec4 wp = modelMatrix * instanceMatrix * vec4(position, 1.0);
          vCol *= 1.0 - 0.9 * ogbFogAmount(cameraPosition, wp.xyz, uFogDensity);
          gl_Position = projectionMatrix * viewMatrix * wp;
        }`,
      fragmentShader: /* glsl */ `
        varying float vFade;
        varying vec3 vCol;
        void main() { gl_FragColor = vec4(vCol * vFade * vFade * 0.8, 1.0); }`,
    }),
  );
  const trails = new THREE.InstancedMesh(trailGeo, trailMat, Math.max(1, n * 2));
  trails.count = n * 2;
  cars.forEach((c, i) => {
    const sky = lanes[c.lane].level > 0;
    const g = GLOWS[c.glow];
    if (sky) col.setRGB(g[0], g[1], g[2]);
    else col.setRGB(2.4, 0.15, 0.2);
    trails.setColorAt(i * 2, col);
    trails.setColorAt(i * 2 + 1, col);
  });
  trails.frustumCulled = false;
  trails.renderOrder = 3;
  group.add(trails);

  // Lights: 2 head, 2 tail, 1 under-glow per car.
  const LIGHTS = [
    { o: [-0.75, 0.38, 2.35], size: 0.3, c: [4.5, 4.4, 4] },
    { o: [0.75, 0.38, 2.35], size: 0.3, c: [4.5, 4.4, 4] },
    { o: [-0.8, 0.45, -2.4], size: 0.26, c: [3.2, 0.12, 0.18] },
    { o: [0.8, 0.45, -2.4], size: 0.26, c: [3.2, 0.12, 0.18] },
    { o: [0, -0.35, 0], size: 1.5, c: null },
  ] as const;
  const lcol = new Float32Array(n * 5 * 3), lpar = new Float32Array(n * 5 * 4);
  cars.forEach((c, i) =>
    LIGHTS.forEach((L, k) => {
      const j = i * 5 + k;
      const g = GLOWS[c.glow];
      lcol.set(L.c ?? (lanes[c.lane].level > 0 ? [g[0] * 0.55, g[1] * 0.55, g[2] * 0.55] : [0.5, 0.25, 0.1]), j * 3);
      lpar.set([L.size, 0, 0, 1], j * 4);
    }),
  );
  const lights = makeGlow(ctx, { count: n * 5, color: lcol, params: lpar, minPx: 1.2 });

  // Holographic lane markers: faint dots along each sky-lane, every `step` units.
  // Markers from three lane levels up (Medium+): denser with more levels.
  const sky = preset.skyLanes >= 3 ? lanes.filter((l) => l.level > 0 && l.dir === 1) : [];
  const step = preset.skyLanes >= 5 ? 24 : preset.skyLanes >= 4 ? 32 : 44;
  const markers: number[] = [];
  for (const l of sky)
    for (let s = -HALF + (rnd() * step); s < HALF; s += step) markers.push(l.axis === 0 ? s : l.c - LANE_MID, l.y - 1.2, l.axis === 0 ? l.c + LANE_MID : s);
  const nm = markers.length / 3;
  if (nm) {
    const mcol = new Float32Array(nm * 3), mpar = new Float32Array(nm * 4);
    for (let i = 0; i < nm; i++) {
      mcol.set(i % 7 === 0 ? [1.4, 0.3, 1.1] : [0.25, 0.9, 1.3], i * 3);
      mpar.set([0.32, 0, 0, 1], i * 4);
    }
    const m = makeGlow(ctx, { count: nm, color: mcol, params: mpar, minPx: 1 });
    m.pos.set(markers);
    m.markDirty();
  }

  const body = bodies.instanceMatrix.array as Float32Array;
  const tr = trails.instanceMatrix.array as Float32Array;
  const v = new THREE.Vector3();
  ctx.onUpdate((t) => {
    for (let i = 0; i < n; i++) {
      const c = cars[i];
      const L = lanes[c.lane];
      const s = carPos(L, c.phase, t);
      const y = carY(c, lanes, t);
      const x = L.axis === 0 ? s : L.c, z = L.axis === 0 ? L.c : s;
      const fx = L.axis === 0 ? L.dir : 0, fz = L.axis === 1 ? L.dir : 0;
      // Column-major: local x -> (fz, 0, -fx), local y -> up, local z -> (fx, 0, fz).
      const o = i * 16;
      body[o] = fz; body[o + 1] = 0; body[o + 2] = -fx; body[o + 3] = 0;
      body[o + 4] = 0; body[o + 5] = 1; body[o + 6] = 0; body[o + 7] = 0;
      body[o + 8] = fx; body[o + 9] = 0; body[o + 10] = fz; body[o + 11] = 0;
      body[o + 12] = x; body[o + 13] = y; body[o + 14] = z; body[o + 15] = 1;
      const len = L.speed * 0.2;
      for (let k = 0; k < 2; k++) {
        const side = k ? 0.8 : -0.8;
        const q = i * 32 + k * 16;
        tr[q] = fz * 0.22; tr[q + 1] = 0; tr[q + 2] = -fx * 0.22; tr[q + 3] = 0;
        tr[q + 4] = 0; tr[q + 5] = 0.14; tr[q + 6] = 0; tr[q + 7] = 0;
        tr[q + 8] = fx * len; tr[q + 9] = 0; tr[q + 10] = fz * len; tr[q + 11] = 0;
        tr[q + 12] = x + fz * side - fx * 2.4; tr[q + 13] = y + 0.45; tr[q + 14] = z - fx * side - fz * 2.4; tr[q + 15] = 1;
      }
      for (let k = 0; k < 5; k++) {
        const lo = LIGHTS[k].o;
        v.set(x + fz * lo[0] + fx * lo[2], y + lo[1], z - fx * lo[0] + fz * lo[2]);
        lights.pos.set([v.x, v.y, v.z], (i * 5 + k) * 3);
      }
    }
    bodies.instanceMatrix.needsUpdate = true;
    trails.instanceMatrix.needsUpdate = true;
    lights.markDirty();
  });
  ctx.counts.cars = n;
  ctx.counts.lanes = lanes.length;
  ctx.counts.laneMarkers = nm;
}

/** Markers sit between a lane pair (on the street centre line). */
const LANE_MID = 3;
