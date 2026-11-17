// @vitest-environment happy-dom
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import html from "../index.html?raw";
import { renderHistory } from "../src/app/history-view";
import { renderResults } from "../src/app/results-view";
import { clearResults, upsertResult } from "../src/app/store";
import { bindSystemForm, systemFormHtml, type SystemFormApi } from "../src/app/system-form";
import { GPU_CATALOG, GPU_REFERENCES, NOT_LISTED } from "../src/benchmark/catalog";
import { diagnose } from "../src/benchmark/diagnose";
import { toCsv, toDraftYaml, toJson, toYaml } from "../src/benchmark/exporter";
import { submittedGpuId } from "../src/benchmark/fields";
import { applyGuesses, referencesFor } from "../src/benchmark/guess";
import { catalogFile, isCatalogIdShape, type GpuFormFactor } from "../src/benchmark/gpu-id";
import { decodeShare, encodeShare, shareBlocker, sharedRunFrom } from "../src/benchmark/share-codec";
import { emptySystem, type BenchResult, type DeviceContext, type RunDiagnostics, type SystemProbe } from "../src/benchmark/types";
import { submissionWarnings, validateSubmission } from "../src/benchmark/validate";

// What the results page does depends on what the browser reports: a listed product, a known chip with
// one memory size or several, a laptop, a handheld, a masked or unknown GPU. So a bug can hide on
// machines nobody tests with: an unlisted RTX 2080 Ti once crashed the System details form during
// setup. Every GPU the catalog knows, as each kind of browser reports it:
//  - goes through the guesses and everything the page builds from them: validation, YAML, the GPU's
//    catalog file, exports and a share link that decodes;
//  - one of each distinct guess (listed or not, form factor, ID complete or not, how many chips the
//    name matches, OS) goes through the System details form, wired as the page wires it, and every
//    choice in the GPU helper;
//  - and one machine of each kind renders the whole results page, plus My Results.
// (The form or page for every case would be simpler, but happy-dom keeps memory per render that
// Chromium frees: tens of MB per case.)

/** The vendor's prefix the way WebGL reports it. */
function vendorName(vendor: string, name: string): string {
  if (/nvidia/i.test(vendor)) return /^nvidia/i.test(name) ? name : `NVIDIA ${name}`;
  if (/amd|ati/i.test(vendor)) return /^amd/i.test(name) ? name : `AMD ${name}`;
  if (/intel/i.test(vendor)) return /^intel/i.test(name) ? name : `Intel(R) ${name}`;
  return name;
}

interface Case {
  label: string;
  renderer: string;
  os: DeviceContext["os"];
  probe?: Partial<SystemProbe>;
}

const angle = (name: string, rest: string) => `ANGLE (${name.split(" ")[0]}, ${name}${rest})`;

/** Each GPU as Chromium on Windows (desktop, and a laptop on battery) and Chromium and Firefox on Linux report it. */
function gpuCases(id: string, name: string): Case[] {
  return [
    { label: `${id} · Windows Chromium`, renderer: angle(name, " (0x00001E07) Direct3D11 vs_5_0 ps_5_0, D3D11)"), os: "windows", probe: { platformVersion: "19.0.0" } },
    { label: `${id} · Windows laptop on battery`, renderer: angle(name, " Direct3D11 vs_5_0 ps_5_0, D3D11)"), os: "windows", probe: { platformVersion: "10.0.0", battery: { charging: false, level: 0.5 } } },
    { label: `${id} · Linux Chromium`, renderer: angle(name, " (radeonsi navi33 LLVM 19.1.7 DRM 3.61), OpenGL ES 3.2)"), os: "linux" },
    { label: `${id} · Linux Firefox`, renderer: `${name} (radeonsi, navi32, LLVM 19.1.7, DRM 3.61, 6.14.4) Mesa 25.0.4`, os: "linux" },
    // NVIDIA's own Linux driver: GL in Chromium and Firefox, and Chromium's Vulkan backend.
    { label: `${id} · Linux NVIDIA driver`, renderer: `ANGLE (NVIDIA Corporation, ${name}/PCIe/SSE2, OpenGL 4.5.0 NVIDIA 580.95.05)`, os: "linux" },
    { label: `${id} · Linux Firefox NVIDIA driver`, renderer: `${name}/PCIe/SSE2`, os: "linux" },
    { label: `${id} · Linux Vulkan`, renderer: `ANGLE (${name.split(" ")[0]}, Vulkan 1.4.312 (${name} (0x00001E07)), ${name.split(" ")[0]})`, os: "linux" },
  ];
}

/** Common GPUs the catalog doesn't know: nothing is guessed, and the form must still come up whole. */
const NOT_IN_CATALOG = [
  "NVIDIA GeForce GTX 970", "NVIDIA GeForce GTX 960", "NVIDIA GeForce GTX 760", "NVIDIA GeForce GTX TITAN X", "NVIDIA GeForce MX450", "NVIDIA Quadro P2000",
  "NVIDIA RTX A2000 12GB", "NVIDIA T1000", "AMD Radeon(TM) Graphics", "AMD Radeon 780M", "AMD Radeon(TM) Vega 8 Graphics",
  "Intel(R) UHD Graphics 620", "Intel(R) Iris(R) Xe Graphics", "Intel(R) HD Graphics 4000",
];

const OTHER_CASES: Case[] = [
  { label: "masked · Firefox", renderer: "NVIDIA GeForce GTX 980, or similar", os: "windows" },
  { label: "masked · Safari", renderer: "Apple GPU", os: "macos" },
  { label: "Mac Chromium", renderer: "ANGLE (Apple, ANGLE Metal Renderer: Apple M3 Pro, Unspecified Version)", os: "macos" },
  { label: "unknown GPU", renderer: "ANGLE (Moore Threads, MTT S80 Direct3D11 vs_5_0 ps_5_0, D3D11)", os: "windows" },
  { label: "software", renderer: "ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)", os: "linux" },
  { label: "no renderer", renderer: "", os: "windows" },
];

const ALL_CASES: Case[] = [
  ...GPU_REFERENCES.flatMap((g) => gpuCases(g.id, vendorName(g.vendor, g.name))),
  ...GPU_CATALOG.flatMap((g) => gpuCases(g.id, vendorName(g.vendor, g.name))),
  ...NOT_IN_CATALOG.flatMap((name) => gpuCases(name, name)),
  ...OTHER_CASES,
];

/** One of each kind for the whole page: every listed product, one memory size, several, a laptop chip, the rest. */
const PAGE_CASES: Case[] = [
  ...GPU_CATALOG.map((g) => gpuCases(g.id, vendorName(g.vendor, g.name))[0]),
  ...["rtx_2080_ti_11gb", "rtx_5060_ti_16gb", "rtx_4070_laptop_8gb", "rx_7600m_8gb"].flatMap((id) => {
    const g = GPU_REFERENCES.find((x) => x.id === id)!;
    return gpuCases(g.id, vendorName(g.vendor, g.name));
  }),
  ...gpuCases("NVIDIA GeForce GTX 970", "NVIDIA GeForce GTX 970"),
  ...OTHER_CASES,
];

/** What decides the form's path: cases with the same guess take the same code. */
function signature(r: BenchResult): string {
  const s = r.system;
  const kind = s.gpuId === NOT_LISTED ? "unlisted" : s.gpuId ? "listed" : "none";
  const req = !s.gpuIdRequested ? "no-id" : isCatalogIdShape(s.gpuIdRequested) ? "id" : "partial-id";
  const refs = Math.min(referencesFor(s.gpuName).length, 2);
  return [kind, s.gpuFormFactor, req, `refs${refs}`, s.os, !!s.gpuName.trim()].join(" ");
}

function result(c: Case, i: number): BenchResult {
  return {
    id: `m${i}`, gameId: "openbenchmarker_neon_flythrough", benchmarkVersion: "4.0.0", date: "2026-11-17", time: "12:00", resolutionId: "1080p", resolution: "1080p", width: 1920, height: 1080,
    preset: "High", durationS: 60, graphicsApi: "WebGL2", avgFps: 100, p1Low: 80, p5Low: 90, worstMs: 15, frameCount: 6000, loopBusy: 1, timing: "gpu-timer", valid: true, invalidReason: "",
    mobile: false,
    diag: {
      renderer: c.renderer, vendor: "", backend: "", gpuBusy: 0.98, gpuMs: 9, cpuMs: 1, updateMs: 0.4, syncMs: 5, frameMs: 10, stalls: 0, stallMs: 0, hitches: 0, frameStdMs: 0.4, heapGrowthMb: null,
      maxTextureSize: 16384, cpuThreads: 12, onBattery: c.probe?.battery?.charging === false, browser: "Chrome 141", features: { bloom: true, msaa: 4, shadowMap: 2048, reflections: 0, volumetrics: 32, fallbackReason: "" },
    } as RunDiagnostics,
    device: { browser: "chrome", browserMajor: 141, os: c.os, deviceType: "desktop", webkitEngine: false, gpuLabel: null },
    probe: { platformVersion: null, model: null, formFactors: null, deviceMemoryGb: 16, screen: null, battery: null, webgpu: null, ...c.probe },
    system: emptySystem(),
  };
}

const flush = async () => {
  for (let i = 0; i < 3; i++) await Promise.resolve();
};

/** Errors thrown in handlers or logged, while `body` runs. */
async function collectErrors(body: () => Promise<void>): Promise<unknown[]> {
  const errors: unknown[] = [];
  const onError = (e: ErrorEvent) => errors.push(e.error ?? e.message);
  window.addEventListener("error", onError);
  const spy = vi.spyOn(console, "error").mockImplementation((...a) => errors.push(a));
  try {
    await body();
  } finally {
    window.removeEventListener("error", onError);
    spy.mockRestore();
  }
  return errors;
}

/** The dropdowns and the lookup command are filled in: setup ran to the end. */
function expectFormSetUp(form: HTMLFormElement): void {
  const opts = (key: string) => form.querySelectorAll(`[data-combo-select="${key}"] option`).length;
  expect(opts("osDetail")).toBeGreaterThan(2);
  expect(opts("memoryChannels")).toBeGreaterThan(2);
  expect(opts("memoryType")).toBeGreaterThan(2);
  expect(form.querySelector("[data-cmd-all]")!.textContent).toContain("Computer type:");
}

/** Every choice in the GPU helper, one at a time: memory size, maker, form factor. */
async function tryEveryHelperChoice(root: HTMLElement): Promise<void> {
  for (const attr of ["data-helper-base", "data-helper-vram", "data-helper-maker"]) {
    const count = root.querySelector<HTMLSelectElement>(`[${attr}]`)?.options.length ?? 0;
    for (let i = 0; i < count; i++) {
      // The helper redraws itself after each choice.
      const sel = root.querySelector<HTMLSelectElement>(`[${attr}]`);
      if (!sel || i >= sel.options.length) break;
      sel.value = sel.options[i].value;
      sel.dispatchEvent(new Event("input", { bubbles: true }));
      await flush();
    }
  }
  for (const ff of ["laptop", "handheld", "desktop"]) {
    const radio = root.querySelector<HTMLInputElement>(`input[name="helper-ff"][value="${ff}"]`);
    if (!radio) continue;
    radio.checked = true;
    radio.dispatchEvent(new Event("input", { bubbles: true }));
    await flush();
  }
}

/** What the page builds from the result: validation, YAML, the GPU's catalog file, exports and a share link that decodes. */
function buildEverything(r: BenchResult): void {
  const ok = validateSubmission(r).length === 0;
  submissionWarnings(r);
  expect(ok ? toYaml(r) : toDraftYaml(r)).toContain("game_id: openbenchmarker_neon_flythrough");
  const ff = r.system.gpuFormFactor;
  if (r.system.gpuId === NOT_LISTED && (ff === "desktop" || ff === "laptop" || ff === "handheld")) catalogFile(submittedGpuId(r.system), r.system.gpuName, ff as GpuFormFactor);
  toCsv([r]);
  toJson(r);
  diagnose(r);
  const run = sharedRunFrom(r);
  if (!shareBlocker(run)) expect(decodeShare(encodeShare({ type: "result", runs: [run] })).ok).toBe(true);
}

beforeAll(() => {
  // Not under test, and happy-dom has no layout.
  Element.prototype.scrollIntoView = () => {};
});

afterEach(() => {
  clearResults();
});

describe("what the page builds, for every GPU and browser", () => {
  it.each(ALL_CASES.map((c, i) => [c.label, c, i] as const))("%s", (_label, c, i) => {
    const r = applyGuesses(result(c, i));
    buildEverything(r);
    // A guessed ID is always one the page accepts, or none.
    if (r.system.gpuIdRequested && isCatalogIdShape(r.system.gpuIdRequested)) expect(validateSubmission(r).filter((e) => e.startsWith("Requested gpu_id"))).toEqual([]);
  });
});

describe("the System details form, one of each guess", () => {
  const seen = new Set<string>();
  const distinct = ALL_CASES.map((c, i) => [c.label, c, i] as const).filter(([, c, i]) => {
    const sig = signature(applyGuesses(result(c, i)));
    if (seen.has(sig)) return false;
    seen.add(sig);
    return true;
  });

  it("covers the paths that matter", () => {
    // An unlisted GPU with a complete ID (the 2080 Ti), several sizes, a laptop, a listed product, a masked GPU.
    const sigs = [...seen].join("\n");
    expect(sigs).toMatch(/^unlisted desktop id refs1 windows true$/m);
    expect(sigs).toMatch(/^unlisted desktop no-id refs2 windows true$/m);
    expect(sigs).toMatch(/^unlisted laptop id refs1 windows true$/m);
    expect(sigs).toMatch(/^listed/m);
    expect(sigs).toMatch(/^none/m);
  });

  it.each(distinct)("%s", async (_label, c, i) => {
    const r = applyGuesses(result(c, i));
    document.body.innerHTML = systemFormHtml(r);
    const form = document.querySelector<HTMLFormElement>("#sys-form")!;
    let saves = 0;
    const errors = await collectErrors(async () => {
      // As renderResults wires it: save refreshes through the API bindSystemForm returns.
      const api: SystemFormApi = bindSystemForm(form, r, () => {
        api.refresh();
        buildEverything(r);
        saves++;
      });
      api.refresh();
      await flush();
      expectFormSetUp(form);
      expect((form.elements.namedItem("gpuIdRequested") as HTMLInputElement).value).toBe(r.system.gpuIdRequested);
      // A guessed unlisted GPU whose ID is complete has it saved once setup is done.
      if (r.system.gpuId === NOT_LISTED && isCatalogIdShape(r.system.gpuIdRequested)) expect(saves).toBe(1);
      await tryEveryHelperChoice(form.querySelector("#gpu-blocked")!);
      buildEverything(r);
    });
    expect(errors).toEqual([]);
  });
});

describe("the whole results page, one machine of each kind", () => {
  const body = /<body[^>]*>([\s\S]*)<\/body>/i.exec(html)![1].replace(/<script[\s\S]*?<\/script>/gi, "");

  it.each(PAGE_CASES.map((c, i) => [c.label, c, i] as const))("%s", async (_label, c, i) => {
    document.body.innerHTML = body;
    const r = result(c, i);
    upsertResult(r);
    const errors = await collectErrors(async () => {
      renderResults(r);
      await flush();
      const form = document.querySelector<HTMLFormElement>("#sys-form")!;
      expectFormSetUp(form);
      expect(document.querySelector("#yaml-preview")!.textContent).toContain("game_id: openbenchmarker_neon_flythrough");
      await tryEveryHelperChoice(form.querySelector("#gpu-blocked")!);
      // My Results lists it.
      renderHistory();
      await flush();
    });
    expect(errors).toEqual([]);
  });
});

describe("a GPU the catalog doesn't know, typed in by the user, when the result is opened again", () => {
  const body = /<body[^>]*>([\s\S]*)<\/body>/i.exec(html)![1].replace(/<script[\s\S]*?<\/script>/gi, "");
  it.each(gpuCases("NVIDIA GeForce GTX 970", "NVIDIA GeForce GTX 970").map((c, i) => [c.label, c, i] as const))("%s", async (_label, c, i) => {
    document.body.innerHTML = body;
    const r = applyGuesses(result(c, i));
    r.system = { ...r.system, gpuId: NOT_LISTED, gpuName: "NVIDIA GeForce GTX 970", gpuFormFactor: "desktop", gpuIdRequested: "gtx_970_4gb_reference" };
    upsertResult(r);
    const errors = await collectErrors(async () => {
      renderResults(r);
      await flush();
      expectFormSetUp(document.querySelector<HTMLFormElement>("#sys-form")!);
      expect((document.querySelector<HTMLInputElement>('[name="gpuIdRequested"]')!).value).toBe("gtx_970_4gb_reference");
      expect(document.querySelector("#yaml-preview")!.textContent).toContain("gtx_970_4gb_reference");
    });
    expect(errors).toEqual([]);
  });
});
