import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { ShaderPass } from "three/addons/postprocessing/ShaderPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { Reflector } from "three/addons/objects/Reflector.js";
import type { Preset } from "../benchmark/presets";
import { buildCity } from "./city";
import { FOG_COLOR, FOG_DENSITY, installHeightFog } from "./fog";
import { VolumetricPass } from "./volumetric";
import { FLIGHT, JOURNEY_SECONDS } from "./world";

const GradeShader = {
  uniforms: {
    tDiffuse: { value: null },
    uTime: { value: 0 },
    uRes: { value: new THREE.Vector2(1, 1) },
  },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: `uniform sampler2D tDiffuse; uniform float uTime; uniform vec2 uRes; varying vec2 vUv;
    float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
    void main(){
      vec2 d = vUv - 0.5;
      float r2 = dot(d, d);
      vec2 off = d * r2 * 0.012;
      vec3 c;
      c.r = texture2D(tDiffuse, vUv + off).r;
      c.g = texture2D(tDiffuse, vUv).g;
      c.b = texture2D(tDiffuse, vUv - off).b;
      c *= 0.92 + 0.08 * sin(vUv.y * uRes.y * 1.5708);
      c += (hash(vUv * uRes + fract(uTime * 7.31) * 113.0) - 0.5) * 0.03;
      c *= 1.0 - smoothstep(0.18, 0.62, r2) * 0.55;
      gl_FragColor = vec4(c, 1.0);
    }`,
};

/**
 * Runs before bloom. A single NaN/Inf pixel (driver-specific shader edge cases) would otherwise be
 * smeared by the bloom blur into a flashing black or white block. Non-finite -> 0, and HDR is capped.
 */
const SanitizeShader = {
  uniforms: { tDiffuse: { value: null } },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: `uniform sampler2D tDiffuse; varying vec2 vUv;
    void main(){
      vec4 c = texture2D(tDiffuse, vUv);
      if (any(isnan(c)) || any(isinf(c))) c = vec4(0.0, 0.0, 0.0, 1.0);
      gl_FragColor = vec4(clamp(c.rgb, 0.0, 64.0), clamp(c.a, 0.0, 1.0));
    }`,
};

/** Tone-mapping exposure for presets up to FULL_EXPOSURE_SIGNS signs (a dark, neon-lit night). */
const EXPOSURE = 0.85;
const FULL_EXPOSURE_SIGNS = 1100;
/**
 * Denser presets put more neon on screen (signs, holos, shafts and rain scale together), so past
 * Ultra's sign count the exposure drops to keep the same dark look instead of a bright wash.
 */
export function exposureFor(signs: number): number {
  return signs > FULL_EXPOSURE_SIGNS ? EXPOSURE * (FULL_EXPOSURE_SIGNS / signs) ** 0.7 : EXPOSURE;
}

/** Frames rendered across the flight while building (see the pre-roll in makeFlythrough). */
const PREROLL_FRAMES = 16;

export interface Flythrough {
  /**
   * Render one frame of scene time `t` seconds. `view` (dev captures only) replaces the flight
   * camera with a fixed position and look target. `present` false sends the final pass to an
   * offscreen buffer instead of the canvas: the same GPU work, but the browser has nothing new
   * to put on screen (see the run loop, which presents at most once per display refresh).
   */
  render(t: number, view?: { pos: THREE.Vector3Tuple; look: THREE.Vector3Tuple }, present?: boolean): void;
  dispose(): void;
  /** What actually got enabled (bloom can fall back). */
  features: { bloom: boolean; reflections: boolean; msaa: number; shadows: boolean; shadowMap: number; volumetrics: number; fallbackReason: string };
  /** JS time spent in scene updates (animation, instance matrices) since the caller last reset it, ms. */
  timing: { updateMs: number };
  counts: Record<string, number>;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
}

/**
 * Build the Neon Flythrough for a renderer already sized to w x h.
 * Renders one frame immediately so failures surface before timing starts.
 */
export function makeFlythrough(renderer: THREE.WebGLRenderer, requested: Preset, w: number, h: number): Flythrough {
  // Extreme's 8192 shadow map exceeds some GPUs' texture limit (common on phones): cap it and say so.
  const maxTex = renderer.capabilities.maxTextureSize;
  const preset = requested.shadowMap > maxTex ? { ...requested, shadowMap: maxTex } : requested;
  installHeightFog();
  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(FOG_COLOR, FOG_DENSITY);
  scene.background = new THREE.Color(0x0a0620);

  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = exposureFor(preset.signs);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.enabled = preset.shadowMap > 0;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const camera = new THREE.PerspectiveCamera(68, w / h, 0.5, 4200);
  const city = buildCity(preset, { w, h });
  scene.add(city.group);

  let mirror: Reflector | null = null;
  if (preset.reflections > 0) {
    mirror = new Reflector(new THREE.PlaneGeometry(8000, 8000), {
      textureWidth: Math.round(w * preset.reflections),
      textureHeight: Math.round(h * preset.reflections),
      color: 0x8a8fa8,
      clipBias: 0.003,
      multisample: preset.msaa,
    });
    mirror.rotation.x = -Math.PI / 2;
    mirror.position.y = 0.0;
    // The see-through street sits just above the mirror. If both wrote depth they would
    // z-fight (flicker) in the distance, so the mirror draws first without depth writes: towers
    // still cover it, and the street always lands on top of it.
    const mm = mirror.material as THREE.Material;
    mm.depthWrite = false;
    mirror.renderOrder = -6;
    scene.add(mirror);
  }

  const features = { bloom: false, reflections: !!mirror, msaa: 0, shadows: preset.shadowMap > 0, shadowMap: preset.shadowMap, volumetrics: 0, fallbackReason: "" };
  if (preset !== requested) features.fallbackReason = `Shadow map reduced from ${requested.shadowMap} to ${maxTex} (the GPU's texture size limit)`;
  let composer: EffectComposer | null = null;
  let grade: ShaderPass | null = null;
  let vol: VolumetricPass | null = null;
  if (preset.bloom > 0) {
    try {
      // The volumetric pass reads scene depth; the composer's second buffer clones this depth texture.
      // An unrenderable half-float target doesn't throw, it renders black: check up front (old phones).
      const ext = renderer.extensions;
      if (!ext.has("EXT_color_buffer_float") && !ext.has("EXT_color_buffer_half_float")) throw new Error("no half-float render targets");
      const depthTexture = preset.volumetrics > 0 ? new THREE.DepthTexture(w, h, THREE.FloatType) : null;
      const rt = new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType, samples: preset.msaa, depthTexture });
      composer = new EffectComposer(renderer, rt);
      composer.setPixelRatio(1);
      composer.setSize(w, h);
      composer.addPass(new RenderPass(scene, camera));
      // Straight after the scene render, while readBuffer still holds the scene's depth.
      if (preset.volumetrics > 0) composer.addPass((vol = new VolumetricPass(camera, city.lights, preset.volumetrics)));
      composer.addPass(new ShaderPass(SanitizeShader));
      composer.addPass(new UnrealBloomPass(new THREE.Vector2(w, h), preset.bloom, 0.55, 0.62));
      grade = new ShaderPass(GradeShader);
      grade.uniforms.uRes.value.set(w, h);
      composer.addPass(grade);
      composer.addPass(new OutputPass());
      features.bloom = true;
      features.msaa = preset.msaa;
      features.volumetrics = vol ? preset.volumetrics : 0;
    } catch (e) {
      composer?.dispose();
      composer = null;
      grade = null;
      vol = null;
      features.fallbackReason = `Bloom composer failed, plain rendering used: ${(e as Error).message}`;
    }
  }

  const look = new THREE.Vector3();
  const timing = { updateMs: 0 };
  const render = (t: number, view?: { pos: THREE.Vector3Tuple; look: THREE.Vector3Tuple }, present = true) => {
    let roll = 0;
    if (view) {
      camera.position.fromArray(view.pos);
      look.fromArray(view.look);
    } else roll = FLIGHT.pose(t, camera.position, look);
    camera.up.set(0, 1, 0);
    camera.lookAt(look);
    camera.rotateZ(roll);
    camera.updateMatrixWorld();
    const u0 = performance.now();
    city.update(t, camera);
    timing.updateMs += performance.now() - u0;
    if (composer) {
      grade!.uniforms.uTime.value = t;
      vol?.setTime(t);
      composer.renderToScreen = present;
      composer.render();
    } else {
      renderer.setRenderTarget(null);
      renderer.render(scene, camera);
    }
  };

  // First render now, so a broken composer is caught here and replaced by plain rendering.
  try {
    render(0);
  } catch (e) {
    if (!composer) throw e;
    composer.dispose();
    composer = null;
    grade = null;
    vol = null;
    features.bloom = false;
    features.msaa = 0;
    features.volumetrics = 0;
    features.fallbackReason = `Bloom composer failed on first frame, plain rendering used: ${(e as Error).message}`;
    render(0);
  }

  // Compile every material and touch the whole flight once, so shader compiles (slow on a cold
  // cache, e.g. ANGLE D3D11) and texture uploads happen now, not as hitches during the timed run.
  // Scene state depends only on t, so rendering out of order is harmless.
  renderer.compile(scene, camera);
  for (let i = 1; i <= PREROLL_FRAMES; i++) render((JOURNEY_SECONDS * i) / PREROLL_FRAMES);
  timing.updateMs = 0;

  return {
    render,
    features,
    timing,
    counts: city.counts,
    scene,
    camera,
    dispose() {
      composer?.dispose();
      if (mirror) {
        mirror.geometry.dispose();
        mirror.dispose();
      }
      city.dispose();
      scene.clear();
      renderer.shadowMap.enabled = false;
    },
  };
}
