import * as THREE from "three";
import { BLOCK, CITY_HALF } from "./world";

/**
 * The street-level ground: one plane whose MeshStandardMaterial is patched to draw the street
 * grid procedurally from world x/z (no textures, no extra draw calls), on the same grid the
 * towers use (street centre lines every BLOCK units, lots from 9 units out):
 * - wet asphalt with wear and puddles (puddles are smoother, so they catch light and reflections),
 * - neon-paint lane markings: an amber double centre line, cyan lane dashes at the traffic lanes,
 *   glowing edge strips, colours varying per street,
 * - softly pulsing holographic crosswalks and stop bars at every intersection, a faint grid over
 *   the junction box,
 * - glowing curb strips outlining each block, coloured light spilling from the curbs onto the
 *   wet road, paved sidewalks with small amber floor lights, glowing drain grates,
 * all faded to its average when sub-pixel (no shimmer) and to plain asphalt beyond the city.
 * Everything is a function of position and uTime only.
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
        vec3 neon(float k) {
          k = floor(k * 4.0);
          if (k < 1.0) return vec3(1.0, 0.24, 0.86);
          if (k < 2.0) return vec3(0.18, 0.91, 1.0);
          if (k < 3.0) return vec3(0.61, 0.42, 1.0);
          return vec3(1.0, 0.7, 0.25);
        }
        // One street's surface. d: signed distance across the street centre; a: distance along
        // it; c: signed distance to the nearest cross street (junction when |c| < 9); id: street
        // index; fwd/fwa: pixel footprints across/along.
        void street(float d, float a, float c, float id, float fwd, float fwa, inout vec3 alb, inout vec3 em, inout float paint) {
          float ad = abs(d), ac = abs(c);
          // Block index along the street: changes at the junctions (a = multiples of BLOCK).
          float block = floor(a / ${BLOCK.toFixed(1)});
          vec3 colA = neon(gh11(id * 3.17 + 0.5));
          vec3 colB = neon(gh11(id * 7.31 + block * 0.13 + 2.0));
          float junction = step(ac, 9.0);
          float open = 1.0 - junction;
          if (ad < 7.5) {
            // Centre: amber double line. Lanes: dashes at the traffic lanes. Edges: glow strips.
            float centre = band(d, 0.28, 0.14, fwd) + band(d, -0.28, 0.14, fwd);
            float dash = band(ad, 3.75, 0.16, fwd) * step(fract(a / 6.0), 0.5);
            float edge = band(ad, 7.0, 0.2, fwd);
            em += (vec3(1.0, 0.62, 0.18) * centre * 0.75 + colA * dash * 1.3 + colB * edge * 0.9) * open;
            paint += (centre + dash + edge) * open;
            // Crosswalk stripes just outside each junction, softly pulsing; then a stop bar.
            float cw = step(9.6, ac) * step(ac, 12.6) * step(ad, 7.0);
            float stripe = clamp(band(fract(d / 1.25), 0.5, 0.55, fwd / 1.25), 0.0, 1.0);
            float pulse = 0.7 + 0.3 * sin(uTime * 1.6 + id * 1.7 + block * 2.3);
            em += mix(vec3(0.3, 0.85, 1.0), vec3(0.65, 0.45, 1.0), gh11(id + block)) * cw * stripe * 0.55 * pulse;
            alb += vec3(0.05) * cw * stripe;
            paint += cw * stripe;
            float stop = band(ac, 13.4, 0.45, fwa) * step(ad, 7.0) * step(0.0, d * sign(c));
            em += vec3(0.9, 0.95, 1.0) * stop * 0.5;
            paint += stop;
            // Neon spill from the shopfronts on the wet road, strongest at the curb.
            em += colB * exp(-(7.5 - ad) * 0.45) * 0.07 * open;
            // Glowing drain grates now and then near the curbs.
            float cell = floor(a / 28.0);
            if (gh11(cell * 1.9 + id * 5.3) > 0.55) {
              vec2 q = vec2(ad - 6.2, a - (cell + 0.5) * 28.0);
              float g = step(abs(q.x), 0.45) * step(abs(q.y), 0.9);
              float bars = step(0.5, fract(q.y * 2.5));
              alb = mix(alb, vec3(0.01), g);
              em += vec3(0.2, 0.75, 1.0) * g * bars * 0.35 * open;
            }
          } else if (ad < 8.1) {
            // Curb: concrete with a neon strip along its top edge.
            alb = vec3(0.07, 0.065, 0.085);
            float strip = band(ad, 7.62, 0.12, fwd);
            em += colB * strip * 1.2 * open;
            paint += 1.0;
          } else {
            // Sidewalk: paving slabs with small amber floor lights near the curb.
            vec2 s = vec2(d, a) / 2.0;
            vec2 sf = abs(fract(s) - 0.5);
            float seam = max(band(sf.x, 0.5, 0.06, fwd / 2.0), band(sf.y, 0.5, 0.06, fwa / 2.0));
            alb = mix(vec3(0.04, 0.036, 0.052), vec3(0.015, 0.012, 0.02), seam) * (0.85 + 0.3 * gh21(floor(s)));
            float lamp = band(ad, 8.55, 0.25, fwd) * band(fract(a / 8.0), 0.5, 0.03, fwa / 8.0);
            em += vec3(1.0, 0.62, 0.22) * lamp * 1.6 * open;
            paint += 0.6;
          }
        }`,
      )
      .replace(
        "#include <color_fragment>",
        /* glsl */ `#include <color_fragment>
        vec2 gp = vGW.xz;
        vec2 gfw = fwidth(gp);
        // Signed distance to the nearest street centre line on each axis.
        float dx = gp.x - floor(gp.x / ${BLOCK.toFixed(1)} + 0.5) * ${BLOCK.toFixed(1)};
        float dz = gp.y - floor(gp.y / ${BLOCK.toFixed(1)} + 0.5) * ${BLOCK.toFixed(1)};
        float idx = floor(gp.x / ${BLOCK.toFixed(1)} + 0.5), idz = floor(gp.y / ${BLOCK.toFixed(1)} + 0.5);
        float wear = gfbm(gp * 0.09);
        float wet = smoothstep(0.55, 0.72, gfbm(gp * 0.045 + 11.0));
        vec3 gAlb = vec3(0.022, 0.019, 0.03) * (0.75 + 0.5 * wear);
        vec3 gEm = vec3(0.0);
        float gPaint = 0.0;
        bool inX = abs(dx) < 12.0, inZ = abs(dz) < 12.0;
        if (inX && inZ && abs(dx) < 9.0 && abs(dz) < 9.0) {
          // Junction box: bare wet asphalt with a faint violet guide grid.
          vec2 jg = abs(fract(gp / 3.0) - 0.5);
          gEm += vec3(0.45, 0.25, 1.0) * max(band(jg.x, 0.5, 0.04, gfw.x / 3.0), band(jg.y, 0.5, 0.04, gfw.y / 3.0)) * 0.12;
        } else if (inX && (abs(dx) <= abs(dz) || !inZ)) {
          street(dx, gp.y, dz, idx, gfw.x, gfw.y, gAlb, gEm, gPaint);
        } else if (inZ) {
          street(dz, gp.x, dx, idz + 101.0, gfw.y, gfw.x, gAlb, gEm, gPaint);
        } else {
          // Block interiors (plazas between towers): dark tiles with faint circuit seams.
          vec2 t = abs(fract(gp / 4.0) - 0.5);
          float seam = max(band(t.x, 0.5, 0.05, gfw.x / 4.0), band(t.y, 0.5, 0.05, gfw.y / 4.0));
          gAlb = mix(vec3(0.03, 0.026, 0.04), vec3(0.012), seam);
          gEm += vec3(0.4, 0.2, 0.9) * seam * step(0.96, gh21(floor(gp / 4.0))) * 0.12;
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
