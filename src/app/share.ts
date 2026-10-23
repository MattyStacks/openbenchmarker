import { encode as qrEncode } from "uqr";
import { encodeShare, type SharedRun, type SharePayload } from "../benchmark/share-codec";
import type { DeviceContext } from "../benchmark/types";
import { getScoreTest } from "../benchmark/presets";
import { SAME_PCT, apartLabel, compareRuns, comparisonText, inviteText } from "./compare";
import { esc } from "./dom";

// ---------------------------------------------------------------------------
// Sharing: link, share text, share card (canvas PNG with a QR code) and the share flow.
// Everything happens in this browser; the link's fragment (#/r/...) is never sent to the server.
// ---------------------------------------------------------------------------

export const SHARE_NOTE =
  "Anyone with the link can read it. That's how it works, not a security flaw: the result is encoded, not encrypted, so it can be read back like a screenshot, and because the format is open, sharing runs on the honor system.";

/** The link for a run. Uses the current origin, so previews and local tests link to themselves. */
export function shareUrl(run: SharedRun): string {
  return `${location.origin}/#/r/${encodeShare({ type: "result", runs: [run] })}`;
}

const BROWSER_NAME: Record<DeviceContext["browser"], string> = {
  chrome: "Chrome", edge: "Edge", brave: "Brave", firefox: "Firefox", safari: "Safari", opera: "Opera", vivaldi: "Vivaldi", samsung: "Samsung Internet", other: "Other browser",
};
const OS_NAME: Record<DeviceContext["os"], string> = {
  windows: "Windows", macos: "macOS", linux: "Linux", chromeos: "ChromeOS", android: "Android", ios: "iOS/iPadOS", other: "Other OS",
};
const DEVICE_NAME: Record<DeviceContext["deviceType"], string> = { phone: "phone", tablet: "tablet", desktop: "desktop/laptop", unknown: "" };

export function browserLabel(d: DeviceContext): string {
  const name = `${BROWSER_NAME[d.browser]}${d.browserMajor ? ` ${d.browserMajor}` : ""}`;
  return d.webkitEngine && d.browser !== "safari" ? `${name} (WebKit)` : name;
}
export function osLabel(d: DeviceContext): string {
  return OS_NAME[d.os];
}
export function deviceLabel(d: DeviceContext): string {
  return [browserLabel(d), osLabel(d), DEVICE_NAME[d.deviceType]].filter(Boolean).join(" · ");
}

const fps = (x: number) => x.toFixed(1);
export const settingsLabel = (r: SharedRun) => `${r.resolution} · ${r.preset} · ${r.durationS} s`;
const scoreLabel = (r: SharedRun) => (r.score !== undefined ? `${getScoreTest(r.scoreTest)?.name ?? "Score"} ${r.score.toLocaleString("en-US")}` : "");

/** One line that reads well in iMessage, Discord, Reddit and X (well under 280 with the link). */
export function shareText(r: SharedRun): string {
  const gpu = r.device.gpuLabel ? ` on ${r.device.gpuLabel}` : "";
  const score = r.score !== undefined ? `${scoreLabel(r)}: ` : "";
  return `${score}${fps(r.avgFps)} FPS avg, ${fps(r.p1Low)} 1% low in the Neon Flythrough browser GPU benchmark (${settingsLabel(r)})${gpu}. Measured in my browser, shared on the honor system:`;
}

// ----- share card -----
export const CARD_W = 1200;
export const CARD_H = 630;
const SANS = `system-ui, -apple-system, "Segoe UI", Roboto, "Noto Sans", sans-serif`;
const MONO = `ui-monospace, "SFMono-Regular", "Cascadia Mono", "Roboto Mono", Menlo, Consolas, monospace`;

function fitText(ctx: CanvasRenderingContext2D, text: string, maxW: number, weight: string, size: number, minSize: number, family = SANS): string {
  let s = size;
  ctx.font = `${weight} ${s}px ${family}`;
  while (ctx.measureText(text).width > maxW && s > minSize) ctx.font = `${weight} ${--s}px ${family}`;
  if (ctx.measureText(text).width <= maxW) return text;
  let t = text;
  while (t.length > 1 && ctx.measureText(`${t}…`).width > maxW) t = t.slice(0, -1);
  return `${t}…`;
}

function spaced(ctx: CanvasRenderingContext2D, px: number): void {
  if ("letterSpacing" in ctx) (ctx as CanvasRenderingContext2D & { letterSpacing: string }).letterSpacing = `${px}px`;
}

/** A blank 1200×630 card: night-sky background with neon glows and a frame, as on the site. */
function newCard(): { c: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const c = document.createElement("canvas");
  c.width = CARD_W;
  c.height = CARD_H;
  const ctx = c.getContext("2d")!;
  const bg = ctx.createLinearGradient(0, 0, CARD_W, CARD_H);
  bg.addColorStop(0, "#1a0d3a");
  bg.addColorStop(1, "#0a0718");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, CARD_W, CARD_H);
  for (const [x, y, rad, col] of [[120, 640, 520, "rgba(255,62,219,0.30)"], [1150, -40, 480, "rgba(46,233,255,0.22)"]] as const) {
    const g = ctx.createRadialGradient(x, y, 0, x, y, rad);
    g.addColorStop(0, col);
    g.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, CARD_W, CARD_H);
  }
  ctx.strokeStyle = "rgba(90,70,184,0.18)";
  ctx.lineWidth = 1;
  for (let y = 0; y < CARD_H; y += 6) {
    ctx.beginPath();
    ctx.moveTo(0, y + 0.5);
    ctx.lineTo(CARD_W, y + 0.5);
    ctx.stroke();
  }
  ctx.strokeStyle = "#5a46b8";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.roundRect(20, 20, CARD_W - 40, CARD_H - 40, 22);
  ctx.stroke();
  ctx.textBaseline = "alphabetic";
  return { c, ctx };
}

const X = 64;

function eyebrow(ctx: CanvasRenderingContext2D, text: string, maxW = 700): void {
  spaced(ctx, 4);
  ctx.fillStyle = "#ffb340";
  ctx.font = `700 22px ${MONO}`;
  let t = text;
  while (t.length > 8 && ctx.measureText(t).width > maxW) t = t.slice(0, -2);
  ctx.fillText(t === text ? t : `${t.trimEnd()}…`, X, 86);
  spaced(ctx, 0);
}

function footer(ctx: CanvasRenderingContext2D): void {
  ctx.fillStyle = "#2ee9ff";
  ctx.font = `800 28px ${SANS}`;
  ctx.fillText("opengpubenchmarker.com", X, 590);
  const siteW = ctx.measureText("opengpubenchmarker.com").width;
  ctx.fillStyle = "#8a82b4";
  ctx.font = `500 18px ${SANS}`;
  ctx.fillText("Shared on the honor system", X + siteW + 22, 590);
}

/**
 * QR code on a white panel, top right. ECC M (15%) keeps the code small enough (version 5–7 for one
 * run, up to 10 for two) to scan off a phone screen or screenshot; the 4-module quiet zone is part
 * of the panel. `label` (invite cards) sits above the panel.
 */
function qrPanel(ctx: CanvasRenderingContext2D, url: string, caption: string, label = ""): void {
  const qr = qrEncode(url, { ecc: "M", border: 4 });
  const PANEL = 330;
  const px = CARD_W - 64 - PANEL;
  const py = label ? 104 : 92;
  const mod = Math.floor(PANEL / qr.size);
  const side = mod * qr.size;
  if (label) {
    spaced(ctx, 1);
    ctx.fillStyle = "#2ee9ff";
    const fitted = fitText(ctx, label, PANEL, "800", 20, 14);
    ctx.textAlign = "center";
    ctx.fillText(fitted, px + PANEL / 2, py - 18);
    ctx.textAlign = "start";
    spaced(ctx, 0);
  }
  ctx.save();
  ctx.shadowColor = "rgba(46,233,255,0.55)";
  ctx.shadowBlur = 26;
  ctx.fillStyle = "#ffffff";
  ctx.beginPath();
  ctx.roundRect(px, py, PANEL, PANEL, 14);
  ctx.fill();
  ctx.restore();
  const ox = px + Math.floor((PANEL - side) / 2);
  const oy = py + Math.floor((PANEL - side) / 2);
  ctx.fillStyle = "#0a0718";
  for (let row = 0; row < qr.size; row++)
    for (let col = 0; col < qr.size; col++) if (qr.data[row][col]) ctx.fillRect(ox + col * mod, oy + row * mod, mod, mod);
  ctx.fillStyle = "#b6aedc";
  ctx.font = `600 20px ${SANS}`;
  ctx.textAlign = "center";
  ctx.fillText(caption, px + PANEL / 2, py + PANEL + 38);
  ctx.textAlign = "start";
}

export type CardVariant = "result" | "invite";

/**
 * Draws the 1200×630 card (the link-preview shape: shows uncropped in iMessage, Discord and X).
 * System fonts only, the same stacks as the site, so there is nothing to wait for before drawing.
 * Synchronous on purpose: the share button can build the PNG inside the tap, which Safari needs.
 * The invite variant adds "RUN THE SAME TEST & COMPARE" above the QR code.
 */
export function renderCard(r: SharedRun, url: string, variant: CardVariant = "result"): HTMLCanvasElement {
  const { c, ctx } = newCard();
  const TEXT_W = 700;
  eyebrow(ctx, `NEON FLYTHROUGH · v${r.benchmarkVersion}`);

  // Average FPS, large, with a magenta glow.
  const avg = fps(r.avgFps);
  ctx.font = `800 172px ${SANS}`;
  ctx.save();
  ctx.shadowColor = "rgba(255,62,219,0.85)";
  ctx.shadowBlur = 34;
  ctx.fillStyle = "#ffffff";
  ctx.fillText(avg, X - 6, 240);
  ctx.restore();
  const avgW = ctx.measureText(avg).width;
  spaced(ctx, 3);
  ctx.fillStyle = "#2ee9ff";
  ctx.font = `700 30px ${MONO}`;
  ctx.fillText("AVG FPS", X + avgW + 12, 240);

  // Lows
  let lx = X;
  for (const [label, value] of [["1% LOW", fps(r.p1Low)], ["5% LOW", fps(r.p5Low)]]) {
    spaced(ctx, 2);
    ctx.fillStyle = "#b6aedc";
    ctx.font = `700 20px ${MONO}`;
    ctx.fillText(label, lx, 302);
    spaced(ctx, 0);
    ctx.fillStyle = "#f0ecff";
    ctx.font = `800 48px ${SANS}`;
    ctx.fillText(value, lx, 352);
    lx += Math.max(220, ctx.measureText(value).width + 60);
  }

  // Settings, score, GPU, browser
  ctx.fillStyle = "#f0ecff";
  ctx.fillText(fitText(ctx, settingsLabel(r), TEXT_W, "700", 36, 26), X, 412);
  let y = 412;
  if (r.score !== undefined) {
    y += 40;
    ctx.fillStyle = "#ff3edb";
    ctx.fillText(fitText(ctx, scoreLabel(r), TEXT_W, "700", 30, 22), X, y);
  }
  // GPU, then a small "reported by browser" tag on the same line.
  y += 46;
  const tag = r.device.gpuLabel ? "reported by browser" : "";
  ctx.font = `500 18px ${SANS}`;
  const tagW = tag ? ctx.measureText(tag).width + 14 : 0;
  ctx.fillStyle = "#f0ecff";
  const gpuText = fitText(ctx, r.device.gpuLabel ?? "GPU hidden by the browser", TEXT_W - tagW, "600", 30, 20);
  ctx.fillText(gpuText, X, y);
  if (tag) {
    const gw = ctx.measureText(gpuText).width;
    ctx.fillStyle = "#8a82b4";
    ctx.font = `500 18px ${SANS}`;
    ctx.fillText(tag, X + gw + 14, y);
  }
  y += 40;
  ctx.fillStyle = "#b6aedc";
  ctx.fillText(fitText(ctx, `${browserLabel(r.device)} · ${osLabel(r.device)} · ${r.date}`, TEXT_W, "500", 24, 18), X, y);

  footer(ctx);
  if (variant === "invite") qrPanel(ctx, url, "Scan to run it and compare", "RUN THE SAME TEST & COMPARE");
  else qrPanel(ctx, url, "Scan for the full result");
  return c;
}

/**
 * Two runs side by side. Neutral: neither side is styled as the winner; the faster one only gets a
 * small "▲ 8.9%". `a` is the shared run, `b` the compared run (the link's runs[0] and runs[1]).
 */
export function renderComparisonCard(a: SharedRun, b: SharedRun, url: string): HTMLCanvasElement {
  const { c, ctx } = newCard();
  const cmp = compareRuns(a, b);
  const same = cmp.likeForLike;
  eyebrow(ctx, `${same ? settingsLabel(a) : "Settings differ"} · v${b.benchmarkVersion}`.toUpperCase());
  const COL_W = 330;
  const fasterB = cmp.pct !== null && cmp.pct >= SAME_PCT;
  const fasterA = cmp.pct !== null && cmp.pct <= -SAME_PCT;
  ([[a, "SHARED RUN", fasterA], [b, "COMPARED RUN", fasterB]] as const).forEach(([r, label, faster], i) => {
    const x = X + i * (COL_W + 24);
    spaced(ctx, 3);
    ctx.fillStyle = "#b6aedc";
    ctx.font = `700 18px ${MONO}`;
    ctx.fillText(label, x, 140);
    spaced(ctx, 0);
    const avg = fps(r.avgFps);
    ctx.save();
    ctx.shadowColor = i ? "rgba(46,233,255,0.7)" : "rgba(255,62,219,0.7)";
    ctx.shadowBlur = 24;
    ctx.fillStyle = "#ffffff";
    ctx.font = `800 ${avg.length > 6 ? 76 : 92}px ${SANS}`;
    ctx.fillText(avg, x - 3, 236);
    ctx.restore();
    spaced(ctx, 2);
    ctx.fillStyle = "#2ee9ff";
    ctx.font = `700 18px ${MONO}`;
    ctx.fillText("AVG FPS", x, 268);
    spaced(ctx, 0);
    if (faster && cmp.pct !== null) {
      ctx.fillStyle = "#4dffb4";
      ctx.font = `700 20px ${SANS}`;
      ctx.fillText(`▲ ${Math.abs(cmp.pct).toFixed(1)}%`, x + 110, 268);
    }
    ctx.fillStyle = "#f0ecff";
    ctx.font = `700 26px ${SANS}`;
    ctx.fillText(`1% low ${fps(r.p1Low)}`, x, 314);
    ctx.fillText(fitText(ctx, r.device.gpuLabel ?? "GPU hidden by the browser", COL_W, "600", 24, 16), x, 360);
    ctx.fillStyle = "#b6aedc";
    ctx.fillText(fitText(ctx, `${browserLabel(r.device)} · ${osLabel(r.device)}`, COL_W, "500", 20, 15), x, 392);
    if (!same) ctx.fillText(fitText(ctx, settingsLabel(r), COL_W, "500", 20, 15), x, 422);
  });
  // One neutral line under both: how far apart, and the most useful note.
  const apart = apartLabel(cmp);
  const note = cmp.notes.find((n) => /browser|GPU/.test(n)) ?? (same ? "Same settings" : "Settings differ, so not like-for-like");
  ctx.fillStyle = "#f0ecff";
  ctx.fillText(fitText(ctx, [apart ? apart[0].toUpperCase() + apart.slice(1) : "", note.replace(/\s*\(.*?\)/, "").replace(/\.$/, "")].filter(Boolean).join(" · "), 700, "600", 24, 16), X, 500);
  footer(ctx);
  qrPanel(ctx, url, "Scan for both runs");
  return c;
}

/** PNG File from a canvas, synchronously (toBlob is async and would end the tap's user activation on Safari). */
export function canvasPng(c: HTMLCanvasElement, name: string): File {
  const b64 = c.toDataURL("image/png").split(",")[1];
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new File([bytes], name, { type: "image/png" });
}

export function cardFileName(r: SharedRun): string {
  return `neon-flythrough_${r.resolution}_${r.preset}_${r.date}.png`.replace(/[^\w.-]+/g, "-");
}

export function saveImage(file: File): void {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(file);
  a.download = file.name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

export type ShareOutcome = "shared" | "cancelled" | "copied" | "failed";

/** Link for any payload (result, invite to compare, comparison), on the current origin. */
export function payloadUrl(p: SharePayload): string {
  return `${location.origin}/#/r/${encodeShare(p)}`;
}

/** Just the code (the end of the link), for pasting where a link is awkward. */
export function shareCode(p: SharePayload): string {
  return encodeShare(p);
}

/** Share text and title for a payload (no DOM needed). */
export function shareTexts(p: SharePayload): { text: string; title: string } {
  const [a, b] = p.runs;
  if (p.type === "comparison") return { text: comparisonText(a, b), title: "Neon Flythrough comparison" };
  if (p.type === "challenge") return { text: inviteText(a), title: "Neon Flythrough: compare with this run" };
  return { text: shareText(a), title: "Neon Flythrough result" };
}

/** The card PNG for a payload: Save image and previews only, never attached to a link share. */
export function payloadCard(p: SharePayload): File {
  const url = payloadUrl(p);
  const [a, b] = p.runs;
  if (p.type === "comparison") return canvasPng(renderComparisonCard(a, b, url), cardFileName(b).replace(".png", "_comparison.png"));
  return canvasPng(p.type === "challenge" ? renderCard(a, url, "invite") : renderCard(a, url), cardFileName(a));
}

/**
 * Every Share button in the site goes through here. It shares the LINK (as `url`) and a line of text,
 * and never attaches the card image: when a file is attached, iOS Messages and other apps often send
 * only the picture and drop the link. The card is offered separately (Save image), the one place where
 * an image on its own is what the person asked for. Without a share sheet, the text and link are
 * copied to the clipboard. navigator.share is called before any await, so Safari counts it as part
 * of the tap. tests/share-keeps-link.test.ts and scripts/check-share.mjs guard this.
 */
export function sharePayload(p: SharePayload): { url: string; done: Promise<ShareOutcome> } {
  const url = payloadUrl(p);
  const { text, title } = shareTexts(p);
  const copy = async (): Promise<ShareOutcome> => {
    try {
      await navigator.clipboard.writeText(`${text}\n${url}`);
      return "copied";
    } catch {
      return "failed";
    }
  };
  let done: Promise<ShareOutcome>;
  if (typeof navigator.share === "function")
    done = navigator.share({ title, text, url }).then(
      () => "shared" as const,
      (e: unknown) => ((e as Error)?.name === "AbortError" ? ("cancelled" as const) : copy()),
    );
  else done = copy();
  return { url, done };
}

/** Share one result (Plan 3's Share). */
export function shareRun(r: SharedRun): { url: string; done: Promise<ShareOutcome> } {
  return sharePayload({ type: "result", runs: [r] });
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

// ----- share UI (results page and My Results) -----
/**
 * Share box for the results page. Share my result is the one big action; Copy link, Copy code and
 * Save image sit under it. Comparing is optional and offered as a quiet link, never as a rival button.
 */
export function shareBoxHtml(): string {
  return `<div class="share-box">
    <div class="share-actions">
      <button type="button" class="btn btn-primary btn-share" data-share>Share my result</button>
      <button type="button" class="btn" data-copy-link>Copy link</button>
      <button type="button" class="btn" data-copy-code>Copy code</button>
      <button type="button" class="btn" data-save-card>Save image</button>
    </div>
    <p class="share-status" role="status" aria-live="polite" data-share-status></p>
    <p class="muted tiny">${esc(SHARE_NOTE)} <a href="#/about/sharing">How sharing works →</a></p>
    <details data-card-preview><summary>Preview the share card</summary></details>
  </div>`;
}

const OUTCOME_TEXT: Record<ShareOutcome, string> = {
  shared: "Shared ✓ (link and text). Use Save image if you'd like the card too.",
  cancelled: "",
  copied: "Link and text copied ✓ Paste them anywhere. Use Save image for the card.",
  failed: "Couldn't share or copy here. Use Copy link or Save image.",
};

/** Wire a share box for one run. */
export function bindShareBox(root: HTMLElement, r: SharedRun): void {
  const status = root.querySelector<HTMLElement>("[data-share-status]");
  const say = (text: string, bad = false) => {
    if (!status) return;
    status.textContent = text;
    status.classList.toggle("bad", bad);
  };
  const result: SharePayload = { type: "result", runs: [r] };
  root.querySelector("[data-share]")?.addEventListener("click", () => {
    void sharePayload(result).done.then((o) => say(OUTCOME_TEXT[o], o === "failed"));
  });
  root.querySelector("[data-copy-link]")?.addEventListener("click", async () => {
    const url = payloadUrl(result);
    if (await copyText(url)) say("Link copied ✓");
    else say(`Copy this link: ${url}`, true);
  });
  root.querySelector("[data-copy-code]")?.addEventListener("click", async () => {
    const code = shareCode(result);
    if (await copyText(code)) say("Code copied ✓ Anyone can paste it into “Have a code?” on My Results.");
    else say(`Copy this code: ${code}`, true);
  });
  root.querySelector("[data-save-card]")?.addEventListener("click", () => saveImage(payloadCard(result)));
  const details = root.querySelector<HTMLDetailsElement>("[data-card-preview]");
  details?.addEventListener("toggle", () => {
    if (!details.open || details.querySelector("img")) return;
    const img = document.createElement("img");
    img.className = "card-preview";
    img.alt = `Share card: ${r.avgFps.toFixed(1)} FPS average at ${settingsLabel(r)}`;
    img.width = CARD_W;
    img.height = CARD_H;
    img.src = renderCard(r, payloadUrl(result)).toDataURL("image/png");
    details.append(img);
  });
}
