import { describe, expect, it } from "vitest";
import { EXAMPLE_CODE, EXAMPLE_LINK, STORAGE_KEYS, aboutHtml } from "../src/app/about-view";
import { decodeShare } from "../src/benchmark/share-codec";
import auditDoc from "../docs/privacy-audit.md?raw";
import indexHtml from "../index.html?raw";

// The About page itself is left out, so its claims are checked against the rest of the code.
const srcFiles = import.meta.glob("../src/**/*.ts", { query: "?raw", import: "default", eager: true }) as Record<string, string>;
const source = Object.entries(srcFiles)
  .filter(([f]) => !f.endsWith("about-view.ts"))
  .map(([, text]) => text)
  .join("\n");
const keysInSource = [...new Set(source.match(/"ogb\.\w+\.v\d+"/g)!.map((k) => k.slice(1, -1)))].sort();
const html = aboutHtml();

describe("About & FAQ matches the code", () => {
  it("lists exactly the storage keys the site uses", () => {
    expect(STORAGE_KEYS.map(([k]) => k).sort()).toEqual(keysInSource);
    for (const k of keysInSource) expect(html).toContain(k);
  });

  it("docs/privacy-audit.md lists the same keys", () => {
    for (const k of keysInSource) expect(auditDoc).toContain(k);
  });

  it("only the challenge key uses sessionStorage", () => {
    expect(STORAGE_KEYS.filter(([, s]) => s === "sessionStorage").map(([k]) => k)).toEqual(["ogb.challenge.v1"]);
    expect(source.match(/sessionStorage/g)!.length).toBeGreaterThan(0);
    expect(source).not.toMatch(/indexedDB|document\.cookie|sendBeacon|\bfetch\(|XMLHttpRequest|WebSocket/);
  });

  it("the example link is real and the table shows its decoded values", () => {
    const d = decodeShare(EXAMPLE_CODE);
    expect(d.ok).toBe(true);
    if (!d.ok) return;
    const r = d.payload.runs[0];
    for (const v of [r.avgFps.toFixed(2), r.benchmarkVersion, r.preset, r.date, String(r.frameCount), r.device.gpuLabel!, "Edge 141", "Windows"]) expect(html).toContain(v);
    expect(html).toContain(EXAMPLE_LINK);
    expect(EXAMPLE_LINK.length).toBeGreaterThan(90);
    expect(EXAMPLE_LINK.length).toBeLessThan(110);
  });

  it("names Cloudflare as the host without claiming its retention periods", () => {
    const host = html.slice(html.indexOf('id="host"'), html.indexOf('id="sharing"'));
    expect(host).toContain("Cloudflare");
    expect(host).toContain("https://www.cloudflare.com/privacypolicy/");
    expect(host).not.toMatch(/retain|\bdays\b/i);
  });

  it("never claims no tracking without qualifying it", () => {
    for (const text of [html, indexHtml]) expect(text).not.toMatch(/no tracking[.,]|no cookies[.,]/i);
  });

  it("has the FAQ entries other pages link to", () => {
    const linked = [...(source + indexHtml).matchAll(/#\/about\/([\w-]+)/g)].map((m) => m[1]);
    for (const id of new Set(linked)) expect(html).toContain(`id="${id}"`);
  });
});
