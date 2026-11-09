import type { SystemProbe } from "../benchmark/types";

// ---------------------------------------------------------------------------
// The extra browser signals the results form guesses from (src/benchmark/guess.ts), read once at
// run start and saved with the result. Each one is optional: a browser that doesn't offer it gives
// null. Nothing here leaves the browser.
// ---------------------------------------------------------------------------

type Nav = Navigator & {
  deviceMemory?: number;
  userAgentData?: { getHighEntropyValues?: (hints: string[]) => Promise<Record<string, unknown>> };
  getBattery?: () => Promise<{ charging: boolean; level: number }>;
  gpu?: { requestAdapter?: () => Promise<{ info?: Record<string, string> } | null> };
};

/** Resolves to null if `p` takes longer than `ms` or fails, so a slow API can't hold up a run. */
async function within<T>(p: Promise<T> | undefined, ms: number): Promise<T | null> {
  if (!p) return null;
  return Promise.race([p.catch(() => null), new Promise<null>((res) => setTimeout(() => res(null), ms))]);
}

export async function probeSystem(nav: Nav = navigator as Nav): Promise<SystemProbe> {
  const [hints, battery, adapter] = await Promise.all([
    within(nav.userAgentData?.getHighEntropyValues?.(["platformVersion", "model", "formFactors"]), 500),
    within(nav.getBattery?.(), 500),
    within(nav.gpu?.requestAdapter?.(), 800),
  ]);
  const info = adapter?.info;
  return {
    platformVersion: typeof hints?.platformVersion === "string" ? hints.platformVersion : null,
    model: typeof hints?.model === "string" ? hints.model : null,
    formFactors: Array.isArray(hints?.formFactors) ? (hints.formFactors as unknown[]).map(String) : null,
    deviceMemoryGb: typeof nav.deviceMemory === "number" ? nav.deviceMemory : null,
    screen: typeof screen !== "undefined" ? { width: screen.width, height: screen.height, dpr: Math.round(devicePixelRatio * 100) / 100 } : null,
    battery: battery ? { charging: battery.charging, level: battery.level } : null,
    webgpu: info ? { vendor: info.vendor ?? "", architecture: info.architecture ?? "", description: info.description ?? "" } : null,
  };
}
