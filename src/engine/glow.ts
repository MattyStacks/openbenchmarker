import * as THREE from "three";
import type { BuildCtx } from "./ctx";

/**
 * Instanced glowing light sprites: camera-facing quads with a soft radial core, additive. Used for
 * nav lights, far drone swarms, vehicle lights, beacons and lanterns. Sizes are in world units,
 * with a minimum on-screen size: a light smaller than `minPx` is drawn at minPx and dimmed to keep
 * its energy, so distant lights stay as crisp specks instead of shimmering away.
 *
 * Two motion modes:
 * - static/CPU: positions in `pos` (call `markDirty()` after writing),
 * - orbit: positions computed in the vertex shader from per-light orbit parameters and uTime
 *   (zero CPU cost per frame; used for the far swarm).
 */
export interface Glow {
  mesh: THREE.Mesh;
  /** x, y, z per light (static/CPU mode). */
  pos: Float32Array;
  markDirty(): void;
}

export interface GlowSpec {
  count: number;
  /** r, g, b per light (linear, may exceed 1 for bloom). */
  color: Float32Array;
  /** size (world), blink rate (Hz, 0 = steady), blink phase (0..1), duty (lit fraction). */
  params: Float32Array;
  /** Orbit mode: cx, cz, radius, angular speed (rad/s) per light. */
  orbitA?: Float32Array;
  /** Orbit mode: altitude, bob amplitude, phase (rad), bob rate (rad/s) per light. */
  orbitB?: Float32Array;
  /** Minimum on-screen size in pixels. */
  minPx?: number;
  renderOrder?: number;
}

export function makeGlow(ctx: BuildCtx, spec: GlowSpec): Glow {
  const { count } = spec;
  const geo = ctx.track(new THREE.InstancedBufferGeometry());
  geo.setAttribute("position", new THREE.Float32BufferAttribute([-1, -1, 0, 1, -1, 0, -1, 1, 0, 1, 1, 0], 3));
  geo.setIndex([0, 1, 2, 2, 1, 3]);
  const orbit = !!(spec.orbitA && spec.orbitB);
  const pos = new Float32Array(orbit ? 3 : count * 3);
  const posAttr = new THREE.InstancedBufferAttribute(pos, 3);
  posAttr.setUsage(THREE.DynamicDrawUsage);
  if (!orbit) geo.setAttribute("aPos", posAttr);
  else {
    geo.setAttribute("aOrbitA", new THREE.InstancedBufferAttribute(spec.orbitA!, 4));
    geo.setAttribute("aOrbitB", new THREE.InstancedBufferAttribute(spec.orbitB!, 4));
  }
  geo.setAttribute("aColor", new THREE.InstancedBufferAttribute(spec.color, 3));
  geo.setAttribute("aParams", new THREE.InstancedBufferAttribute(spec.params, 4));
  geo.instanceCount = count;

  const mat = ctx.track(
    new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      defines: orbit ? { ORBIT: 1 } : {},
      uniforms: {
        uTime: { value: 0 },
        uFocal: { value: 600 },
        uMinPx: { value: spec.minPx ?? 1.6 },
        uHalfRes: { value: new THREE.Vector2(ctx.size.w / 2, ctx.size.h / 2) },
      },
      vertexShader: /* glsl */ `
        #ifdef ORBIT
          attribute vec4 aOrbitA, aOrbitB;
        #else
          attribute vec3 aPos;
        #endif
        attribute vec3 aColor;
        attribute vec4 aParams;
        uniform float uTime, uFocal, uMinPx;
        uniform vec2 uHalfRes;
        varying vec2 vUv;
        varying vec3 vCol;
        void main() {
          #ifdef ORBIT
            float ang = aOrbitB.z + aOrbitA.w * uTime;
            vec3 wp = vec3(aOrbitA.x + cos(ang) * aOrbitA.z, aOrbitB.x + sin(uTime * aOrbitB.w + aOrbitB.z) * aOrbitB.y, aOrbitA.y + sin(ang) * aOrbitA.z);
          #else
            vec3 wp = aPos;
          #endif
          vec4 mv = viewMatrix * vec4(wp, 1.0);
          float depth = -mv.z;
          if (depth < 0.3) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
          float size = aParams.x;
          float px = size * uFocal / depth;
          float k = max(1.0, uMinPx / max(px, 1e-4));
          float on = 1.0;
          if (aParams.y > 0.0) on = fract(uTime * aParams.y + aParams.z) < aParams.w ? 1.0 : 0.06;
          vCol = aColor * on / (k * k);
          vUv = position.xy;
          vec4 clip = projectionMatrix * mv;
          // Expand in screen space so the sprite is round and its pixel size exact.
          float rpx = px * k;
          clip.xy += position.xy * rpx / uHalfRes * clip.w;
          gl_Position = clip;
        }`,
      fragmentShader: /* glsl */ `
        varying vec2 vUv;
        varying vec3 vCol;
        void main() {
          float r2 = dot(vUv, vUv);
          if (r2 > 1.0) discard;
          float core = exp(-r2 * 6.0) + 0.25 * (1.0 - r2);
          gl_FragColor = vec4(vCol * core, 1.0);
        }`,
    }),
  );
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = spec.renderOrder ?? 4;
  ctx.group.add(mesh);
  ctx.onUpdate((t, cam) => {
    mat.uniforms.uTime.value = t;
    const pc = cam as THREE.PerspectiveCamera;
    mat.uniforms.uFocal.value = (ctx.size.h * 0.5) / Math.tan(THREE.MathUtils.degToRad(pc.fov * 0.5));
  });
  return {
    mesh,
    pos,
    markDirty: () => void (posAttr.needsUpdate = true),
  };
}
