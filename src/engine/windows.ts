import * as THREE from "three";

/**
 * Tower facade material: a MeshStandardMaterial (lit, shadowed, fogged) whose emissive term is a
 * procedural window grid in world units, so floors line up across tiers and towers:
 * - per-building occupancy and palette, per-floor variation (dark floors, fully lit office floors),
 *   per-room colour and brightness,
 * - a fake interior: the back wall of each room is offset by the view direction (parallax), with
 *   darker side walls and a ceiling-light gradient,
 * - a few flickering rooms (a pure function of uTime),
 * - when cells shrink below a couple of pixels, a fade to the average glow to avoid shimmer.
 *
 * Instances carry `aWin` = (seed, palette 0..3, occupancy, style). Roofs (|normal.y| > 0.5) stay dark.
 */
export function makeWindowMaterial(round: boolean, uTime: { value: number }, gain: number): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({ color: 0x15141f, metalness: 0.55, roughness: 0.42 });
  // Both variants share onBeforeCompile source text; without a key three.js would reuse one program.
  mat.customProgramCacheKey = () => (round ? "ogb-windows-round" : "ogb-windows-box");
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = uTime;
    shader.uniforms.uGain = { value: gain };
    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        `#include <common>
        attribute vec4 aWin;
        varying vec2 vFac;
        // flat: hashing an interpolated per-instance value turns its last-bit rounding noise
        // into per-pixel random rooms.
        flat varying vec4 vWin;
        varying vec3 vWP;
        varying vec3 vWN;
        varying float vRoof;`,
      )
      .replace(
        "#include <project_vertex>",
        `#include <project_vertex>
        {
          vec4 wp = vec4(transformed, 1.0);
          vec3 wn = objectNormal;
          vec3 isc = vec3(1.0);
          #ifdef USE_INSTANCING
            wp = instanceMatrix * wp;
            wn = mat3(instanceMatrix) * wn;
            isc = vec3(length(instanceMatrix[0].xyz), length(instanceMatrix[1].xyz), length(instanceMatrix[2].xyz));
          #endif
          wp = modelMatrix * wp;
          vWP = wp.xyz;
          vWN = normalize(mat3(modelMatrix) * wn);
          vRoof = abs(objectNormal.y) > 0.5 ? 1.0 : 0.0;
          ${round ? "float u = uv.x * 3.14159 * isc.x;" : "float u = uv.x * (abs(objectNormal.x) > 0.5 ? isc.z : isc.x);"}
          vFac = vec2(u, vWP.y);
          vWin = aWin;
        }`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
        uniform float uTime;
        uniform float uGain;
        varying vec2 vFac;
        flat varying vec4 vWin;
        varying vec3 vWP;
        varying vec3 vWN;
        varying float vRoof;
        float h21(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
        vec3 winColor(float pal, float r) {
          vec3 warm = mix(vec3(1.0, 0.62, 0.28), vec3(1.0, 0.86, 0.6), r);
          vec3 cool = mix(vec3(0.35, 0.8, 1.0), vec3(0.78, 0.94, 1.0), r);
          vec3 mag = mix(vec3(1.0, 0.38, 0.82), vec3(0.7, 0.48, 1.0), r);
          if (pal < 0.5) return warm;
          if (pal < 1.5) return cool;
          if (pal < 2.5) return r < 0.6 ? warm : mag;
          return r < 0.4 ? cool : (r < 0.75 ? warm : mag);
        }`,
      )
      .replace(
        "#include <emissivemap_fragment>",
        `#include <emissivemap_fragment>
        if (vRoof < 0.5) {
          float seed = vWin.x;
          vec2 cell = vWin.w > 0.5 ? vec2(2.6, 3.4) : vec2(1.7, 3.4);
          vec2 f = vFac / cell + vec2(seed * 17.0, 0.0);
          vec2 id = floor(f);
          vec2 g = fract(f);
          float fr = h21(vec2(id.y, seed * 31.7));
          float rr = h21(id + seed * 13.1);
          float occ = vWin.z;
          float lit = step(rr, occ) * step(0.16, fr);
          if (fr > 0.93) lit = 1.0;
          float fh = h21(id * 1.7 + seed);
          if (fh > 0.986) lit *= step(0.35, h21(vec2(floor(uTime * (5.0 + fh * 9.0)), fh * 100.0)));
          vec2 wmin = vWin.w > 0.5 ? vec2(0.06, 0.3) : vec2(0.2, 0.28);
          vec2 wmax = vWin.w > 0.5 ? vec2(0.94, 0.74) : vec2(0.8, 0.76);
          vec2 fw = max(fwidth(f), vec2(1e-4));
          vec2 w2 = smoothstep(wmin - fw, wmin + fw, g) * (1.0 - smoothstep(wmax - fw, wmax + fw, g));
          float inside = w2.x * w2.y;
          // Interior hint: the room's back wall shifts with the view direction (parallax).
          vec3 n = vec3(vWN.x, 0.0, vWN.z);
          float nl = length(n);
          n = nl > 1e-4 ? n / nl : vec3(0.0, 0.0, 1.0);
          vec3 tng = vec3(-n.z, 0.0, n.x);
          vec3 V = vWP - cameraPosition;
          float vl = length(V);
          V = vl > 1e-4 ? V / vl : vec3(0.0, 0.0, -1.0);
          float vz = max(0.25, abs(dot(V, n)));
          vec2 rg = (g - wmin) / (wmax - wmin);
          vec2 back = rg + vec2(dot(V, tng), V.y) / vz * 0.22;
          float onBack = step(0.0, back.x) * step(back.x, 1.0) * step(0.0, back.y) * step(back.y, 1.0);
          float ceil = clamp(back.y, 0.0, 1.0);
          float shade = mix(0.68, 1.0, onBack) * (0.6 + 0.55 * ceil * ceil);
          vec3 wc = winColor(vWin.y, h21(id + 7.7));
          float bright = (0.75 + 1.25 * h21(id + 3.3)) * (fr > 0.93 ? 1.25 : 1.0);
          vec3 em = wc * bright * lit * inside * shade;
          // Sub-pixel windows: fade to the facade's average glow instead of aliasing.
          float far = smoothstep(0.28, 0.85, max(fw.x, fw.y));
          vec3 avg = winColor(vWin.y, 0.5) * occ * 0.84 * (wmax.x - wmin.x) * (wmax.y - wmin.y) * 1.25;
          totalEmissiveRadiance = mix(em, avg, far) * uGain;
        }`,
      );
  };
  return mat;
}
