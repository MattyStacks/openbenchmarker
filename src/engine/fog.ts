import * as THREE from "three";

/**
 * Layered height fog for every fogged material (lit materials, light bars, signs): exponential
 * fog whose density falls off with altitude, integrated along the view ray, with a colour that
 * shifts from a warm city-glow violet up close to the scene fog colour (deep violet haze) in the
 * distance and glows brighter near the street. Uses only the built-in fog uniforms (fogColor,
 * fogDensity from a FogExp2), so it applies to built-in and custom ShaderMaterials alike.
 *
 * Also exported as GLSL for additive effects (glows, trails, shafts), which fade instead of
 * blending toward a colour.
 */
export const FOG_FALLOFF = 0.0115;
/** Fog density at street level (per world unit). */
export const FOG_DENSITY = 0.0017;
/** Far haze colour (the scene fog colour). */
export const FOG_COLOR = 0x2c0f4a;

export const FOG_FN = /* glsl */ `
  float ogbFogAmount(vec3 ro, vec3 wp, float density) {
    vec3 rd = wp - ro;
    float dist = length(rd);
    float b = ${FOG_FALLOFF.toFixed(5)};
    float k = density * exp(-b * max(ro.y, 0.0));
    float by = clamp(b * rd.y, -30.0, 30.0);
    float amt = abs(by) > 1e-3 ? k * dist * (1.0 - exp(-by)) / by : k * dist;
    return 1.0 - exp(-clamp(amt, 0.0, 30.0));
  }`;

let installed = false;

export function installHeightFog(): void {
  if (installed) return;
  installed = true;
  THREE.ShaderChunk.fog_pars_vertex = `#ifdef USE_FOG
    varying vec3 vFogWorld;
  #endif`;
  // View matrices are rigid, so world = R^T (mv - t): no per-vertex matrix inverse.
  THREE.ShaderChunk.fog_vertex = `#ifdef USE_FOG
    vFogWorld = transpose(mat3(viewMatrix)) * (mvPosition.xyz - viewMatrix[3].xyz);
  #endif`;
  THREE.ShaderChunk.fog_pars_fragment = `#ifdef USE_FOG
    uniform vec3 fogColor;
    varying vec3 vFogWorld;
    #ifdef FOG_EXP2
      uniform float fogDensity;
    #else
      uniform float fogNear;
      uniform float fogFar;
    #endif
    ${FOG_FN}
  #endif`;
  THREE.ShaderChunk.fog_fragment = `#ifdef USE_FOG
    #ifdef FOG_EXP2
      float ogbDensity = fogDensity;
    #else
      float ogbDensity = 1.0 / max(fogFar, 1.0);
    #endif
    float ogbF = ogbFogAmount(cameraPosition, vFogWorld, ogbDensity);
    float ogbDist = length(vFogWorld - cameraPosition);
    vec3 ogbCol = mix(vec3(0.30, 0.10, 0.32), fogColor, smoothstep(120.0, 1500.0, ogbDist));
    ogbCol *= 1.0 + 0.7 * exp(-max(vFogWorld.y, 0.0) * 0.025);
    gl_FragColor.rgb = mix(gl_FragColor.rgb, ogbCol, ogbF);
  #endif`;
}
