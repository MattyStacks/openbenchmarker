import * as THREE from "three";
import { pick, stream } from "./rng";
import { CELLS, type CellKind } from "./signlayout";

/**
 * One 2048x2048 sign atlas, drawn once with canvas 2D from the seeded RNG:
 * - 32 horizontal signs (4:1): procedural words, some with katakana-style glyphs,
 * - 16 vertical banners (1:4): glyph stacks or stacked letters,
 * - 8 billboards (2:1): two-line words, an icon and a glyph row.
 * Channels are masks, coloured per instance in the shader: R = lettering tubes, G = frame,
 * B = dim panel graphics, A = panel coverage.
 *
 * Glyphs are stroke paths drawn in code (no CJK font needed), so they look the same everywhere.
 * Latin lettering uses the system's bold sans-serif, as v1 did.
 */
export const ATLAS = 2048;
const U = 128;

export function cellRect(kind: CellKind, i: number): [number, number, number, number] {
  if (kind === "h") return [(i % 4) * 4 * U, Math.floor(i / 4) * U, 4 * U, U];
  if (kind === "v") return [i * U, 8 * U, U, 4 * U];
  return [(i % 4) * 4 * U, (12 + Math.floor(i / 4) * 2) * U, 4 * U, 2 * U];
}

/** Katakana-like glyphs as stroke polylines in a unit box (y down). Our own shapes, not a font. */
const GLYPHS: number[][][] = [
  [[0.15, 0.35, 0.85, 0.35, 0.75, 0.95], [0.5, 0.05, 0.45, 0.5, 0.2, 0.95]],
  [[0.2, 0.1, 0.8, 0.1], [0.15, 0.35, 0.8, 0.35, 0.55, 0.95]],
  [[0.7, 0.05, 0.15, 0.55], [0.5, 0.35, 0.5, 0.95]],
  [[0.4, 0.05, 0.4, 0.95], [0.4, 0.45, 0.8, 0.65]],
  [[0.25, 0.25, 0.75, 0.25], [0.1, 0.8, 0.9, 0.8]],
  [[0.2, 0.2, 0.8, 0.2, 0.8, 0.85, 0.2, 0.85, 0.2, 0.2]],
  [[0.2, 0.15, 0.8, 0.15], [0.5, 0.15, 0.5, 0.85], [0.1, 0.85, 0.9, 0.85]],
  [[0.2, 0.2, 0.35, 0.35], [0.15, 0.85, 0.85, 0.25]],
  [[0.15, 0.15, 0.3, 0.25], [0.1, 0.45, 0.25, 0.55], [0.15, 0.9, 0.85, 0.3]],
  [[0.25, 0.1, 0.75, 0.25], [0.3, 0.4, 0.7, 0.55], [0.2, 0.7, 0.8, 0.9]],
  [[0.1, 0.35, 0.9, 0.35], [0.3, 0.1, 0.3, 0.6], [0.7, 0.1, 0.7, 0.6, 0.4, 0.95]],
  [[0.25, 0.1, 0.75, 0.1], [0.1, 0.35, 0.9, 0.35], [0.5, 0.35, 0.45, 0.95]],
  [[0.1, 0.35, 0.9, 0.35], [0.55, 0.05, 0.55, 0.6, 0.3, 0.95]],
  [[0.1, 0.15, 0.9, 0.15, 0.65, 0.45], [0.5, 0.3, 0.45, 0.65, 0.2, 0.95]],
  [[0.1, 0.3, 0.9, 0.3], [0.65, 0.05, 0.65, 0.95, 0.5, 0.85], [0.6, 0.35, 0.15, 0.8]],
  [[0.5, 0.05, 0.5, 0.2], [0.15, 0.25, 0.8, 0.25, 0.15, 0.75], [0.5, 0.45, 0.5, 0.95], [0.6, 0.6, 0.85, 0.8]],
  [[0.35, 0.05, 0.15, 0.4], [0.3, 0.2, 0.8, 0.2, 0.4, 0.95]],
  [[0.3, 0.15, 0.3, 0.6], [0.7, 0.1, 0.7, 0.6, 0.4, 0.95]],
  [[0.45, 0.05, 0.15, 0.85, 0.85, 0.8], [0.65, 0.55, 0.85, 0.85]],
  [[0.75, 0.05, 0.2, 0.95], [0.3, 0.35, 0.8, 0.8]],
  [[0.1, 0.3, 0.9, 0.3], [0.5, 0.05, 0.5, 0.95], [0.3, 0.5, 0.1, 0.85], [0.7, 0.5, 0.9, 0.85]],
  [[0.05, 0.6, 0.35, 0.3, 0.95, 0.8]],
  [[0.2, 0.15, 0.2, 0.4], [0.2, 0.15, 0.8, 0.15, 0.75, 0.5, 0.4, 0.95]],
  [[0.25, 0.1, 0.25, 0.85, 0.85, 0.85], [0.25, 0.45, 0.75, 0.3]],
  [[0.5, 0.5, 0.5, 0.5]], // long-vowel dash (drawn rotated in vertical text)
];

const NOUNS = ["RAMEN", "NOODLE", "SUSHI", "HOTEL", "CAPSULE", "ARCADE", "KARAOKE", "CLUB", "BAR", "LIQUOR", "CLINIC", "PHARMA", "CYBER", "NEURAL", "SYNTH", "CHROME", "DATA", "NET", "REPAIR", "TAXI", "DRONE", "PARTS", "MARKET", "LOUNGE", "CASINO", "IMPLANT", "OPTICS", "BIO", "TECH", "GRID", "SOUND", "VIDEO", "TATTOO", "TEA", "DINER", "GARAGE", "STORAGE", "BANK", "NOVA", "ZEN", "PULSE", "ION", "VOLT"];
const MODS = ["24H", "OPEN", "NIGHT", "NEO", "HYPER", "SUPER", "MEGA", "No.7", "PLAZA", "HUB", "ZONE", "LAB", "CITY", "STATION", "DELUXE", "EXPRESS", "2099", "MAX", "PRO", "ONE"];

export function makeSignAtlas(seed: number): THREE.DataTexture {
  const rnd = stream(seed, 32);
  const word = () => {
    const r = rnd(), n = pick(rnd, NOUNS), m = pick(rnd, MODS);
    return r < 0.35 ? n : r < 0.6 ? `${n} ${m}` : r < 0.8 ? `${m} ${n}` : `${n} // ${pick(rnd, NOUNS)}`;
  };
  const rgb = document.createElement("canvas");
  rgb.width = rgb.height = ATLAS;
  const c = rgb.getContext("2d", { willReadFrequently: true })!;
  c.fillStyle = "#000";
  c.fillRect(0, 0, ATLAS, ATLAS);
  c.globalCompositeOperation = "lighter";
  const cov = document.createElement("canvas");
  cov.width = cov.height = ATLAS;
  const a = cov.getContext("2d", { willReadFrequently: true })!;
  a.fillStyle = "#fff";

  const R = "#ff0000", G = "#00ff00", B = "#0000ff";
  const glow = (col: string, blur: number) => {
    c.shadowColor = col;
    c.shadowBlur = blur;
  };
  const glyph = (gi: number, x: number, y: number, s: number, vertical: boolean) => {
    const strokes = GLYPHS[gi];
    c.strokeStyle = R;
    c.lineWidth = s * 0.1;
    c.lineCap = c.lineJoin = "round";
    for (const pass of [10, 0]) {
      glow(R, pass);
      for (const st of strokes) {
        c.beginPath();
        if (st.length === 4 && st[0] === st[2] && st[1] === st[3]) {
          // dash: horizontal in rows, vertical in columns
          if (vertical) c.moveTo(x + s * 0.5, y + s * 0.2), c.lineTo(x + s * 0.5, y + s * 0.8);
          else c.moveTo(x + s * 0.15, y + s * 0.5), c.lineTo(x + s * 0.85, y + s * 0.5);
        } else for (let k = 0; k < st.length; k += 2) (k ? c.lineTo : c.moveTo).call(c, x + st[k] * s, y + st[k + 1] * s);
        c.stroke();
      }
    }
  };
  const rrect = (g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) =>
    typeof g.roundRect === "function" ? g.roundRect(x, y, w, h, r) : g.rect(x, y, w, h);
  const panel = (x: number, y: number, w: number, h: number, r: number) => {
    a.beginPath();
    rrect(a, x + 6, y + 6, w - 12, h - 12, r);
    a.fill();
    // Frame tube in G.
    glow(G, 12);
    c.strokeStyle = G;
    c.lineWidth = 5;
    c.beginPath();
    rrect(c, x + 14, y + 14, w - 28, h - 28, Math.max(2, r - 6));
    c.stroke();
    // Dim panel graphics in B: faint scanlines and a gradient band.
    glow(B, 0);
    c.fillStyle = "rgba(0,0,255,0.25)";
    for (let yy = y + 18; yy < y + h - 18; yy += 6) c.fillRect(x + 18, yy, w - 36, 1);
  };
  const text = (s: string, x: number, y: number, maxW: number, size: number, outline: boolean) => {
    c.font = `900 ${size}px "Arial Black", "Helvetica Neue", Arial, sans-serif`;
    c.textAlign = "center";
    c.textBaseline = "middle";
    for (const pass of [14, 0]) {
      glow(R, pass);
      if (outline) {
        c.strokeStyle = R;
        c.lineWidth = Math.max(3, size * 0.07);
        c.strokeText(s, x, y, maxW);
      } else {
        c.fillStyle = R;
        c.fillText(s, x, y, maxW);
      }
    }
  };

  for (let i = 0; i < CELLS.h; i++) {
    const [x, y, w, h] = cellRect("h", i);
    panel(x, y, w, h, 14);
    const outline = rnd() < 0.3;
    if (rnd() < 0.3) {
      const n = 2 + Math.floor(rnd() * 2);
      text(word().split(" ")[0], x + w * 0.36, y + h / 2 + 3, w * 0.58, 62, outline);
      for (let k = 0; k < n; k++) glyph(Math.floor(rnd() * GLYPHS.length), x + w * 0.7 + k * 44 - (n - 2) * 20, y + h / 2 - 22, 44, false);
    } else if (rnd() < 0.15) {
      const n = 3 + Math.floor(rnd() * 3);
      for (let k = 0; k < n; k++) glyph(Math.floor(rnd() * GLYPHS.length), x + w / 2 + (k - n / 2) * 74 + 6, y + h / 2 - 31, 62, false);
    } else text(word(), x + w / 2, y + h / 2 + 3, w - 60, 66, outline);
  }
  for (let i = 0; i < CELLS.v; i++) {
    const [x, y, w, h] = cellRect("v", i);
    panel(x, y, w, h, 12);
    if (rnd() < 0.65) {
      const n = 3 + Math.floor(rnd() * 3), s = Math.min(78, (h - 70) / n);
      for (let k = 0; k < n; k++) glyph(Math.floor(rnd() * GLYPHS.length), x + w / 2 - s / 2, y + 35 + k * ((h - 70) / n) + ((h - 70) / n - s) / 2, s, true);
    } else {
      const letters = pick(rnd, NOUNS).slice(0, 6).split("");
      letters.forEach((ch, k) => text(ch, x + w / 2, y + 40 + ((k + 0.5) * (h - 80)) / letters.length, w - 30, 64, false));
    }
  }
  for (let i = 0; i < CELLS.b; i++) {
    const [x, y, w, h] = cellRect("b", i);
    panel(x, y, w, h, 18);
    const n = pick(rnd, NOUNS), m = pick(rnd, MODS);
    text(n, x + w * 0.58, y + h * 0.36, w * 0.66, 78, rnd() < 0.3);
    text(`// ${m}`, x + w * 0.58, y + h * 0.66, w * 0.6, 44, false);
    // Icon in R: a ringed emblem, an arrow or a bar chart.
    const cx = x + w * 0.15, cy = y + h * 0.48, s = h * 0.26;
    glow(R, 10);
    c.strokeStyle = R;
    c.lineWidth = 6;
    const icon = Math.floor(rnd() * 3);
    c.beginPath();
    if (icon === 0) c.arc(cx, cy, s, 0, Math.PI * 2), c.moveTo(cx - s * 0.5, cy + s * 0.2), c.arc(cx, cy + s * 0.2, s * 0.5, Math.PI, 0, true);
    else if (icon === 1) c.moveTo(cx - s, cy - s * 0.7), c.lineTo(cx + s * 0.6, cy), c.lineTo(cx - s, cy + s * 0.7), c.closePath();
    else for (let k = 0; k < 4; k++) c.rect(cx - s + k * s * 0.55, cy + s - (k + 1) * s * 0.42, s * 0.36, (k + 1) * s * 0.42);
    c.stroke();
    for (let k = 0; k < 4; k++) glyph(Math.floor(rnd() * GLYPHS.length), x + w * 0.36 + k * 40, y + h - 66, 34, false);
  }

  const src = c.getImageData(0, 0, ATLAS, ATLAS).data;
  const al = a.getImageData(0, 0, ATLAS, ATLAS).data;
  const data = new Uint8Array(ATLAS * ATLAS * 4);
  for (let p = 0; p < ATLAS * ATLAS * 4; p += 4) {
    data[p] = src[p];
    data[p + 1] = src[p + 1];
    data[p + 2] = src[p + 2];
    data[p + 3] = al[p + 3];
  }
  const tex = new THREE.DataTexture(data, ATLAS, ATLAS, THREE.RGBAFormat);
  tex.flipY = false;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.anisotropy = 8;
  tex.needsUpdate = true;
  return tex;
}
