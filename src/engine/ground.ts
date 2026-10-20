import * as THREE from "three";
import { BLOCK, CITY_HALF } from "./world";

/** Curb line: this far from a street centre line (the roadway is 2x this wide). */
const CURB = 7.5;
/** Corner radius of each block at the curb, so streets flow into each other at junctions. */
const CORNER = 7;

/**
 * The street-level ground: one plane whose MeshStandardMaterial is patched to draw the street
 * grid procedurally from world x/z (no textures, no extra draw calls), on the same grid the
 * towers use (street centre lines every BLOCK units).
 *
 * Each block is a rounded rectangle at the curb, so the curb, its glow strip, the sidewalk and
 * the road edge line run continuously around every corner from one street into the next. On the
 * road: wet asphalt with wear and puddles, an amber double centre line and lane dashes at the
 * traffic lanes (stopping at the stop bar), softly pulsing crosswalks at each junction mouth,
 * dotted guide lines carrying the centre lines across the junction, coloured light spilling from
 * the curbs, glowing drain grates; on the sidewalks, paving and small amber floor lights.
 * Everything fades to its average when sub-pixel and is a function of position and uTime only.
 */
export function makeGroundMaterial(reflective: boolean, uTime: { value: number }): THREE.MeshStandardMaterial {
  const opacity = reflective ? 0.55 : 1;
  const mat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.5,
    metalness: 0.45,
    transparent: reflective,
    opacity,
  });
  const B = BLOCK.toFixed(1), H = (BLOCK / 2).toFixed(1);
  mat.customProgramCacheKey = () => `ogb-ground-${reflective ? "r" : "o"}`;
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = uTime;
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vGW;")
      .replace("#include <project_vertex>", "#include <project_vertex>\nvGW = (modelMatrix * vec4(transformed, 1.0)).xyz;");
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        /* glsl */ `#include <common>
        uniform float uTime;
        varying vec3 vGW;
        float gh11(float p) { p = fract(p * 0.1031); p *= p + 33.33; p *= p + p; return fract(p); }
        float gh21(vec2 p) { p = mod(p, 4096.0); p = fract(p * vec2(0.1031, 0.1030)); p += dot(p, p.yx + 33.33); return fract((p.x + p.y) * p.x); }
        float gnoise(vec2 p) {
          vec2 i = floor(p), f = fract(p);
          vec2 u = f * f * (3.0 - 2.0 * f);
          return mix(mix(gh21(i), gh21(i + vec2(1, 0)), u.x), mix(gh21(i + vec2(0, 1)), gh21(i + vec2(1, 1)), u.x), u.y);
        }
        float gfbm(vec2 p) { return 0.55 * gnoise(p) + 0.3 * gnoise(p * 2.1 + 3.7) + 0.15 * gnoise(p * 4.3 + 9.1); }
        // Box-filtered band |x - c| < w/2: sharp up close, fades to its average when sub-pixel.
        float band(float x, float c, float w, float fw) {
          fw = max(fw, 1e-4);
          return clamp((w * 0.5 - abs(x - c)) / fw + 0.5, 0.0, 1.0) * min(1.0, w / fw);
        }
        // Box-filtered repeating pulse: on for fract(x) < duty (x and fw in periods). Repeating
        // marks (dashes, stripes, seams, dots) must use this: an unfiltered step aliases into
        // flashing in the distance, which bloom then amplifies.
        float pulseI(float x, float duty) { return floor(x) * duty + min(fract(x), duty); }
        float pulse(float x, float duty, float fw) {
          fw = max(fw, 1e-4);
          return (pulseI(x + 0.5 * fw, duty) - pulseI(x - 0.5 * fw, duty)) / fw;
        }
        // Filtered single edge: 0 below e, 1 above.
        float edgeAA(float x, float e, float fw) { return clamp((x - e) / max(fw, 1e-4) + 0.5, 0.0, 1.0); }
        vec3 neon(float k) {
          k = floor(k * 4.0);
          if (k < 1.0) return vec3(1.0, 0.24, 0.86);
          if (k < 2.0) return vec3(0.18, 0.91, 1.0);
          if (k < 3.0) return vec3(0.61, 0.42, 1.0);
          return vec3(1.0, 0.7, 0.25);
        }
        // Rounded-rectangle signed distance (negative inside).
        float sdRound(vec2 p, vec2 b, float r) {
          vec2 q = abs(p) - b + r;
          return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
        }
        // Lane paint on one street. d: signed distance across its centre line; a: along it;
        // c: signed distance to the nearest cross-street centre line; id: street index.
        void lanePaint(float d, float a, float c, float id, float fwd, float fwa, inout vec3 alb, inout vec3 em, inout float paint) {
          float ad = abs(d), ac = abs(c);
          if (ad > ${CURB.toFixed(1)}) return;
          vec3 colA = neon(gh11(id * 3.17 + 0.5));
          // Lines run between junctions and stop at the stop bar.
          float run = edgeAA(ac, 13.6, fwa);
          float centre = band(d, 0.28, 0.14, fwd) + band(d, -0.28, 0.14, fwd);
          float dash = band(ad, 3.75, 0.16, fwd) * pulse(a / 6.0, 0.5, fwa / 6.0);
          em += (vec3(1.0, 0.62, 0.18) * centre * 0.75 + colA * dash * 1.3) * run;
          paint += (centre + dash) * run;
          // Crosswalk across the street at the junction mouth, softly pulsing; then the stop bar
          // across the incoming half.
          float cw = band(ac, 10.7, 3.0, fwa) * (1.0 - edgeAA(ad, ${(CURB - 0.6).toFixed(1)}, fwd));
          float stripe = pulse(d / 1.25 - 0.225, 0.55, fwd / 1.25);
          float throb = 0.7 + 0.3 * sin(uTime * 1.6 + id * 1.7 + floor(a / ${B}) * 2.3);
          em += mix(vec3(0.3, 0.85, 1.0), vec3(0.65, 0.45, 1.0), gh11(id + floor(a / ${B}))) * cw * stripe * 0.55 * throb;
          alb += vec3(0.05) * cw * stripe;
          paint += cw * stripe;
          float stop = band(ac, 13.0, 0.45, fwa) * (1.0 - edgeAA(ad, ${(CURB - 0.6).toFixed(1)}, fwd)) * edgeAA(d * sign(c), 0.0, fwd);
          em += vec3(0.9, 0.95, 1.0) * stop * 0.5;
          paint += stop;
          // Dotted guide lines carrying the centre line across the junction.
          float guide = band(d, 0.0, 0.16, fwd) * (1.0 - edgeAA(ac, 9.0, fwa)) * pulse(a / 2.0, 0.45, fwa / 2.0);
          em += vec3(1.0, 0.62, 0.18) * guide * 0.35;
          // Glowing drain grates now and then near the curbs, between junctions.
          float cell = floor(a / 28.0);
          if (run > 0.5 && gh11(cell * 1.9 + id * 5.3) > 0.55) {
            vec2 q = vec2(ad - 6.2, a - (cell + 0.5) * 28.0);
            float g = band(q.x, 0.0, 0.9, fwd) * band(q.y, 0.0, 1.8, fwa);
            alb = mix(alb, vec3(0.01), g);
            em += vec3(0.2, 0.75, 1.0) * g * pulse(q.y * 2.5, 0.5, fwa * 2.5) * 0.35;
          }
        }`,
      )
      .replace(
        "#include <color_fragment>",
        /* glsl */ `#include <color_fragment>
        vec2 gp = vGW.xz;
        vec2 gfw = fwidth(gp);
        float gfs = max(gfw.x, gfw.y);
        // Nearest street centre lines, and this block's centre (blocks sit between them).
        float dx = gp.x - floor(gp.x / ${B} + 0.5) * ${B};
        float dz = gp.y - floor(gp.y / ${B} + 0.5) * ${B};
        float idx = floor(gp.x / ${B} + 0.5), idz = floor(gp.y / ${B} + 0.5);
        vec2 bid = floor(gp / ${B});
        vec2 bl = gp - (bid * ${B} + ${H});
        // Distance outside this block's rounded curb line: > 0 on the road, < 0 on the curb/sidewalk.
        float sd = sdRound(bl, vec2(${(BLOCK / 2 - CURB).toFixed(1)}), ${CORNER.toFixed(1)});
        vec3 blockCol = neon(gh21(bid + 0.37));
        float wear = gfbm(gp * 0.09);
        float wet = smoothstep(0.55, 0.72, gfbm(gp * 0.045 + 11.0));
        vec3 gAlb = vec3(0.022, 0.019, 0.03) * (0.75 + 0.5 * wear);
        vec3 gEm = vec3(0.0);
        float gPaint = 0.0;
        if (sd > 0.0) {
          // Road. Lane paint belongs to whichever street we're nearer the middle of.
          if (abs(dx) < abs(dz)) lanePaint(dx, gp.y, dz, idx, gfw.x, gfw.y, gAlb, gEm, gPaint);
          else lanePaint(dz, gp.x, dx, idz + 101.0, gfw.y, gfw.x, gAlb, gEm, gPaint);
          // Edge strip just off the curb: follows every block's rounded corner, so the edges of
          // crossing streets join up through each junction.
          float edge = band(sd, 0.5, 0.2, gfs);
          gEm += blockCol * edge * 0.9;
          gPaint += edge;
          // Coloured light spilling from the curb onto the wet road.
          gEm += blockCol * exp(-sd * 0.45) * 0.07;
          // A faint violet guide grid over the junction core.
          if (abs(dx) < ${CURB.toFixed(1)} && abs(dz) < ${CURB.toFixed(1)}) {
            vec2 jg = gp / 3.0 + 0.02;
            gEm += vec3(0.45, 0.25, 1.0) * max(pulse(jg.x, 0.04, gfw.x / 3.0), pulse(jg.y, 0.04, gfw.y / 3.0)) * 0.08;
          }
        } else if (sd > -0.6) {
          // Curb: concrete with a neon strip on its top edge, round every corner.
          gAlb = vec3(0.07, 0.065, 0.085);
          gEm += blockCol * band(sd, -0.15, 0.12, gfs) * 1.2;
          gPaint = 1.0;
        } else if (sd > -4.5) {
          // Sidewalk: paving slabs, with amber floor lights a step in from the curb.
          vec2 s = gp / 2.0;
          float seam = max(pulse(s.x + 0.03, 0.06, gfw.x / 2.0), pulse(s.y + 0.03, 0.06, gfw.y / 2.0));
          gAlb = mix(vec3(0.04, 0.036, 0.052), vec3(0.015, 0.012, 0.02), seam);
          float along = abs(bl.x) > abs(bl.y) ? gp.y : gp.x;
          float lamp = band(sd, -1.05, 0.25, gfs) * pulse(along / 8.0 - 0.485, 0.03, gfs / 8.0);
          gEm += vec3(1.0, 0.62, 0.22) * lamp * 1.6;
          gPaint = 0.6;
        } else {
          // Block interiors (plazas between towers): dark tiles with the odd lit circuit seam.
          vec2 t = gp / 4.0;
          float seam = max(pulse(t.x + 0.025, 0.05, gfw.x / 4.0), pulse(t.y + 0.025, 0.05, gfw.y / 4.0));
          gAlb = mix(vec3(0.03, 0.026, 0.04), vec3(0.012), seam);
          // The odd lit seam; faded out where tiles get smaller than a few pixels.
          gEm += vec3(0.4, 0.2, 0.9) * seam * step(0.96, gh21(floor(gp / 4.0))) * 0.12 * (1.0 - smoothstep(0.1, 0.4, gfs / 4.0));
          gPaint = 0.6;
        }
        // Beyond the city: plain asphalt (the skyline rings stand there).
        float city = 1.0 - smoothstep(${CITY_HALF.toFixed(1)}, ${(CITY_HALF + 220).toFixed(1)}, max(abs(gp.x), abs(gp.y)));
        gEm *= city;
        gPaint = clamp(gPaint, 0.0, 1.0) * city;
        gAlb *= mix(1.0, 0.55, wet);
        gEm *= 1.0 + wet * 0.6;
        diffuseColor.rgb = gAlb;
        diffuseColor.a = mix(${opacity.toFixed(2)}, 1.0, gPaint);`,
      )
      .replace(
        "#include <roughnessmap_fragment>",
        `#include <roughnessmap_fragment>
        roughnessFactor = mix(0.55 - 0.15 * wear, 0.07, wet);`,
      )
      .replace("#include <emissivemap_fragment>", "#include <emissivemap_fragment>\ntotalEmissiveRadiance += gEm;");
  };
  return mat;
}
