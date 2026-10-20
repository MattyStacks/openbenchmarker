// Dev-only: render the flythrough at a fixed scene time for screenshots and load reports.
// Loaded from main.ts only when import.meta.env.DEV is true, so production builds drop it.
// URL: /?capture&preset=Ultra&w=1280&h=720  → window.__cap.renderAt(t) / timeAt(t, frames)
import * as THREE from "three";
import { getPreset } from "../benchmark/presets";
import { makeFlythrough } from "../engine/scenes";

export interface CaptureApi {
  features: Record<string, unknown>;
  counts: Record<string, number>;
  /** Render one frame of scene time t; returns renderer.info summed over every pass. */
  renderAt(t: number, view?: { pos: [number, number, number]; look: [number, number, number] }): Record<string, number>;
  /** Relative cost only (software GL in headless runs): ms per frame over `frames` frames at t. */
  timeAt(t: number, frames: number): number;
  /** Show or hide one scene system group (sky, atmosphere, towers, signs, rain, traffic, drones, fx). */
  setVisible(name: string, on: boolean): void;
}

export function runCapture(): void {
  const q = new URLSearchParams(location.search);
  const preset = getPreset(q.get("preset") ?? "Ultra") ?? getPreset("Ultra")!;
  const w = Number(q.get("w")) || 1280;
  const h = Number(q.get("h")) || 720;
  document.body.replaceChildren();
  document.body.style.cssText = "margin:0;background:#000;overflow:hidden";
  const canvas = document.createElement("canvas");
  canvas.style.cssText = `display:block;width:${w}px;height:${h}px`;
  document.body.append(canvas);
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true, powerPreference: "high-performance" });
  renderer.setPixelRatio(1);
  renderer.setSize(w, h, false);
  const fly = makeFlythrough(renderer, preset, w, h);
  const gl = renderer.getContext();
  const px = new Uint8Array(4);
  const api: CaptureApi = {
    features: { ...fly.features },
    counts: fly.counts,
    renderAt(t, view) {
      renderer.info.autoReset = false;
      renderer.info.reset();
      fly.render(t, view);
      renderer.setRenderTarget(null);
      const r = renderer.info.render;
      const out = { calls: r.calls, triangles: r.triangles, points: r.points, lines: r.lines, geometries: renderer.info.memory.geometries, textures: renderer.info.memory.textures, programs: renderer.info.programs?.length ?? 0 };
      renderer.info.autoReset = true;
      return out;
    },
    setVisible(name, on) {
      const o = fly.scene.getObjectByName(name);
      if (o) o.visible = on;
    },
    timeAt(t, frames) {
      fly.render(t);
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
      const t0 = performance.now();
      for (let i = 0; i < frames; i++) fly.render(t + i / 60);
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
      return (performance.now() - t0) / frames;
    },
  };
  (window as unknown as { __cap: CaptureApi }).__cap = api;
}
