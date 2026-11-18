// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { bindSystemForm, systemFormHtml, type SystemFormApi } from "../src/app/system-form";
import { NOT_LISTED } from "../src/benchmark/catalog";
import { catalogFile } from "../src/benchmark/gpu-id";
import { validateSubmission } from "../src/benchmark/validate";
import { applyGuesses } from "../src/benchmark/guess";
import { emptySystem, type BenchResult, type RunDiagnostics } from "../src/benchmark/types";

// A GPU the browser names, with a reference file but no listed product (the RTX 2080 Ti), opens the
// GPU helper on it while the form is being set up, and the helper saves the ID it builds. The
// caller's save refreshes the form through the API bindSystemForm returns, as results-view does, so
// a save during setup used to throw (TDZ) and leave the dropdowns, commands and handlers unset.

const RTX_2080TI = "ANGLE (NVIDIA, NVIDIA GeForce RTX 2080 Ti (0x00001E07) Direct3D11 vs_5_0 ps_5_0, D3D11)";

function run(renderer = RTX_2080TI): BenchResult {
  return {
    id: "ti", gameId: "x", benchmarkVersion: "4.0.0", date: "2026-11-17", time: "12:00", resolutionId: "1080p", resolution: "1080p", width: 1920, height: 1080,
    preset: "High", durationS: 60, graphicsApi: "WebGL2", avgFps: 100, p1Low: 80, p5Low: 90, worstMs: 15, frameCount: 6000, loopBusy: 1, valid: true, invalidReason: "",
    diag: { renderer, vendor: "" } as RunDiagnostics,
    device: { browser: "edge", browserMajor: 141, os: "windows", deviceType: "desktop", webkitEngine: false, gpuLabel: null },
    system: emptySystem(),
  };
}

/** Mounts and binds the form the way renderResults does: save goes back through the returned API, and the page refreshes once bound. */
function mount(r: BenchResult) {
  document.body.innerHTML = systemFormHtml(r);
  const form = document.querySelector<HTMLFormElement>("#sys-form")!;
  const saves: string[] = [];
  const api: SystemFormApi = bindSystemForm(form, r, () => {
    api.refresh();
    saves.push(r.system.gpuIdRequested);
  });
  api.refresh();
  return { form, api, saves };
}

const options = (form: HTMLFormElement, key: string) => [...form.querySelectorAll<HTMLOptionElement>(`[data-combo-select="${key}"] option`)].map((o) => o.textContent);

describe("binding the system form on a guessed GPU that isn't listed", () => {
  for (const [label, prepare] of [
    ["a fresh run's guess", (r: BenchResult) => applyGuesses(r)],
    [
      "a guess saved before its ID was built",
      (r: BenchResult) => ({ ...r, guessed: true, system: { ...r.system, os: "windows", gpuId: NOT_LISTED, gpuName: "GeForce RTX 2080 Ti 11 GB", gpuFormFactor: "desktop", gpuIdRequested: "" } }),
    ],
  ] as const) {
    it(`sets up the whole form, then saves the built ID (${label})`, async () => {
      const r = prepare(run());
      expect(r.system.gpuId).toBe(NOT_LISTED);
      const { form, saves } = mount(r);

      // Setup ran to the end: dropdowns, commands.
      expect(options(form, "osDetail")).toContain("Windows 11 Pro 24H2");
      expect(options(form, "osDetail")[0]).toBe("— Not sure —");
      expect(options(form, "memoryChannels").some((t) => t?.startsWith("2 (dual channel"))).toBe(true);
      expect(options(form, "memoryType").some((t) => t?.includes("DDR"))).toBe(true);
      expect(form.querySelector("[data-cmd-all]")!.textContent).toContain("Computer type:");

      // The helper's ID is in place, and saved once setup has returned.
      expect(r.system.gpuIdRequested).toBe("rtx_2080_ti_11gb_reference");
      expect(saves).toEqual([]);
      await Promise.resolve();
      expect(saves).toEqual(["rtx_2080_ti_11gb_reference"]);

      // Handlers are attached: the command toggle and a dropdown change.
      const linux = form.querySelector<HTMLInputElement>('input[name="cmd-os"][value="linux"]')!;
      linux.checked = true;
      linux.dispatchEvent(new Event("change", { bubbles: true }));
      expect(form.querySelector("[data-cmd-open]")!.textContent).toContain("Terminal (bash)");
      const channels = form.querySelector<HTMLSelectElement>('[data-combo-select="memoryChannels"]')!;
      channels.value = "2";
      channels.dispatchEvent(new Event("change", { bubbles: true }));
      expect(r.system.memoryChannels).toBe("2");
      expect(saves.length).toBe(2);
    });
  }

  it("saves straight away after setup", () => {
    const r = run();
    r.system.os = "windows";
    const { form, saves } = mount(r);
    const input = form.elements.namedItem("cpu") as HTMLInputElement;
    input.value = "AMD Ryzen 7 7800X3D";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    expect(saves.length).toBe(1);
  });
});

// A chip sold with more than one memory size has a reference with no size in its id (hd_7790: 1 GB
// and 2 GB). Its ID needs the size added (hd_7790_2gb_reference, base hd_7790), so the guess leaves
// the ID empty and the helper asks for the size.
describe("a guessed GPU whose reference has no memory size", () => {
  const HD_7790 = "ANGLE (AMD, AMD Radeon HD 7790 Direct3D11 vs_5_0 ps_5_0, D3D11)";
  const flush = () => Promise.resolve();
  const helperId = () => document.querySelector(".helper-id code")?.textContent ?? "";
  const pickSize = (form: HTMLFormElement, gb: number) => {
    const vram = form.querySelector<HTMLSelectElement>("[data-helper-vram]")!;
    vram.value = `hd_7790_${gb}gb`;
    vram.dispatchEvent(new Event("input", { bubbles: true }));
  };

  it("asks for the size, then builds and saves an ID the page accepts", async () => {
    const r = applyGuesses(run(HD_7790));
    expect(r.system).toMatchObject({ gpuId: NOT_LISTED, gpuName: "Radeon HD 7790", gpuIdRequested: "" });
    const { form, saves } = mount(r);
    await flush();
    expect(saves).toEqual([]);
    expect(form.querySelector("[data-helper-vram]")).not.toBeNull();
    expect(helperId()).toBe("");
    expect(form.querySelector("[data-helper-result]")!.textContent).toContain("Choose its graphics memory above.");

    pickSize(form, 2);
    expect(r.system.gpuIdRequested).toBe("hd_7790_2gb_reference");
    expect(saves).toEqual(["hd_7790_2gb_reference"]);
    expect(validateSubmission(r).filter((e) => e.startsWith("Requested gpu_id"))).toEqual([]);
    expect(catalogFile(r.system.gpuIdRequested, r.system.gpuName, "desktop")!.yaml).toContain("base: hd_7790\n");

    // Opened again: the helper comes back on the chosen size.
    const again = mount(r);
    await flush();
    // The option marked selected (happy-dom misreads select.value for markup set with innerHTML).
    expect(again.form.querySelector<HTMLOptionElement>("[data-helper-vram] option[selected]")!.value).toBe("hd_7790_2gb");
    expect(helperId()).toBe("hd_7790_2gb_reference");
    expect(again.form.querySelector<HTMLDetailsElement>("#gpu-more")!.open).toBe(false);
  });

  it("clears an ID guessed before sizes were asked for (hd_7790_reference), once setup is done", async () => {
    const r = applyGuesses(run(HD_7790));
    r.system.gpuIdRequested = "hd_7790_reference";
    r.suggested = [...(r.suggested ?? []), "gpuIdRequested"];
    const { form, saves } = mount(r);
    expect(r.system.gpuIdRequested).toBe("");
    expect(r.suggested).not.toContain("gpuIdRequested");
    expect((form.elements.namedItem("gpuIdRequested") as HTMLInputElement).value).toBe("");
    expect(saves).toEqual([]);
    await flush();
    expect(saves).toEqual([""]);
    expect(form.querySelector("[data-helper-vram]")).not.toBeNull();
  });

  it("takes the size from pasted command output", async () => {
    const r = run(HD_7790);
    r.guessed = true;
    const { form } = mount(r);
    const paste = form.querySelector<HTMLTextAreaElement>("[data-sys-paste]")!;
    paste.value = "Computer type: desktop\nGPU: AMD Radeon HD 7790 (2 GB) [board 1da2]";
    paste.dispatchEvent(new Event("input", { bubbles: true }));
    expect(r.system.gpuId).toBe(NOT_LISTED);
    expect(r.system.gpuIdRequested).toBe("hd_7790_2gb_sapphire_reference");
  });
});
