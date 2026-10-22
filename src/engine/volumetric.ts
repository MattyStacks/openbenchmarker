import * as THREE from "three";
import { ShaderPass } from "three/addons/postprocessing/ShaderPass.js";
import type { WebGLRenderTarget } from "three";
import type { GlowLight } from "./ctx";

/** Neon lights the haze picks up per frame (the nearest to the camera). */
export const VOL_LIGHTS = 8;
/** Rays stop here (world units); beyond it the analytic height fog does the work. */
const MAX_DIST = 520;

/**
 * Volumetric light scattering: per pixel, march the view ray through drifting 3D-noise haze up
 * to the first surface (scene depth) and add the light it scatters from the nearest neon signs.
 * GPU-only work that scales with pixels x steps; the CPU only picks the nearest lights. The
 * analytic height fog already darkens distance, so this mostly adds light (glowing air around
 * signs, streaks where haze is thick) with a little extinction.
 */
export class VolumetricPass extends ShaderPass {
  private readonly camera: THREE.PerspectiveCamera;
  private readonly lights: GlowLight[];
  private readonly near: { i: number; s: number }[] = [];

  constructor(camera: THREE.PerspectiveCamera, lights: GlowLight[], steps: number) {
    super({
      defines: { STEPS: steps, LIGHTS: VOL_LIGHTS },
      uniforms: {
        tDiffuse: { value: null },
        tDepth: { value: null },
        uProjInv: { value: new THREE.Matrix4() },
        uCamWorld: { value: new THREE.Matrix4() },
        uCamPos: { value: new THREE.Vector3() },
        uTime: { value: 0 },
        uLightPos: {
          value: Array.from({ length: VOL_LIGHTS }, () => new THREE.Vector4(0, -1e4, 0, 1)),
        },
        uLightCol: {
          value: Array.from({ length: VOL_LIGHTS }, () => new THREE.Color(0, 0, 0)),
        },
      },
      vertexShader: /* glsl */ `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: /* glsl */ `
        uniform sampler2D tDiffuse, tDepth;
        uniform mat4 uProjInv, uCamWorld;
        uniform vec3 uCamPos;
        uniform float uTime;
        uniform vec4 uLightPos[LIGHTS]; // xyz, 1 / reach^2
        uniform vec3 uLightCol[LIGHTS];
        varying vec2 vUv;
        float h31(vec3 p) { p = fract(p * 0.1031); p += dot(p, p.zyx + 31.32); return fract((p.x + p.y) * p.z); }
        float noise(vec3 p) {
          vec3 i = floor(p), f = fract(p);
          vec3 u = f * f * (3.0 - 2.0 * f);
          return mix(
            mix(mix(h31(i), h31(i + vec3(1, 0, 0)), u.x), mix(h31(i + vec3(0, 1, 0)), h31(i + vec3(1, 1, 0)), u.x), u.y),
            mix(mix(h31(i + vec3(0, 0, 1)), h31(i + vec3(1, 0, 1)), u.x), mix(h31(i + vec3(0, 1, 1)), h31(i + vec3(1, 1, 1)), u.x), u.y),
            u.z);
        }
        float haze(vec3 p) {
          vec3 q = p * 0.014 + vec3(uTime * 0.05, -uTime * 0.11, uTime * 0.03);
          float n = 0.5 * noise(q) + 0.25 * noise(q * 2.07 + 5.3) + 0.125 * noise(q * 4.13 + 1.7);
          // Thickest near the street, thinning with altitude.
          return smoothstep(0.38, 0.8, n) * exp(-max(p.y, 0.0) * 0.012);
        }
        void main() {
          vec3 scene = texture2D(tDiffuse, vUv).rgb;
          float z = texture2D(tDepth, vUv).x;
          vec4 vp = uProjInv * vec4(vUv * 2.0 - 1.0, z * 2.0 - 1.0, 1.0);
          vp.xyz /= vp.w;
          float sceneDist = length(vp.xyz);
          vec3 rd = normalize(mat3(uCamWorld) * vp.xyz);
          float tEnd = min(sceneDist, ${MAX_DIST.toFixed(1)});
          float dt = tEnd / float(STEPS);
          // Per-pixel jitter hides banding between steps.
          float t = dt * fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))) + uTime * 7.31);
          vec3 acc = vec3(0.0);
          float T = 1.0;
          for (int s = 0; s < STEPS; s++) {
            vec3 p = uCamPos + rd * t;
            float d = haze(p);
            vec3 li = vec3(0.006, 0.0025, 0.01); // faint city glow
            for (int k = 0; k < LIGHTS; k++) {
              vec3 v = uLightPos[k].xyz - p;
              li += uLightCol[k] * exp(-dot(v, v) * uLightPos[k].w * 0.6); // halo within the light's reach
            }
            float a = d * 0.016 * dt;
            acc += T * a * li;
            T *= exp(-a * 0.35);
            t += dt;
          }
          gl_FragColor = vec4(scene * T + min(acc * 0.26, vec3(0.06)), 1.0);
        }`,
    });
    this.camera = camera;
    this.lights = lights;
  }

  render(renderer: THREE.WebGLRenderer, writeBuffer: WebGLRenderTarget, readBuffer: WebGLRenderTarget, deltaTime: number, maskActive: boolean): void {
    const u = this.uniforms;
    u.tDepth.value = readBuffer.depthTexture;
    u.uProjInv.value.copy(this.camera.projectionMatrixInverse);
    u.uCamWorld.value.copy(this.camera.matrixWorld);
    u.uCamPos.value.setFromMatrixPosition(this.camera.matrixWorld);
    this.pickLights(u.uCamPos.value);
    super.render(renderer, writeBuffer, readBuffer, deltaTime, maskActive);
  }

  setTime(t: number): void {
    this.uniforms.uTime.value = t;
  }

  /** The VOL_LIGHTS lights nearest the camera (distance minus reach), by insertion into a short list. */
  private pickLights(cam: THREE.Vector3): void {
    const near = this.near;
    near.length = 0;
    for (let i = 0; i < this.lights.length; i++) {
      const L = this.lights[i];
      const s = Math.hypot(L.x - cam.x, L.y - cam.y, L.z - cam.z) - L.r;
      if (near.length === VOL_LIGHTS && s >= near[VOL_LIGHTS - 1].s) continue;
      let j = Math.min(near.length, VOL_LIGHTS - 1);
      if (near.length < VOL_LIGHTS) near.push({ i, s });
      while (j > 0 && near[j - 1].s > s) {
        near[j] = near[j - 1];
        j--;
      }
      near[j] = { i, s };
    }
    const pos = this.uniforms.uLightPos.value as THREE.Vector4[];
    const col = this.uniforms.uLightCol.value as THREE.Color[];
    for (let k = 0; k < VOL_LIGHTS; k++) {
      const L = k < near.length ? this.lights[near[k].i] : null;
      if (L) {
        // Big signs have a long reach; cap the halo so one sign can't flood the screen.
        const r = Math.min(L.r, 28);
        pos[k].set(L.x, L.y, L.z, 1 / (r * r));
        col[k].copy(L.color);
      } else {
        pos[k].set(0, -1e4, 0, 1);
        col[k].setRGB(0, 0, 0);
      }
    }
  }
}
