import * as THREE from "three";
import type { BuildCtx } from "../ctx";
import { stream } from "../rng";

/** Rain as GPU points wrapped around the camera (v1; replaced by streaks). */
export function buildRain(ctx: BuildCtx): void {
  const { group, track, preset } = ctx;
  const rnd = stream(ctx.seed, 4);
  const RAIN_BOX = new THREE.Vector3(220, 140, 220);
  const rainPos = new Float32Array(preset.rain * 3);
  for (let i = 0; i < preset.rain; i++) {
    rainPos[i * 3] = rnd() * RAIN_BOX.x;
    rainPos[i * 3 + 1] = rnd() * RAIN_BOX.y;
    rainPos[i * 3 + 2] = rnd() * RAIN_BOX.z;
  }
  const geo = track(new THREE.BufferGeometry());
  geo.setAttribute("position", new THREE.BufferAttribute(rainPos, 3));
  const mat = track(
    new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: { uTime: { value: 0 }, uCam: { value: new THREE.Vector3() }, uBox: { value: RAIN_BOX } },
      vertexShader: `uniform float uTime; uniform vec3 uCam; uniform vec3 uBox; varying float vFade;
        void main(){
          vec3 p = position;
          p.y = mod(p.y - uTime * 95.0, uBox.y);
          p.x = mod(p.x + uTime * 6.0 - uCam.x, uBox.x) - uBox.x * 0.5 + uCam.x;
          p.z = mod(p.z - uCam.z, uBox.z) - uBox.z * 0.5 + uCam.z;
          p.y += uCam.y - uBox.y * 0.5;
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          gl_PointSize = clamp(600.0 / -mv.z, 1.0, 48.0);
          vFade = clamp(1.0 - (-mv.z) / (uBox.x * 0.5), 0.0, 1.0);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: `varying float vFade; void main(){
          vec2 c = gl_PointCoord - 0.5;
          float streak = smoothstep(0.06, 0.0, abs(c.x)) * (1.0 - smoothstep(0.2, 0.5, abs(c.y)));
          if (streak < 0.01) discard;
          gl_FragColor = vec4(vec3(0.55, 0.7, 1.0) * streak * vFade * 0.9, 1.0);
        }`,
    }),
  );
  const rain = new THREE.Points(geo, mat);
  rain.frustumCulled = false;
  group.add(rain);
  ctx.onUpdate((t, cam) => {
    mat.uniforms.uTime.value = t;
    mat.uniforms.uCam.value.copy(cam.position);
  });
  ctx.counts.rain = preset.rain;
}
