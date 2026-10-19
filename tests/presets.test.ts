import { describe, expect, it } from "vitest";
import { RESOLUTIONS, getResolution, normalizeResolution, resolutionLabel } from "../src/benchmark/presets";

describe("resolutions", () => {
  it("offers 1080p, 1440p, 4K and Native, in that order", () => {
    expect(RESOLUTIONS.map((r) => r.id)).toEqual(["1080p", "1440p", "4K", "native"]);
    expect(getResolution("4K")).toMatchObject({ width: 3840, height: 2160 });
    expect(getResolution("2160p")).toBeUndefined();
    expect(getResolution("720p")).toBeUndefined();
  });

  it("records upstream names", () => {
    expect(resolutionLabel("4K", 3840, 2160)).toBe("4K");
    expect(resolutionLabel("1080p", 1920, 1080)).toBe("1080p");
    expect(resolutionLabel("native", 3840, 2160)).toBe("4K");
    expect(resolutionLabel("native", 2560, 1440)).toBe("1440p");
    expect(resolutionLabel("native", 3440, 1440)).toBe("3440x1440");
  });

  it("maps old 2160p results to 4K", () => {
    expect(normalizeResolution("2160p")).toBe("4K");
    expect(normalizeResolution("1440p")).toBe("1440p");
  });
});
