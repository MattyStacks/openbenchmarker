import { NOT_LISTED, findGpu } from "./catalog";
import { OVERCLOCK_FIELDS } from "./fields";
import { unknownDevice, type BenchResult, type BrowserId, type DeviceContext, type DeviceType, type GraphicsApi, type OsId } from "./types";
import type { TimingMethod } from "./metrics";
import { STRESS_LAP_SECONDS, getStressTest, stressDuration, type PresetId, type ResolutionId, type ScoreTestId, type StressTestId } from "./presets";

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
  /** A finished stress test: which one, and every lap's avg FPS in order (durationS = laps × 96 s). */
  stress?: { test: StressTestId; laps: number[] };
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
  /** The catalog GPU the sharer picked on the results form (unlike device.gpuLabel, which the browser reports). */
  gpuId?: string;
  /** Whether the sharer said the GPU was overclocked, and what they raised (only when it was). */
  overclock?: SharedOverclock;
}

export interface SharedOverclock {
  overclocked: boolean;
  coreMhz?: number;
  memoryMhz?: number;
  powerPct?: number;
}

/** One extension entry. Tag 0 is reserved; tag 1 is the stress laps, tag 2 the sharer's GPU and overclock (see docs/share-links.md). */
export interface ShareExtension {
  tag: number;
  value: Uint8Array;
}

export interface SharePayload {
  type: ShareLinkType;
  /** One run for result and challenge links, two for comparison links. */
  runs: SharedRun[];
  /** Extension entries in link order, unknown ones included (the stress entries become `runs[i].stress`); absent when there are none. */
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
  durations: [30, 60, 90], // slot 3 (STRESS_SLOT): a stress test, its length in the stress entry
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

/** Duration slot meaning "stress test": the run's laps (and so its length) are in a stress entry. */
const STRESS_SLOT = 3;
/**
 * Extension tag of a stress entry. Value: one head byte, bit 7 = run index (0 or 1), bit 6 = laps
 * in whole FPS instead of 0.1 FPS (only past 6,553.5 FPS), bits 5-0 = test (1 entry, 2 extreme);
 * then each lap's avg FPS as 2 bytes, big-endian. The lap count is the entry length; a lap is
 * STRESS_LAP_SECONDS (a different lap length would be a new test). Kept tight so a result link
 * stays at QR version 7.
 */
export const STRESS_TAG = 1;
const STRESS_TESTS_V1: StressTestId[] = ["entry", "extreme"];
/** Largest lap FPS a stress entry holds (2 bytes of whole FPS). */
const MAX_LAP_FPS = 2 ** 16 - 1;
/**
 * Extension tag of a GPU entry: what the sharer filled in about the GPU. Value: one head byte,
 * bit 7 = run index, bit 4 = power limit follows, bit 3 = memory offset follows, bit 2 = core offset
 * follows, bits 1-0 = overclocked (0 not said, 1 no, 2 yes); then the core and memory clock offsets
 * in MHz as signed 2-byte big-endian, the power limit in % as 2 bytes, each only when its bit is
 * set (and only with overclocked yes); then the catalog gpu_id, 6 bits per character from
 * GPU_ID_CHARS, to the end of the entry, the last byte padded with 1 bits.
 */
export const GPU_TAG = 2;
const GPU_ID_CHARS = "abcdefghijklmnopqrstuvwxyz0123456789_.-";
const GPU_ID_RE = /^[a-z0-9][a-z0-9_.-]{0,62}$/;

function packGpuId(id: string): number[] {
  const w = new BitWriter();
  for (const ch of id) w.put(GPU_ID_CHARS.indexOf(ch), 6);
  const n = (8 - ((id.length * 6) % 8)) % 8;
  if (n) w.put(2 ** n - 1, n);
  return w.bytes();
}

/** The id packed in `v`, or null when it isn't canonically packed. */
function unpackGpuId(v: Uint8Array): string | null {
  const rd = new BitReader(v);
  let id = "";
  for (let left = v.length * 8; left >= 6; left -= 6) {
    const c = rd.get(6);
    // A whole padding group only ever ends the entry.
    if (c === 63) return left === 6 ? id : null;
    if (c >= GPU_ID_CHARS.length) return null;
    id += GPU_ID_CHARS[c];
  }
  const rest = (v.length * 8) % 6;
  return rest && rd.get(rest) !== 2 ** rest - 1 ? null : id;
}
const OC_STATE = [undefined, false, true] as const;
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

/** The sharer's catalog GPU and overclock, from the results form: only valid values go in a link. */
function sharedSystem(r: BenchResult): Pick<SharedRun, "gpuId" | "overclock"> {
  const s = r.system;
  if (!s) return {};
  // A catalog pick, or the requested id of a GPU that isn't listed yet (readers show the id).
  const picked = s.gpuId === NOT_LISTED ? (s.gpuIdRequested ?? "").trim() : findGpu(s.gpuId) ? s.gpuId : "";
  const gpuId = GPU_ID_RE.test(picked) ? picked : undefined;
  let overclock: SharedOverclock | undefined;
  if (s.overclocked === "no") overclock = { overclocked: false };
  else if (s.overclocked === "yes") {
    overclock = { overclocked: true };
    const keys = { ocCoreMhz: "coreMhz", ocMemoryMhz: "memoryMhz", ocPowerPct: "powerPct" } as const;
    for (const f of OVERCLOCK_FIELDS) {
      const v = (s[f.key] ?? "").trim();
      if (v && !f.validate?.(v)) overclock[keys[f.key as keyof typeof keys]] = Number(v);
    }
  }
  return { ...(gpuId ? { gpuId } : {}), ...(overclock ? { overclock } : {}) };
}

/**
 * The fields of a saved result that go into a link. From `system`, only the catalog GPU and the
 * overclock details; nothing from `diag`, nor the `id`.
 */
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
    ...(r.stressTest && r.laps ? { stress: { test: r.stressTest, laps: r.laps.map((l) => l.avgFps) } } : {}),
    avgFps: r.avgFps,
    p1Low: r.p1Low,
    p5Low: r.p5Low,
    worstMs: r.worstMs,
    frameCount: r.frameCount,
    ...(r.timing ? { timing: r.timing } : {}),
    graphicsApi: r.graphicsApi,
    date: r.date,
    device: r.device ?? unknownDevice(),
    ...sharedSystem(r),
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
  if (r.stress) {
    const t = getStressTest(r.stress.test);
    if (!t || !STRESS_TESTS_V1.includes(t.id)) return "Unknown stress test.";
    if (r.scoreTest || r.score !== undefined) return "A run can't be both a score run and a stress test.";
    if (r.preset !== t.preset || r.resolution !== t.resolution || r.stress.laps.length !== t.laps || r.durationS !== stressDuration(t.laps))
      return "Only finished stress tests can be shared.";
    if (!r.stress.laps.every((x) => x > 0 && x <= MAX_LAP_FPS)) return "No timed frames.";
  } else if (!V1.durations.includes(r.durationS)) return "Unknown run length.";
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
  w.put(r.stress ? STRESS_SLOT : V1.durations.indexOf(r.durationS), BITS.duration);
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

const withLength = (value: number[]) => [value.length, ...value];

function stressEntry(runIndex: number, st: NonNullable<SharedRun["stress"]>): number[] {
  const coarse = st.laps.some((fps) => Math.round(fps * 10) > 0xffff);
  const out = [(runIndex << 7) | (coarse ? 0x40 : 0) | (STRESS_TESTS_V1.indexOf(st.test) + 1)];
  for (const fps of st.laps) {
    const v = Math.min(0xffff, Math.round(coarse ? fps : fps * 10));
    out.push(v >> 8, v & 0xff);
  }
  return out;
}

/** A stress entry's value, or null when it is malformed. */
function readStressEntry(v: Uint8Array): { runIndex: number; stress: NonNullable<SharedRun["stress"]> } | null {
  if (v.length < 3 || v.length % 2 === 0) return null;
  const test = STRESS_TESTS_V1[(v[0] & 0x3f) - 1];
  if (!test) return null;
  const scale = v[0] & 0x40 ? 1 : 10;
  const laps: number[] = [];
  for (let i = 1; i < v.length; i += 2) laps.push(((v[i] << 8) | v[i + 1]) / scale);
  return { runIndex: v[0] >> 7, stress: { test, laps } };
}

const int16 = (v: number) => {
  const x = Math.max(-0x8000, Math.min(0x7fff, Math.round(v))) & 0xffff;
  return [x >> 8, x & 0xff];
};

/** A GPU entry for a run, or null when the sharer filled in nothing that goes in a link. */
function gpuEntry(runIndex: number, r: SharedRun): number[] | null {
  const oc = r.overclock;
  const id = r.gpuId && GPU_ID_RE.test(r.gpuId) ? r.gpuId : "";
  if (!oc && !id) return null;
  const yes = oc?.overclocked === true;
  const core = yes && oc.coreMhz !== undefined;
  const mem = yes && oc.memoryMhz !== undefined;
  const power = yes && oc.powerPct !== undefined;
  const out = [(runIndex << 7) | (power ? 0x10 : 0) | (mem ? 0x08 : 0) | (core ? 0x04 : 0) | (oc ? (yes ? 2 : 1) : 0)];
  if (core) out.push(...int16(oc.coreMhz!));
  if (mem) out.push(...int16(oc.memoryMhz!));
  if (power) out.push(...int16(Math.min(oc.powerPct!, 0x7fff)));
  out.push(...packGpuId(id));
  return out;
}

/** A GPU entry's value, or null when it is malformed. */
function readGpuEntry(v: Uint8Array): { runIndex: number; gpuId?: string; overclock?: SharedOverclock } | null {
  if (v.length < 1 || v[0] & 0x60) return null;
  const state = OC_STATE[v[0] & 0x03];
  if ((v[0] & 0x03) === 3 || (state !== true && v[0] & 0x1c)) return null;
  let i = 1;
  const next = (): number | null => {
    if (i + 2 > v.length) return null;
    const x = (v[i] << 8) | v[i + 1];
    i += 2;
    return x & 0x8000 ? x - 0x10000 : x;
  };
  const overclock: SharedOverclock | undefined = state === undefined ? undefined : { overclocked: state };
  for (const [bit, key] of [[0x04, "coreMhz"], [0x08, "memoryMhz"], [0x10, "powerPct"]] as const) {
    if (!(v[0] & bit)) continue;
    const x = next();
    if (x === null) return null;
    overclock![key] = x;
  }
  const id = unpackGpuId(v.subarray(i));
  if (id === null || (id && !GPU_ID_RE.test(id))) return null;
  if (!id && !overclock) return null;
  return { runIndex: v[0] >> 7, ...(id ? { gpuId: id } : {}), ...(overclock ? { overclock } : {}) };
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
  payload.runs.forEach((r, i) => {
    if (r.stress) bytes.push(STRESS_TAG, ...withLength(stressEntry(i, r.stress)));
  });
  payload.runs.forEach((r, i) => {
    const g = gpuEntry(i, r);
    if (g) bytes.push(GPU_TAG, ...withLength(g));
  });
  for (const e of payload.ext ?? []) {
    if (!(Number.isInteger(e.tag) && e.tag >= 1 && e.tag <= 255) || e.tag === STRESS_TAG || e.tag === GPU_TAG || e.value.length > 255) throw new Error("Bad share extension entry");
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
  const durationIndex = rd.get(BITS.duration);
  // A stress run's length comes from its stress entry (0 until decodeShare attaches it).
  const duration = durationIndex === STRESS_SLOT ? 0 : at(V1.durations, durationIndex);
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
  if (!(r.avgFps > 0 && r.p1Low > 0 && r.frameCount > 0 && r.worstMs > 0 && r.durationS > 0)) return false;
  if (r.p1Low > r.avgFps + lowSlack || r.p5Low > r.avgFps + lowSlack || r.p5Low + 1e-9 < r.p1Low) return false;
  if (1000 / r.worstMs > r.p1Low + lowSlack + r.p1Low * 0.001) return false;
  const wallS = r.frameCount / r.avgFps;
  const frameS = 1 / r.avgFps;
  if (wallS < r.durationS * 0.99 || wallS > r.durationS * 1.01 + 2 + 4 * frameS) return false;
  const day = dayOf(r.date)!;
  const todayDay = Math.floor(today.getTime() / 86400000);
  if (day < EARLIEST_DAY || day > todayDay + 1) return false; // +1: the run date is local, today is UTC
  if (r.score !== undefined && r.score !== Math.round(r.avgFps * 100)) return false;
  if (r.stress) {
    // The locked test, every lap, and lap throughputs that average to the run's (laps are equal
    // wall-clock, so their mean is the run's avg FPS up to a few batches and the link's 0.1 FPS laps).
    const t = getStressTest(r.stress.test);
    if (!t || r.scoreTest || r.score !== undefined) return false;
    if (r.preset !== t.preset || r.resolution !== t.resolution || r.stress.laps.length !== t.laps || r.durationS !== stressDuration(t.laps)) return false;
    if (!r.stress.laps.every((x) => x > 0)) return false;
    const mean = r.stress.laps.reduce((a, b) => a + b, 0) / r.stress.laps.length;
    if (Math.abs(mean - r.avgFps) > r.avgFps * 0.01 + 0.05) return false;
  }
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
      if (!r) return { ok: false, reason: "damaged" };
      runs.push(r);
    }
    // Zero padding to a byte boundary, then extension entries (if any) up to the CRC.
    if (!rd.alignZero()) return { ok: false, reason: "damaged" };
    const ext: ShareExtension[] = [];
    for (let i = rd.byteOffset(); i < body.length; ) {
      const tag = body[i];
      const len = body[i + 1];
      if (tag === 0 || len === undefined || i + 2 + len > body.length) return { ok: false, reason: "damaged" };
      const value = body.slice(i + 2, i + 2 + len);
      i += 2 + len;
      if (tag === GPU_TAG) {
        // The sharer's GPU and overclock; at most one per run.
        const g = readGpuEntry(value);
        const r = g ? runs[g.runIndex] : undefined;
        if (!g || !r || r.gpuId !== undefined || r.overclock) return { ok: false, reason: "damaged" };
        if (g.gpuId) r.gpuId = g.gpuId;
        if (g.overclock) r.overclock = g.overclock;
        continue;
      }
      if (tag !== STRESS_TAG) {
        ext.push({ tag, value });
        continue;
      }
      // Stress laps for a run whose duration slot says "stress test"; at most one per run.
      const e = readStressEntry(value);
      const r = e ? runs[e.runIndex] : undefined;
      if (!e || !r || r.durationS !== 0 || r.stress) return { ok: false, reason: "damaged" };
      r.stress = e.stress;
      r.durationS = e.stress.laps.length * STRESS_LAP_SECONDS;
    }
    if (!runs.every((r) => plausible(r, today))) return { ok: false, reason: "damaged" };
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
