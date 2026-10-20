import * as THREE from "three";
import type { BuildCtx } from "../ctx";
import { stream } from "../rng";
import { FLIGHT } from "../world";

const MAX_LIGHTS = 8;
/** Rain volume around the camera (world units); drops wrap inside it. */
const BOX = new THREE.Vector3(180, 120, 180);

/**
 * Rain as thin, velocity-stretched streaks. Each drop is one instanced quad built in screen space
 * between the drop and where it was ~1/36 s earlier relative to the camera, so streak length
 * follows fall speed plus the camera's own motion. Width is the drop's true pixel width, never
 * under 1 px; thinner-than-a-pixel drops fade instead of fattening. Drops pick up colour from the
 * nearest neon lights.
 */
export function buildRain(ctx: BuildCtx): void {
  const { group, track, preset } = ctx;
  const rnd = stream(ctx.seed, 4);
  const n = preset.rain;

  const geo = track(new THREE.InstancedBufferGeometry());
  // corner.x: 0 = head (current position), 1 = tail; corner.y: side -1 / +1.
  geo.setAttribute("corner", new THREE.Float32BufferAttribute([0, -1, 0, 1, 1, -1, 1, 1], 2));
  geo.setAttribute("position", new THREE.Float32BufferAttribute(new Float32Array(12), 3)); // unused, required
  geo.setIndex([0, 2, 1, 1, 2, 3]);
  const drops = new Float32Array(n * 4);
  for (let i = 0; i < n * 4; i++) drops[i] = rnd();
  geo.setAttribute("aDrop", new THREE.InstancedBufferAttribute(drops, 4));
  geo.instanceCount = n;

  const lightPos = Array.from({ length: MAX_LIGHTS }, () => new THREE.Vector4(0, -1e4, 0, 1));
  const lightCol = Array.from({ length: MAX_LIGHTS }, () => new THREE.Color(0, 0, 0));
  const mat = track(
    new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uTime: { value: 0 },
        uCam: { value: new THREE.Vector3() },
        uCamVel: { value: new THREE.Vector3() },
        uBox: { value: BOX },
        uRes: { value: new THREE.Vector2(ctx.size.w, ctx.size.h) },
        uFocal: { value: 600 },
        uLightPos: { value: lightPos },
        uLightCol: { value: lightCol },
      },
      vertexShader: /* glsl */ `
        attribute vec2 corner;
        attribute vec4 aDrop;
        uniform float uTime, uFocal;
        uniform vec3 uCam, uCamVel, uBox;
        uniform vec2 uRes;
        uniform vec4 uLightPos[${MAX_LIGHTS}];
        uniform vec3 uLightCol[${MAX_LIGHTS}];
        varying float vSide, vAlong, vAlpha;
        varying vec3 vCol;
        void main() {
          float s = aDrop.w;
          vec3 vel = vec3(9.0, -118.0, 4.0) * (0.82 + 0.36 * s);
          vec3 origin = uCam - uBox * 0.5;
          vec3 p = mod(aDrop.xyz * uBox + vel * uTime - origin, uBox) + origin;
          vec3 d = (vel - uCamVel) * 0.028;
          float L = length(d);
          if (L > 7.0) d *= 7.0 / L;
          vec3 tail = p - d;
          vec4 c0 = viewMatrix * vec4(p, 1.0);
          vec4 c1 = viewMatrix * vec4(tail, 1.0);
          float z0 = -c0.z, z1 = -c1.z;
          if (min(z0, z1) < 0.8) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
          vec4 h0 = projectionMatrix * c0, h1 = projectionMatrix * c1;
          vec2 half_ = uRes * 0.5;
          vec2 s0 = h0.xy / h0.w * half_, s1 = h1.xy / h1.w * half_;
          vec2 dir = s1 - s0;
          float lp = length(dir);
          dir = lp > 1e-3 ? dir / lp : vec2(0.0, 1.0);
          vec2 nrm = vec2(-dir.y, dir.x);
          float depth = mix(z0, z1, corner.x);
          float px = 0.03 * uFocal / depth;
          float w = max(px, 1.0) * 0.5 + 0.6;
          vec4 h = corner.x < 0.5 ? h0 : h1;
          vec2 sp = (corner.x < 0.5 ? s0 : s1) + nrm * corner.y * w;
          gl_Position = vec4(sp / half_ * h.w, h.z, h.w);
          vSide = corner.y;
          vAlong = corner.x;
          float far = 1.0 - smoothstep(0.45, 1.0, depth / (uBox.x * 0.5));
          vAlpha = 0.34 * pow(clamp(px, 0.0, 1.0), 0.6) * far;
          vec3 lit = vec3(0.30, 0.36, 0.55);
          for (int i = 0; i < ${MAX_LIGHTS}; i++) {
            vec3 dl = p - uLightPos[i].xyz;
            float f = clamp(1.0 - length(dl) / uLightPos[i].w, 0.0, 1.0);
            lit += uLightCol[i] * (f * f * 3.0);
          }
          lit += vec3(1.0, 0.42, 0.78) * 0.35 * (1.0 - smoothstep(0.0, 70.0, p.y));
          vCol = lit;
        }`,
      fragmentShader: /* glsl */ `
        varying float vSide, vAlong, vAlpha;
        varying vec3 vCol;
        void main() {
          float a = vAlpha * (1.0 - smoothstep(0.25, 1.0, abs(vSide))) * mix(1.0, 0.2, vAlong);
          gl_FragColor = vec4(vCol * a, 1.0);
        }`,
    }),
  );
  const rain = new THREE.Mesh(geo, mat);
  rain.frustumCulled = false;
  rain.renderOrder = 5;
  group.add(rain);

  const lights = ctx.lights;
  const near: { i: number; d: number }[] = [];
  const a = new THREE.Vector3(), b = new THREE.Vector3();
  ctx.onUpdate((t, cam) => {
    const u = mat.uniforms;
    u.uTime.value = t;
    u.uCam.value.copy(cam.position);
    // Camera velocity from the flight path itself, so streaks follow the flight at any frame rate.
    FLIGHT.pointAt(t + 0.02, a);
    FLIGHT.pointAt(t - 0.02, b);
    u.uCamVel.value.subVectors(a, b).multiplyScalar(25);
    const pc = cam as THREE.PerspectiveCamera;
    u.uFocal.value = (ctx.size.h * 0.5) / Math.tan(THREE.MathUtils.degToRad(pc.fov * 0.5));
    // The nearest few lights (by distance minus reach) colour the rain this frame.
    near.length = 0;
    const cx = cam.position.x, cy = cam.position.y, cz = cam.position.z;
    for (let i = 0; i < lights.length; i++) {
      const L = lights[i];
      const d = Math.hypot(L.x - cx, L.y - cy, L.z - cz) - L.r;
      if (d > 110) continue;
      if (near.length < MAX_LIGHTS) near.push({ i, d });
      else {
        let worst = 0;
        for (let k = 1; k < MAX_LIGHTS; k++) if (near[k].d > near[worst].d) worst = k;
        if (d < near[worst].d) near[worst] = { i, d };
      }
    }
    for (let k = 0; k < MAX_LIGHTS; k++) {
      const L = k < near.length ? lights[near[k].i] : null;
      if (L) {
        lightPos[k].set(L.x, L.y, L.z, L.r);
        lightCol[k].copy(L.color);
      } else {
        lightPos[k].set(0, -1e4, 0, 1);
        lightCol[k].setRGB(0, 0, 0);
      }
    }
  });
  ctx.counts.rain = n;
}
