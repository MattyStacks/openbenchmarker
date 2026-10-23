import { unknownDevice, type BenchResult, type BrowserId, type DeviceContext, type DeviceType, type GraphicsApi, type OsId } from "./types";
import type { TimingMethod } from "./metrics";
import type { PresetId, ResolutionId, ScoreTestId } from "./presets";

// ---------------------------------------------------------------------------
// Share links: a whole result packed into a short URL fragment (#/r/<payload>).
//
// Bit-packed binary, base64url without padding (RFC 4648 §5). Byte 0 is the schema version, and
// each version keeps its own frozen tables and decoder below, so a link made today decodes forever
// even after presets, browsers or durations change elsewhere in the code. A trailing CRC-8 catches
// truncated or mangled links. It is error detection, not security: the format is open, so sharing
// runs on the honor system.
//
// Between the run records and the CRC sits an optional extension section: byte-aligned entries of
// tag (1 byte), length (1 byte) and value. Decoders skip tags they don't know, so new optional
// fields can join links without a version bump; the version byte changes only for breaking changes.
// ---------------------------------------------------------------------------

export const SHARE_SCHEMA_VERSION = 1;

/** Link types. Plan 5 builds the challenge and comparison views; the format reserves them now. */
export type ShareLinkType = "result" | "challenge" | "comparison";

/** One shared run: exactly what the link carries, nothing else. */
export interface SharedRun {
  gameId: string;
  benchmarkVersion: string;
  resolution: ResolutionId;
  width: number;
  height: number;
  preset: PresetId;
  durationS: number;
  scoreTest?: ScoreTestId;
  /** Present only when the run was a valid, exactly-matching score test (score = avg FPS × 100). */
  score?: number;
  avgFps: number;
  p1Low: number;
  p5Low: number;
  worstMs: number;
  frameCount: number;
  timing?: TimingMethod;
  graphicsApi: GraphicsApi;
  /** Local run date YYYY-MM-DD. */
  date: string;
  device: DeviceContext;
}

/** One extension entry. Tag 0 is reserved; no tags are assigned yet (see docs/share-links.md). */
export interface ShareExtension {
  tag: number;
  value: Uint8Array;
}

export interface SharePayload {
  type: ShareLinkType;
  /** One run for result and challenge links, two for comparison links. */
  runs: SharedRun[];
  /** Extension entries in link order, unknown ones included; absent when the link has none. */
  ext?: ShareExtension[];
}

export type DecodeResult = { ok: true; payload: SharePayload } | { ok: false; reason: "damaged" | "newer-version" };

// ----- v1 frozen tables (never reorder; only append into the reserved slots) -----
const V1 = {
  games: ["openbenchmarker_neon_flythrough"],
  resolutions: [
    { id: "720p", w: 1280, h: 720 },
    { id: "1080p", w: 1920, h: 1080 },
    { id: "1440p", w: 2560, h: 1440 },
    { id: "4K", w: 3840, h: 2160 },
  ] as { id: ResolutionId; w: number; h: number }[],
  presets: ["Low", "Medium", "High", "Ultra", "Extreme"] as PresetId[],
  durations: [30, 60, 90],
  scoreTests: [undefined, "entry", "extreme"] as (ScoreTestId | undefined)[],
  timing: [undefined, "gpu-timer", "batch-avg"] as (TimingMethod | undefined)[],
  apis: ["WebGL2", "WebGL1"] as GraphicsApi[],
  browsers: ["other", "chrome", "edge", "brave", "firefox", "safari", "opera", "vivaldi", "samsung"] as BrowserId[],
  os: ["other", "windows", "macos", "linux", "chromeos", "android", "ios"] as OsId[],
  deviceTypes: ["unknown", "phone", "tablet", "desktop"] as DeviceType[],
  linkTypes: ["result", "challenge", "comparison"] as ShareLinkType[],
};

/**
 * v1 layout, most significant bit first. Header: version (8), link type (2), reserved (6).
 * Then one record per run (two for comparison), then CRC-8 over every byte before it.
 * See docs/share-links.md for the table with ranges and scales.
 */
const BITS = {
  game: 4,
  verMajor: 4,
  verMinor: 6,
  verPatch: 6,
  resolution: 3,
  preset: 3,
  duration: 2,
  scoreTest: 2,
  scored: 1,
  avg: 24, // 0.01 FPS: 0–167,772.15 (also gives the score exactly: score = round(avg × 100))
  low: 20, // 0.1 FPS: 0–104,857.5
  worst: 20, // 0.01 ms: 0–10,485.75 ms
  frames: 24, // 0–16,777,215
  timing: 2,
  api: 1,
  days: 16, // days since 1970-01-01: to 2149
  browser: 4,
  browserMajor: 10, // 0 = unknown, 1–1023
  os: 3,
  deviceType: 2,
  webkit: 1,
  gpuLen: 6, // UTF-8 bytes of the browser-reported GPU, 0–63; the bytes follow
} as const;

const MAX_GPU_BYTES = (1 << BITS.gpuLen) - 1;
const EARLIEST_DAY = Math.floor(Date.UTC(2024, 0, 1) / 86400000);

// ----- bit I/O -----
class BitWriter {
  private bits: number[] = [];
  put(value: number, n: number): void {
    const v = Math.max(0, Math.min(Math.round(value), 2 ** n - 1));
    for (let i = n - 1; i >= 0; i--) this.bits.push(Math.floor(v / 2 ** i) % 2);
  }
  bytes(): number[] {
    const out: number[] = [];
    for (let i = 0; i < this.bits.length; i += 8) {
      let b = 0;
      for (let k = 0; k < 8; k++) b = (b << 1) | (this.bits[i + k] ?? 0);
      out.push(b);
    }
    return out;
  }
}

class BitReader {
  private pos = 0;
  constructor(private readonly data: Uint8Array) {}
  get(n: number): number {
    if (this.pos + n > this.data.length * 8) throw new RangeError("truncated");
    let v = 0;
    for (let i = 0; i < n; i++, this.pos++) v = v * 2 + ((this.data[this.pos >> 3] >> (7 - (this.pos & 7))) & 1);
    return v;
  }
  /** Skip to the next byte boundary; true when the skipped padding bits were all zero. */
  alignZero(): boolean {
    const n = (8 - (this.pos & 7)) & 7;
    return n === 0 || this.get(n) === 0;
  }
  /** Byte offset; only meaningful after alignZero(). */
  byteOffset(): number {
    return this.pos >> 3;
  }
}

/** CRC-8/SMBUS (poly 0x07, init 0). */
export function crc8(bytes: ArrayLike<number>): number {
  let c = 0;
  for (let i = 0; i < bytes.length; i++) {
    c ^= bytes[i];
    for (let k = 0; k < 8; k++) c = c & 0x80 ? ((c << 1) ^ 0x07) & 0xff : (c << 1) & 0xff;
  }
  return c;
}

export function toBase64Url(bytes: ArrayLike<number>): string {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function fromBase64Url(s: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]*$/.test(s) || s.length % 4 === 1) return null;
  try {
    const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4));
    return Uint8Array.from(bin, (c) => c.charCodeAt(0));
  } catch {
    return null;
  }
}

function utf8Capped(s: string, max: number): number[] {
  const out: number[] = [];
  for (const ch of s) {
    const b = new TextEncoder().encode(ch);
    if (out.length + b.length > max) break;
    out.push(...b);
  }
  return out;
}

const dayOf = (date: string): number | null => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  return m ? Math.floor(Date.UTC(+m[1], +m[2] - 1, +m[3]) / 86400000) : null;
};
const dateOf = (day: number): string => new Date(day * 86400000).toISOString().slice(0, 10);

function parseVersion(v: string): [number, number, number] | null {
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(v);
  if (!m) return null;
  const [a, b, c] = [+m[1], +m[2], +m[3]];
  return a < 16 && b < 64 && c < 64 ? [a, b, c] : null;
}

/** The fields of a saved result that go into a link. Nothing from `system`, `diag` or `id`. */
export function sharedRunFrom(r: BenchResult): SharedRun & { valid: boolean } {
  return {
    valid: r.valid,
    gameId: r.gameId,
    benchmarkVersion: r.benchmarkVersion,
    resolution: r.resolutionId,
    width: r.width,
    height: r.height,
    preset: r.preset,
    durationS: r.durationS,
    ...(r.scoreTest ? { scoreTest: r.scoreTest } : {}),
    ...(r.score !== undefined ? { score: r.score } : {}),
    avgFps: r.avgFps,
    p1Low: r.p1Low,
    p5Low: r.p5Low,
    worstMs: r.worstMs,
    frameCount: r.frameCount,
    ...(r.timing ? { timing: r.timing } : {}),
    graphicsApi: r.graphicsApi,
    date: r.date,
    device: r.device ?? unknownDevice(),
  };
}

/** Why a run can't be shared, or null when it can. Only valid runs at a standard size qualify. */
export function shareBlocker(r: SharedRun & { valid?: boolean }): string | null {
  if (r.valid === false) return "Only valid runs can be shared.";
  if (!V1.games.includes(r.gameId)) return "Unknown benchmark.";
  if (!parseVersion(r.benchmarkVersion)) return "Unknown benchmark version.";
  const res = V1.resolutions.find((x) => x.id === r.resolution);
  if (!res || res.w !== r.width || res.h !== r.height) return "Only 720p, 1080p, 1440p and 4K runs can be shared.";
  if (!V1.presets.includes(r.preset)) return "Unknown preset.";
  if (!V1.durations.includes(r.durationS)) return "Unknown run length.";
  if (!(r.avgFps > 0 && r.frameCount > 0)) return "No timed frames.";
  if (dayOf(r.date) === null) return "Unknown run date.";
  return null;
}

function writeRun(w: BitWriter, r: SharedRun): void {
  const [ma, mi, pa] = parseVersion(r.benchmarkVersion)!;
  const d = r.device;
  w.put(V1.games.indexOf(r.gameId), BITS.game);
  w.put(ma, BITS.verMajor);
  w.put(mi, BITS.verMinor);
  w.put(pa, BITS.verPatch);
  w.put(V1.resolutions.findIndex((x) => x.id === r.resolution), BITS.resolution);
  w.put(V1.presets.indexOf(r.preset), BITS.preset);
  w.put(V1.durations.indexOf(r.durationS), BITS.duration);
  w.put(Math.max(0, V1.scoreTests.indexOf(r.scoreTest)), BITS.scoreTest);
  w.put(r.score !== undefined ? 1 : 0, BITS.scored);
  w.put(r.avgFps * 100, BITS.avg);
  w.put(r.p1Low * 10, BITS.low);
  w.put(r.p5Low * 10, BITS.low);
  w.put(r.worstMs * 100, BITS.worst);
  w.put(r.frameCount, BITS.frames);
  w.put(Math.max(0, V1.timing.indexOf(r.timing)), BITS.timing);
  w.put(Math.max(0, V1.apis.indexOf(r.graphicsApi)), BITS.api);
  w.put(dayOf(r.date)!, BITS.days);
  w.put(Math.max(0, V1.browsers.indexOf(d.browser)), BITS.browser);
  w.put(d.browserMajor ?? 0, BITS.browserMajor);
  w.put(Math.max(0, V1.os.indexOf(d.os)), BITS.os);
  w.put(Math.max(0, V1.deviceTypes.indexOf(d.deviceType)), BITS.deviceType);
  w.put(d.webkitEngine ? 1 : 0, BITS.webkit);
  const gpu = utf8Capped(d.gpuLabel ?? "", MAX_GPU_BYTES);
  w.put(gpu.length, BITS.gpuLen);
  for (const b of gpu) w.put(b, 8);
}

/** Encode runs into the payload part of the link. Throws if a run can't be shared (check shareBlocker first). */
export function encodeShare(payload: SharePayload): string {
  const want = payload.type === "comparison" ? 2 : 1;
  if (payload.runs.length !== want) throw new Error(`${payload.type} links carry ${want} run(s)`);
  for (const r of payload.runs) {
    const why = shareBlocker(r);
    if (why) throw new Error(why);
  }
  const w = new BitWriter();
  w.put(SHARE_SCHEMA_VERSION, 8);
  w.put(V1.linkTypes.indexOf(payload.type), 2);
  w.put(0, 6);
  for (const r of payload.runs) writeRun(w, r);
  const bytes = w.bytes();
  for (const e of payload.ext ?? []) {
    if (!(Number.isInteger(e.tag) && e.tag >= 1 && e.tag <= 255) || e.value.length > 255) throw new Error("Bad share extension entry");
    bytes.push(e.tag, e.value.length, ...e.value);
  }
  bytes.push(crc8(bytes));
  return toBase64Url(bytes);
}

function readRunV1(rd: BitReader): SharedRun | null {
  const at = <T>(list: readonly T[], i: number): T | null => (i < list.length ? list[i] : null);
  const game = at(V1.games, rd.get(BITS.game));
  const version = `${rd.get(BITS.verMajor)}.${rd.get(BITS.verMinor)}.${rd.get(BITS.verPatch)}`;
  const res = at(V1.resolutions, rd.get(BITS.resolution));
  const preset = at(V1.presets, rd.get(BITS.preset));
  const duration = at(V1.durations, rd.get(BITS.duration));
  const stIndex = rd.get(BITS.scoreTest);
  const scored = rd.get(BITS.scored) === 1;
  const avg100 = rd.get(BITS.avg);
  const p1 = rd.get(BITS.low) / 10;
  const p5 = rd.get(BITS.low) / 10;
  const worstMs = rd.get(BITS.worst) / 100;
  const frames = rd.get(BITS.frames);
  const tIndex = rd.get(BITS.timing);
  const api = V1.apis[rd.get(BITS.api)];
  const day = rd.get(BITS.days);
  const browser = at(V1.browsers, rd.get(BITS.browser));
  const browserMajor = rd.get(BITS.browserMajor) || null;
  const os = at(V1.os, rd.get(BITS.os));
  const deviceType = V1.deviceTypes[rd.get(BITS.deviceType)];
  const webkitEngine = rd.get(BITS.webkit) === 1;
  const gpuBytes = new Uint8Array(rd.get(BITS.gpuLen));
  for (let i = 0; i < gpuBytes.length; i++) gpuBytes[i] = rd.get(8);
  let gpuLabel: string | null = null;
  if (gpuBytes.length) {
    try {
      gpuLabel = new TextDecoder("utf-8", { fatal: true }).decode(gpuBytes);
    } catch {
      return null;
    }
  }
  if (!game || !res || !preset || duration === null || stIndex >= V1.scoreTests.length || tIndex >= V1.timing.length || !browser || !os) return null;
  if (scored && stIndex === 0) return null;
  return {
    gameId: game,
    benchmarkVersion: version,
    resolution: res.id,
    width: res.w,
    height: res.h,
    preset,
    durationS: duration,
    ...(stIndex ? { scoreTest: V1.scoreTests[stIndex] } : {}),
    ...(scored ? { score: avg100 } : {}),
    avgFps: avg100 / 100,
    p1Low: p1,
    p5Low: p5,
    worstMs,
    frameCount: frames,
    ...(tIndex ? { timing: V1.timing[tIndex] } : {}),
    graphicsApi: api,
    date: dateOf(day),
    device: { browser, browserMajor, os, deviceType, webkitEngine, gpuLabel },
  };
}

/**
 * Checks a real run always passes (see computeRunStats in metrics.ts): every frame time is at
 * least its share of the wall-clock, so 1% low ≤ 5% low ≤ average and the worst frame is no faster
 * than the 1% low. Timed wall-clock (frames / average) runs from the requested duration up to the
 * batches still queued when it ends: at most three in flight (MAX_IN_FLIGHT in run.ts), each at
 * least one frame, plus scheduling slack. Tolerances cover the link's rounding (0.01 / 0.1 FPS).
 */
export function plausible(r: SharedRun, today = new Date()): boolean {
  const lowSlack = 0.05 + 1e-9;
  if (!(r.avgFps > 0 && r.p1Low > 0 && r.frameCount > 0 && r.worstMs > 0)) return false;
  if (r.p1Low > r.avgFps + lowSlack || r.p5Low > r.avgFps + lowSlack || r.p5Low + 1e-9 < r.p1Low) return false;
  if (1000 / r.worstMs > r.p1Low + lowSlack + r.p1Low * 0.001) return false;
  const wallS = r.frameCount / r.avgFps;
  const frameS = 1 / r.avgFps;
  if (wallS < r.durationS * 0.99 || wallS > r.durationS * 1.01 + 2 + 4 * frameS) return false;
  const day = dayOf(r.date)!;
  const todayDay = Math.floor(today.getTime() / 86400000);
  if (day < EARLIEST_DAY || day > todayDay + 1) return false; // +1: the run date is local, today is UTC
  if (r.score !== undefined && r.score !== Math.round(r.avgFps * 100)) return false;
  return true;
}

export function decodeShare(s: string, today = new Date()): DecodeResult {
  const text = s.trim();
  const bytes = fromBase64Url(text);
  // Canonical only: the last character's spare bits must be zero, so each payload has one spelling.
  if (!bytes || bytes.length < 3 || toBase64Url(bytes) !== text) return { ok: false, reason: "damaged" };
  if (bytes[0] > SHARE_SCHEMA_VERSION) return { ok: false, reason: "newer-version" };
  if (bytes[0] !== 1) return { ok: false, reason: "damaged" };
  const body = bytes.subarray(0, bytes.length - 1);
  if (crc8(body) !== bytes[bytes.length - 1]) return { ok: false, reason: "damaged" };
  try {
    const rd = new BitReader(body);
    rd.get(8);
    const type = V1.linkTypes[rd.get(2)];
    if (!type || rd.get(6) !== 0) return { ok: false, reason: "damaged" };
    const runs: SharedRun[] = [];
    for (let i = 0; i < (type === "comparison" ? 2 : 1); i++) {
      const r = readRunV1(rd);
      if (!r || !plausible(r, today)) return { ok: false, reason: "damaged" };
      runs.push(r);
    }
    // Zero padding to a byte boundary, then extension entries (if any) up to the CRC.
    if (!rd.alignZero()) return { ok: false, reason: "damaged" };
    const ext: ShareExtension[] = [];
    for (let i = rd.byteOffset(); i < body.length; ) {
      const tag = body[i];
      const len = body[i + 1];
      if (tag === 0 || len === undefined || i + 2 + len > body.length) return { ok: false, reason: "damaged" };
      ext.push({ tag, value: body.slice(i + 2, i + 2 + len) });
      i += 2 + len;
    }
    return { ok: true, payload: { type, runs, ...(ext.length ? { ext } : {}) } };
  } catch {
    return { ok: false, reason: "damaged" };
  }
}

/**
 * The code from whatever someone pasted: a bare code, "#/r/<code>", or a full link from any host.
 * Chat apps add spaces, line breaks and trailing punctuation; all of that is dropped. Returns ""
 * when there's nothing that looks like a code (decodeShare then reports it as damaged).
 */
export function extractShareCode(text: string): string {
  const s = String(text ?? "").replace(/\s+/g, "");
  const m = /#\/r\/([A-Za-z0-9_-]+)/.exec(s);
  if (m) return m[1];
  const bare = /^[A-Za-z0-9_-]+/.exec(s.replace(/^[<("'`]+/, ""));
  return bare ? bare[0] : "";
}
