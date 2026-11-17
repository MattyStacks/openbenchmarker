// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { bindSystemForm, systemFormHtml, type SystemFormApi } from "../src/app/system-form";
import { NOT_LISTED } from "../src/benchmark/catalog";
import { applyGuesses } from "../src/benchmark/guess";
import { emptySystem, type BenchResult, type RunDiagnostics } from "../src/benchmark/types";

// A GPU the browser names, with a reference file but no listed product (the RTX 2080 Ti), opens the
// GPU helper on it while the form is being set up, and the helper saves the ID it builds. The
// caller's save refreshes the form through the API bindSystemForm returns, as results-view does, so
// a save during setup used to throw (TDZ) and leave the dropdowns, commands and handlers unset.

const RTX_2080TI = "ANGLE (NVIDIA, NVIDIA GeForce RTX 2080 Ti (0x00001E07) Direct3D11 vs_5_0 ps_5_0, D3D11)";

function run(): BenchResult {
  return {
    id: "ti", gameId: "x", benchmarkVersion: "4.0.0", date: "2026-11-17", time: "12:00", resolutionId: "1080p", resolution: "1080p", width: 1920, height: 1080,
    preset: "High", durationS: 60, graphicsApi: "WebGL2", avgFps: 100, p1Low: 80, p5Low: 90, worstMs: 15, frameCount: 6000, loopBusy: 1, valid: true, invalidReason: "",
    diag: { renderer: RTX_2080TI, vendor: "" } as RunDiagnostics,
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
