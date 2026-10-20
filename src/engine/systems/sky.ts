import * as THREE from "three";
import type { BuildCtx } from "../ctx";
import { makeGroundMaterial } from "../ground";
import { CITY_HALF } from "../world";

/** Overcast night sky dome, lights (the high cool key light casts the shadows), wet ground. */
export function buildSky(ctx: BuildCtx): void {
  const { group, track, preset, shadows } = ctx;
  const skyMat = track(
    new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: { uTime: { value: 0 } },
      vertexShader: /* glsl */ `
        varying vec3 vDir;
        void main() { vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: /* glsl */ `
        uniform float uTime;
        varying vec3 vDir;
        float h21(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
        float noise(vec2 p) {
          vec2 i = floor(p), f = fract(p);
          vec2 u = f * f * (3.0 - 2.0 * f);
          return mix(mix(h21(i), h21(i + vec2(1, 0)), u.x), mix(h21(i + vec2(0, 1)), h21(i + vec2(1, 1)), u.x), u.y);
        }
        float fbm(vec2 p) { float s = 0.0, a = 0.5; for (int i = 0; i < 4; i++) { s += a * noise(p); p *= 2.03; a *= 0.5; } return s; }
        void main() {
          vec3 d = normalize(vDir);
          float h = clamp(d.y, -0.2, 1.0);
          vec3 zen = vec3(0.016, 0.012, 0.05);
          vec3 mid = vec3(0.09, 0.035, 0.19);
          vec3 hor = vec3(0.36, 0.11, 0.36);
          vec3 c = mix(hor, mid, smoothstep(0.0, 0.16, h));
          c = mix(c, zen, smoothstep(0.16, 0.7, h));
          // Overcast: drifting cloud mass, lit from below by the city (pink/amber near the horizon).
          vec2 uv = d.xz / max(0.08, d.y + 0.12) * 1.2 + vec2(uTime * 0.004, uTime * 0.0015);
          float cl = smoothstep(0.35, 0.85, fbm(uv));
          vec3 lit = mix(vec3(0.42, 0.14, 0.38), vec3(0.16, 0.07, 0.24), smoothstep(0.0, 0.5, h));
          c = mix(c, lit, cl * 0.55 * smoothstep(-0.02, 0.06, h));
          gl_FragColor = vec4(c, 1.0);
        }`,
    }),
  );
  const sky = new THREE.Mesh(track(new THREE.SphereGeometry(3000, 48, 24)), skyMat);
  sky.renderOrder = -10;
  sky.frustumCulled = false;
  group.add(sky);
  ctx.onUpdate((t, cam) => {
    sky.position.copy(cam.position);
    skyMat.uniforms.uTime.value = t;
  });

  // Dim, cool ambience with a magenta under-glow from the streets; neon does the rest.
  group.add(new THREE.HemisphereLight(0x5a4fb0, 0x5a1a50, 0.55));
  group.add(new THREE.AmbientLight(0x3a2c6a, 0.3));
  const keyDir = new THREE.Vector3(-0.45, 0.62, -0.64).normalize();
  const key = new THREE.DirectionalLight(0x9a96ff, 0.7);
  key.position.copy(keyDir).multiplyScalar(1400);
  key.target.position.set(0, 0, 0);
  group.add(key, key.target);
  if (shadows) {
    key.castShadow = true;
    key.shadow.mapSize.set(preset.shadowMap, preset.shadowMap);
    const cam = key.shadow.camera;
    cam.left = cam.bottom = -CITY_HALF;
    cam.right = cam.top = CITY_HALF;
    cam.near = 10;
    cam.far = 3200;
    key.shadow.bias = -0.0008;
  }

  // Wet neon streets. With planar reflections (Ultra+) the asphalt is partly see-through to the
  // mirror below; paint, curbs and sidewalks stay opaque.
  const groundTime = { value: 0 };
  ctx.onUpdate((t) => void (groundTime.value = t));
  const groundMat = track(makeGroundMaterial(preset.reflections > 0, groundTime));
  const ground = new THREE.Mesh(track(new THREE.PlaneGeometry(8000, 8000)), groundMat);
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = 0.05;
  ground.receiveShadow = shadows;
  group.add(ground);
}
