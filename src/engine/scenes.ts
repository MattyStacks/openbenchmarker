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
import { FLIGHT } from "./world";

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

export interface Flythrough {
  /**
   * Render one frame of scene time `t` seconds. `view` (dev captures only) replaces the flight
   * camera with a fixed position and look target.
   */
  render(t: number, view?: { pos: THREE.Vector3Tuple; look: THREE.Vector3Tuple }): void;
  dispose(): void;
  /** What actually got enabled (bloom can fall back). */
  features: { bloom: boolean; reflections: boolean; msaa: number; shadows: boolean; fallbackReason: string };
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
export function makeFlythrough(renderer: THREE.WebGLRenderer, preset: Preset, w: number, h: number): Flythrough {
  installHeightFog();
  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(FOG_COLOR, FOG_DENSITY);
  scene.background = new THREE.Color(0x0a0620);

  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.15;
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

  const features = { bloom: false, reflections: !!mirror, msaa: 0, shadows: preset.shadowMap > 0, fallbackReason: "" };
  let composer: EffectComposer | null = null;
  let grade: ShaderPass | null = null;
  if (preset.bloom > 0) {
    try {
      const rt = new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType, samples: preset.msaa });
      composer = new EffectComposer(renderer, rt);
      composer.setPixelRatio(1);
      composer.setSize(w, h);
      composer.addPass(new RenderPass(scene, camera));
      composer.addPass(new ShaderPass(SanitizeShader));
      composer.addPass(new UnrealBloomPass(new THREE.Vector2(w, h), preset.bloom, 0.55, 0.62));
      grade = new ShaderPass(GradeShader);
      grade.uniforms.uRes.value.set(w, h);
      composer.addPass(grade);
      composer.addPass(new OutputPass());
      features.bloom = true;
      features.msaa = preset.msaa;
    } catch (e) {
      composer?.dispose();
      composer = null;
      grade = null;
      features.fallbackReason = `Bloom composer failed, plain rendering used: ${(e as Error).message}`;
    }
  }

  const look = new THREE.Vector3();
  const timing = { updateMs: 0 };
  const render = (t: number, view?: { pos: THREE.Vector3Tuple; look: THREE.Vector3Tuple }) => {
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
    features.bloom = false;
    features.msaa = 0;
    features.fallbackReason = `Bloom composer failed on first frame, plain rendering used: ${(e as Error).message}`;
    render(0);
  }

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
