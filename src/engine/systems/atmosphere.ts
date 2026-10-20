import * as THREE from "three";
import type { BuildCtx } from "../ctx";

const NOISE = /* glsl */ `
  float h11(float p) { p = fract(p * 0.1031); p *= p + 33.33; p *= p + p; return fract(p); }
  float h21(vec2 p) { p = mod(p, 4096.0); p = fract(p * vec2(0.1031, 0.1030)); p += dot(p, p.yx + 33.33); return fract((p.x + p.y) * p.x); }
  float noise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(h21(i), h21(i + vec2(1, 0)), u.x), mix(h21(i + vec2(0, 1)), h21(i + vec2(1, 1)), u.x), u.y);
  }
  float fbm(vec2 p) { float s = 0.0, a = 0.5; for (int i = 0; i < 5; i++) { s += a * noise(p); p = p * 2.03 + 7.1; a *= 0.5; } return s; }`;

/** Ring radius, height and column width per skyline layer (nearest first). */
const RINGS = [
  { r: 1600, h: 300, col: 24 },
  { r: 2150, h: 380, col: 30 },
  { r: 2750, h: 460, col: 36 },
  { r: 3350, h: 540, col: 44 },
];

/**
 * Far skyline: up to four open cylinders around the city whose fragment shader draws a seeded
 * silhouette (towers, gaps, spires) with window dots and the odd neon sign, fading into violet
 * haze layer by layer: the city goes all the way to the horizon for the cost of a few big quads.
 *
 * Low clouds: horizontal fbm layers above the flight (240-380), lit from below by the city
 * (magenta/amber, brightest over the centre), drifting with t.
 */
export function buildAtmosphere(ctx: BuildCtx): void {
  const { group, track, preset } = ctx;
  for (let i = 0; i < Math.min(preset.skylineLayers, RINGS.length); i++) {
    const R = RINGS[i];
    // Starts at ground level: nothing may sit below the street plane on Ultra+ (the mirror
    // there doesn't write depth, so anything underneath would show through the street).
    const geo = track(new THREE.CylinderGeometry(R.r, R.r, R.h + 20, 192, 1, true).translate(0, (R.h + 20) / 2, 0));
    const mat = track(
      new THREE.ShaderMaterial({
        side: THREE.BackSide,
        uniforms: { uLayer: { value: i }, uH: { value: R.h }, uR: { value: R.r }, uCol: { value: R.col }, uTime: { value: 0 } },
        vertexShader: /* glsl */ `
          varying vec3 vWP;
          void main() { vWP = (modelMatrix * vec4(position, 1.0)).xyz; gl_Position = projectionMatrix * viewMatrix * vec4(vWP, 1.0); }`,
        fragmentShader: /* glsl */ `
          uniform float uLayer, uH, uR, uCol, uTime;
          varying vec3 vWP;
          ${NOISE}
          void main() {
            float u = (atan(vWP.z, vWP.x) + 3.14159265) * uR;
            float id = floor(u / uCol);
            float fu = fract(u / uCol);
            float r1 = h11(id * 1.37 + uLayer * 131.0), r2 = h11(id * 2.71 + uLayer * 17.0);
            float hgt = uH * (0.22 + 0.78 * pow(r1, 1.7));
            if (r2 > 0.9 && abs(fu - 0.5) < 0.05) hgt += uH * 0.35 * (r2 - 0.9) * 10.0;
            if (vWP.y > hgt || fu > (r2 < 0.25 ? 0.7 : 0.93)) discard;
            vec2 wc = vec2(u, vWP.y) / vec2(3.0, 4.0);
            vec2 wi = floor(wc), wf = fract(wc);
            float lit = step(0.6 + 0.3 * r1, h21(wi + uLayer * 7.0)) * step(0.25, wf.x) * step(wf.x, 0.75) * step(0.3, wf.y) * step(wf.y, 0.7);
            vec2 fw = fwidth(wc);
            float avg = (1.0 - (0.6 + 0.3 * r1)) * 0.2;
            lit = mix(lit, avg, smoothstep(0.3, 0.9, max(fw.x, fw.y)));
            vec3 wcol = mix(vec3(1.0, 0.66, 0.35), vec3(0.55, 0.85, 1.0), h21(wi * 1.31));
            vec3 col = vec3(0.02, 0.014, 0.045) + wcol * lit * 1.3;
            // A neon sign on some towers.
            float sy = hgt * (0.35 + 0.4 * r2);
            if (r2 < 0.35 && abs(fu - 0.45) < 0.18 && abs(vWP.y - sy) < uCol * 0.22)
              col += mix(vec3(1.0, 0.2, 0.8), vec3(0.2, 0.9, 1.0), step(0.17, r2)) * 1.4;
            // Atmospheric perspective: each layer further into the violet haze, glowing near the street.
            vec3 haze = vec3(0.28, 0.09, 0.31) * (1.0 + 0.9 * exp(-max(vWP.y, 0.0) * 0.018));
            col = mix(col, haze, clamp(0.3 + 0.16 * uLayer + 0.25 * exp(-max(vWP.y, 0.0) * 0.02), 0.0, 0.92));
            gl_FragColor = vec4(col, 1.0);
          }`,
      }),
    );
    const ring = new THREE.Mesh(geo, mat);
    ring.renderOrder = -5;
    group.add(ring);
  }

  for (let i = 0; i < preset.cloudLayers; i++) {
    const y = 240 + i * 65;
    const mat = track(
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        uniforms: { uTime: { value: 0 }, uLayer: { value: i } },
        vertexShader: /* glsl */ `
          varying vec3 vWP;
          void main() { vWP = (modelMatrix * vec4(position, 1.0)).xyz; gl_Position = projectionMatrix * viewMatrix * vec4(vWP, 1.0); }`,
        fragmentShader: /* glsl */ `
          uniform float uTime, uLayer;
          varying vec3 vWP;
          ${NOISE}
          void main() {
            vec2 p = vWP.xz * (0.0019 + uLayer * 0.0005) + vec2(uTime * (0.012 + uLayer * 0.006), uTime * 0.004) + uLayer * 3.7;
            float n = fbm(p);
            float dens = smoothstep(0.44, 0.82, n);
            float city = exp(-length(vWP.xz) / 1300.0);
            vec3 glow = mix(vec3(0.75, 0.16, 0.6), vec3(0.85, 0.42, 0.16), smoothstep(0.35, 0.65, fbm(p * 0.33 + 5.0)));
            vec3 col = mix(vec3(0.035, 0.022, 0.08), glow, 0.18 + 0.5 * city) * (0.55 + 0.7 * (1.0 - dens));
            float dist = length(vWP - cameraPosition);
            float a = dens * (1.0 - smoothstep(1400.0, 3600.0, dist)) * (0.62 - uLayer * 0.1);
            gl_FragColor = vec4(col, a);
          }`,
      }),
    );
    const plane = new THREE.Mesh(track(new THREE.PlaneGeometry(8000, 8000).rotateX(-Math.PI / 2)), mat);
    plane.position.y = y;
    plane.renderOrder = -4;
    group.add(plane);
    ctx.onUpdate((t) => void (mat.uniforms.uTime.value = t));
  }
  ctx.counts.skylineLayers = Math.min(preset.skylineLayers, RINGS.length);
  ctx.counts.cloudLayers = preset.cloudLayers;
}
