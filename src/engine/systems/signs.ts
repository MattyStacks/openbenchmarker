import * as THREE from "three";
import type { BuildCtx } from "../ctx";
import { FOG_DENSITY, FOG_FN } from "../fog";
import { makeGlow } from "../glow";
import { stream } from "../rng";
import { ATLAS, cellRect, makeSignAtlas } from "../signatlas";
import { layoutLanternStrings, layoutSigns } from "../signlayout";
import type { CityPlan } from "../towergen";

/**
 * Every neon sign in one instanced draw: quads sampling the sign atlas, coloured per instance
 * (lettering + frame), with dark panels, a white-hot tube core, and per-sign flicker modes
 * (steady, broken tube, slow blink) as pure functions of uTime. Blade signs are double-sided and
 * read correctly from both sides. Also the lantern strings across streets.
 */
export function buildSigns(ctx: BuildCtx, plan: CityPlan): void {
  const { group, track, preset } = ctx;
  const signs = layoutSigns(plan.faces, preset.signs, ctx.seed);
  const n = signs.length;
  const atlas = track(makeSignAtlas(ctx.seed));

  const geo = track(new THREE.PlaneGeometry(1, 1));
  const aUv = new Float32Array(n * 4), aColA = new Float32Array(n * 3), aColB = new Float32Array(n * 3), aFx = new Float32Array(n * 2);
  const mat = track(
    new THREE.ShaderMaterial({
      side: THREE.DoubleSide,
      fog: true,
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uAtlas: { value: null }, uTime: { value: 0 } }]),
      vertexShader: /* glsl */ `
        attribute vec4 aUv;
        attribute vec3 aColA, aColB;
        attribute vec2 aFx;
        uniform float uTime;
        varying vec2 vLocal;
        varying vec4 vRect;
        varying vec3 vA, vB;
        varying float vOn;
        #include <fog_pars_vertex>
        float h11(float p) { p = fract(p * 0.1031); p *= p + 33.33; p *= p + p; return fract(p); }
        void main() {
          vLocal = uv;
          vRect = aUv;
          vec4 mvPosition = modelViewMatrix * instanceMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mvPosition;
          float on = 1.0;
          if (aFx.y > 0.5 && aFx.y < 1.5) on = h11(floor(uTime * 13.0) + aFx.x * 977.0) > 0.25 ? 1.0 : 0.12;
          else if (aFx.y > 1.5) on = fract(uTime * 0.45 + aFx.x) < 0.78 ? 1.0 : 0.08;
          vOn = on;
          vA = aColA;
          vB = aColB;
          #include <fog_vertex>
        }`,
      fragmentShader: /* glsl */ `
        uniform sampler2D uAtlas;
        varying vec2 vLocal;
        varying vec4 vRect;
        varying vec3 vA, vB;
        varying float vOn;
        #include <fog_pars_fragment>
        void main() {
          vec2 l = vLocal;
          if (!gl_FrontFacing) l.x = 1.0 - l.x;
          vec4 s = texture2D(uAtlas, vRect.xy + l * vRect.zw);
          if (s.a < 0.5) discard;
          vec3 col = vec3(0.012, 0.009, 0.024) + vB * s.b * 0.3;
          col += (vA * s.r + vB * s.g) * 2.7 * vOn;
          col += vec3(1.0) * smoothstep(0.78, 1.0, max(s.r, s.g)) * 0.9 * vOn;
          gl_FragColor = vec4(col, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
          #include <fog_fragment>
        }`,
    }),
  );
  mat.uniforms.uAtlas.value = atlas;
  ctx.onUpdate((t) => void (mat.uniforms.uTime.value = t));

  const mesh = new THREE.InstancedMesh(geo, mat, Math.max(1, n));
  mesh.count = n;
  const obj = new THREE.Object3D();
  const col = new THREE.Color();
  signs.forEach((s, i) => {
    obj.position.set(s.x, s.y, s.z);
    obj.rotation.set(0, Math.atan2(s.nx, s.nz), 0);
    obj.scale.set(s.w, s.h, 1);
    obj.updateMatrix();
    mesh.setMatrixAt(i, obj.matrix);
    const [x, y, w, h] = cellRect(s.kind, s.cell);
    aUv.set([x / ATLAS, (y + h) / ATLAS, w / ATLAS, -h / ATLAS], i * 4);
    col.set(s.colA);
    aColA.set([col.r, col.g, col.b], i * 3);
    const lr = col.r, lg = col.g, lb = col.b;
    col.set(s.colB);
    aColB.set([col.r, col.g, col.b], i * 3);
    aFx.set(s.fx, i * 2);
    // Signs light the rain around them.
    ctx.lights.push({ x: s.x + (s.blade ? 0 : s.nx * 2), y: s.y, z: s.z + (s.blade ? 0 : s.nz * 2), r: 8 + Math.max(s.w, s.h) * 0.9, color: new THREE.Color(lr, lg, lb) });
  });
  geo.setAttribute("aUv", new THREE.InstancedBufferAttribute(aUv, 4));
  geo.setAttribute("aColA", new THREE.InstancedBufferAttribute(aColA, 3));
  geo.setAttribute("aColB", new THREE.InstancedBufferAttribute(aColB, 3));
  geo.setAttribute("aFx", new THREE.InstancedBufferAttribute(aFx, 2));
  mesh.computeBoundingSphere();
  group.add(mesh);

  // Light spilling down through the rain beneath the biggest flat signs near the flight.
  const spill = signs
    .filter((s) => !s.blade && s.y - s.h / 2 > 14)
    .map((s) => ({ s, k: s.w * s.h }))
    .sort((a, b) => b.k - a.k)
    .slice(0, preset.lightShafts * 3)
    .map((o) => o.s);
  if (spill.length) {
    const L = 24;
    const shaftMat = track(
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
        uniforms: { uTime: { value: 0 }, uFogDensity: { value: FOG_DENSITY } },
        vertexShader: /* glsl */ `
          uniform float uFogDensity;
          varying vec2 vUv;
          varying vec3 vCol;
          ${FOG_FN}
          void main() {
            vUv = uv;
            vCol = vec3(1.0);
            #ifdef USE_INSTANCING_COLOR
              vCol = instanceColor;
            #endif
            vec4 wp = modelMatrix * instanceMatrix * vec4(position, 1.0);
            vCol *= 1.0 - 0.9 * ogbFogAmount(cameraPosition, wp.xyz, uFogDensity);
            gl_Position = projectionMatrix * viewMatrix * wp;
          }`,
        fragmentShader: /* glsl */ `
          uniform float uTime;
          varying vec2 vUv;
          varying vec3 vCol;
          void main() {
            float edge = smoothstep(0.0, 0.25, vUv.x) * smoothstep(1.0, 0.75, vUv.x);
            float streak = 0.65 + 0.35 * sin(vUv.x * 61.0 + sin(vUv.x * 13.0) * 3.0 + vUv.y * 4.0 - uTime * 1.3);
            float a = pow(vUv.y, 1.6) * edge * streak * 0.2;
            gl_FragColor = vec4(vCol * a, 1.0);
          }`,
      }),
    );
    ctx.onUpdate((t) => void (shaftMat.uniforms.uTime.value = t));
    const shafts = new THREE.InstancedMesh(track(new THREE.PlaneGeometry(1, 1)), shaftMat, spill.length);
    spill.forEach((s, i) => {
      obj.position.set(s.x + s.nx * 1.8, s.y - s.h / 2 - L / 2 + 0.5, s.z + s.nz * 1.8);
      obj.rotation.set(0, Math.atan2(s.nx, s.nz), 0);
      obj.scale.set(s.w * 1.15, L, 1);
      obj.updateMatrix();
      shafts.setMatrixAt(i, obj.matrix);
      shafts.setColorAt(i, col.set(s.colA));
    });
    shafts.computeBoundingSphere();
    shafts.renderOrder = 3;
    group.add(shafts);
  }

  // Lantern strings across the streets.
  const strings = layoutLanternStrings(plan.towers, Math.round(preset.signs / 10), ctx.seed);
  const pts = strings.flatMap((s) => s.pts.map((p) => ({ p, c: s.color })));
  if (pts.length) {
    const rnd = stream(ctx.seed, 33);
    const color = new Float32Array(pts.length * 3), params = new Float32Array(pts.length * 4);
    pts.forEach((q, i) => {
      color.set(q.c === 0 ? [3.4, 0.55, 0.3] : [3, 1.7, 0.4], i * 3);
      params.set([0.45, rnd() < 0.05 ? 3 : 0, rnd(), 0.7], i * 4);
    });
    const g = makeGlow(ctx, { count: pts.length, color, params, minPx: 1.2 });
    pts.forEach((q, i) => g.pos.set(q.p, i * 3));
    g.markDirty();
  }
  ctx.counts.signs = n;
  ctx.counts.lanternStrings = strings.length;
}
