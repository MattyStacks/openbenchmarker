export const $ = <T extends HTMLElement = HTMLElement>(sel: string) => document.querySelector(sel) as T;
export const esc = (s: unknown) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
export const nextFrame = () => new Promise<void>((r) => requestAnimationFrame(() => r()));

/**
 * Whether an installed font can draw katakana. Missing glyphs all render as the same
 * .notdef box, so two different katakana drawing identically means there is no font for them.
 */
export function kanaRenders(): boolean {
  try {
    const c = document.createElement("canvas");
    c.width = 48;
    c.height = 24;
    const g = c.getContext("2d", { willReadFrequently: true });
    if (!g) return true;
    g.font = `20px "Hiragino Kaku Gothic ProN", "Yu Gothic", "Meiryo", "Noto Sans CJK JP", "Noto Sans JP", sans-serif`;
    const draw = (s: string) => {
      g.clearRect(0, 0, 48, 24);
      g.fillText(s, 2, 20);
      return g.getImageData(0, 0, 48, 24).data.join(",");
    };
    const ka = draw("カ");
    return ka !== draw("ネ") && ka !== draw("");
  } catch {
    return true;
  }
}
