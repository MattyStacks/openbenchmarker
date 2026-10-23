import { describe, expect, it } from "vitest";
import { UPSTREAM_REPO, gpuRequestUrl } from "../src/benchmark/catalog";

const parts = (u: string) => {
  const url = new URL(u);
  return { url, title: url.searchParams.get("title") ?? "", body: url.searchParams.get("body") ?? "" };
};

describe("gpuRequestUrl", () => {
  it("opens a new upstream issue with the browser name as a labelled starting point", () => {
    const { url, title, body } = parts(gpuRequestUrl("NVIDIA GeForce RTX 4070 SUPER"));
    expect(`${url.origin}${url.pathname}`).toBe(`${UPSTREAM_REPO}/issues/new`);
    expect(title).toBe("GPU catalog request: NVIDIA GeForce RTX 4070 SUPER");
    expect(body).toContain("Reported by the browser (starting point, edit as needed):** NVIDIA GeForce RTX 4070 SUPER");
    expect(body).toContain("contains no benchmark result");
  });

  it("works without a name", () => {
    for (const label of [null, undefined, "", "   "]) {
      const { title, body } = parts(gpuRequestUrl(label));
      expect(title).toBe("GPU catalog request: my GPU");
      expect(body).toContain("not shown by the browser");
    }
  });

  it("encodes odd characters and caps the name", () => {
    const { title } = parts(gpuRequestUrl("A&B #1 ?x=" + "y".repeat(300)));
    expect(title.startsWith("GPU catalog request: A&B #1 ?x=")).toBe(true);
    expect(title.length).toBe("GPU catalog request: ".length + 100);
  });

  it("never carries result data", () => {
    const { body } = parts(gpuRequestUrl("Radeon RX 7800 XT"));
    expect(body).not.toMatch(/fps|p1_low|avg|score|gpu_id|result:/i);
  });
});
