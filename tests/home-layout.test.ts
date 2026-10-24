import { describe, expect, it } from "vitest";
import html from "../index.html?raw";

// "Compare with another run" is always the last section on the home page, right above the footer.
// New home sections go above it.

const home = html.slice(html.indexOf('id="view-home"'), html.indexOf('id="view-run"'));

describe("home page layout", () => {
  it("ends with Compare with another run", () => {
    const compare = home.indexOf('id="compare-entry"');
    expect(compare).toBeGreaterThan(-1);
    const after = home.slice(home.indexOf("</details>", compare) + "</details>".length);
    expect(after.trim().startsWith("</section>")).toBe(true);
  });

  it("puts the custom run first, then score runs and stress tests", () => {
    const at = (s: string) => home.indexOf(s);
    expect(at('id="config"')).toBeLessThan(at('id="score-runs"'));
    expect(at('id="score-runs"')).toBeLessThan(at('id="stress-runs"'));
    expect(at('id="stress-runs"')).toBeLessThan(at('id="compare-entry"'));
  });
});
