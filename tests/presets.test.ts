import { describe, expect, it } from "vitest";
import { RESOLUTIONS, getResolution, normalizeResolution, standardResolution } from "../src/benchmark/presets";

describe("resolutions", () => {
  it("offers exactly 720p, 1080p, 1440p and 4K, in that order (no Native)", () => {
    expect(RESOLUTIONS.map((r) => r.id)).toEqual(["720p", "1080p", "1440p", "4K"]);
    expect(getResolution("720p")).toMatchObject({ width: 1280, height: 720 });
    expect(getResolution("4K")).toMatchObject({ width: 3840, height: 2160 });
    expect(getResolution("2160p")).toBeUndefined();
    expect(getResolution("native")).toBeUndefined();
  });

  it("recognises a standard resolution only when name and pixel size match", () => {
    expect(standardResolution("1080p", 1920, 1080)?.id).toBe("1080p");
    expect(standardResolution("4K", 3840, 2160)?.id).toBe("4K");
    expect(standardResolution("2160p", 3840, 2160)?.id).toBe("4K");
    expect(standardResolution("3440x1440", 3440, 1440)).toBeUndefined();
    expect(standardResolution("1080p", 2560, 1440)).toBeUndefined();
  });

  it("maps old 2160p results to 4K", () => {
    expect(normalizeResolution("2160p")).toBe("4K");
    expect(normalizeResolution("1440p")).toBe("1440p");
  });
});
