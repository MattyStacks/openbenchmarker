import * as THREE from "three";
import type { Preset } from "../benchmark/presets";
import type { BuildingSpot, SolidIndex } from "./layout";

/** Everything a scene system needs while building, plus where it registers its per-frame work. */
export interface BuildCtx {
  preset: Preset;
  seed: number;
  /** Render size in pixels (fixed for the whole run). */
  size: { w: number; h: number };
  group: THREE.Group;
  shadows: boolean;
  /** Register a GPU resource for disposal; returns it. */
  track<T extends { dispose(): void }>(x: T): T;
  /** Per-frame update; must depend only on scene time t and the camera (itself a function of t). */
  onUpdate(fn: (t: number, camera: THREE.Camera) => void): void;
  counts: Record<string, number>;
  /** Tower footprints, filled by the towers system for later systems to anchor to. */
  spots: BuildingSpot[];
  /** Bright neon sources (signs etc.) that rain and haze can pick up colour from. */
  lights: GlowLight[];
  /** Every solid volume placed so far; moving things route around them. */
  solids: SolidIndex;
}

export interface GlowLight {
  x: number;
  y: number;
  z: number;
  /** Reach in world units. */
  r: number;
  color: THREE.Color;
}

export const NEON = [0xff2bd6, 0x22e6ff, 0xff4f6a, 0x9b5cff, 0x3dffb0, 0xffb02e];

/**
 * A 2D canvas on the page, or an OffscreenCanvas in a worker (no DOM there). Typed as the page
 * canvas: the 2D drawing API and texture uploads used here are the same for both.
 */
export function makeCanvas(w: number, h: number): HTMLCanvasElement {
  if (typeof document === "undefined") return new OffscreenCanvas(w, h) as unknown as HTMLCanvasElement;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  return canvas;
}

export function canvasTexture(w: number, h: number, draw: (c: CanvasRenderingContext2D) => void): THREE.CanvasTexture {
  const canvas = makeCanvas(w, h);
  draw(canvas.getContext("2d")!);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

export function radialTexture(inner: string, outer: string): THREE.CanvasTexture {
  return canvasTexture(128, 128, (c) => {
    const g = c.createRadialGradient(64, 64, 0, 64, 64, 64);
    g.addColorStop(0, inner);
    g.addColorStop(1, outer);
    c.fillStyle = g;
    c.fillRect(0, 0, 128, 128);
  });
}

/** Write a Y-rotation (heading fx,fz) + scale + translation matrix, column-major. */
export function writeOriented(a: Float32Array, o: number, fx: number, fz: number, sx: number, sy: number, sz: number, x: number, y: number, z: number): void {
  // local +z -> (fx, 0, fz); local +x -> (fz, 0, -fx)
  a[o] = fz * sx; a[o + 1] = 0; a[o + 2] = -fx * sx; a[o + 3] = 0;
  a[o + 4] = 0; a[o + 5] = sy; a[o + 6] = 0; a[o + 7] = 0;
  a[o + 8] = fx * sz; a[o + 9] = 0; a[o + 10] = fz * sz; a[o + 11] = 0;
  a[o + 12] = x; a[o + 13] = y; a[o + 14] = z; a[o + 15] = 1;
}
