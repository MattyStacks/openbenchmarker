import { CC_BY_DEED, DATA_LICENSE, OGB_SITE, UPSTREAM_CATALOG_README, UPSTREAM_ISSUES, UPSTREAM_REPO, UPSTREAM_TEMPLATES } from "../benchmark/catalog";
import { ASSUMED_HANDHELD_CHANNELS } from "../benchmark/fields";
import { getScoreTest } from "../benchmark/presets";
import { decodeShare, type SharedRun } from "../benchmark/share-codec";
import { $, esc } from "./dom";
import { browserLabel, osLabel } from "./share";
import { showView } from "./shell";

// ---------------------------------------------------------------------------
// About & FAQ (#/about, #/about/<section id>). Plain English, written from the code: the
// storage list mirrors docs/privacy-audit.md and the link table is decoded from a real link, so
// tests/about.test.ts can check both against the source.
// ---------------------------------------------------------------------------

export const REPO = "https://github.com/MattyStacks/openbenchmarker";

/** A real result link (pinned in tests/share-codec.test.ts), decoded on the page for the table. */
export const EXAMPLE_CODE = "AQACCAcaAG_iAJQACdgAjiAEMwlEMIjTl05WSURJQSBHZUZvcmNlIFJUWCA1MDgwCQ";
export const EXAMPLE_LINK = `https://opengpubenchmarker.com/#/r/${EXAMPLE_CODE}`;

/** Every key the site keeps in the browser: [key, storage, what it's for, when it's cleared]. */
export const STORAGE_KEYS: [string, "localStorage" | "sessionStorage", string, string][] = [
  ["ogb.results.v1", "localStorage", "My Results: your saved runs, the system details you typed in, and (on compared runs) the code of the run you compared with.", "When you delete a result or use Clear my saved results in My Results."],
  ["ogb.config.v1", "localStorage", "The resolution, preset and run length you picked last, so they're ready next time.", "Updated when you start a custom run; cleared with site data."],
  ["ogb.runInProgress.v1", "localStorage", "A note that a run has started (settings, start time, stage and, for stress tests, laps finished), so if the browser crashes mid-run the next visit can tell you.", "Removed as soon as the run ends in any way."],
  ["ogb.unfinished.v1", "localStorage", "Settings that didn't finish on this device last time, for the \"Didn't finish here last time\" hint.", "When a run at those settings finishes, or with Clear my saved results."],
  ["ogb.historyView.v1", "localStorage", "Whether My Results shows cards or a table.", "Cleared with site data."],
  ["ogb.challenge.v1", "sessionStorage", "The share code of a run you chose to compare with, kept in this tab so a reload or crash doesn't lose it.", "When the comparison appears on your result, when you press Stop comparing, or when the tab closes."],
];

const fps = (x: number) => x.toFixed(1);

/** Plain-language rows for every field a link carries, with values from the example link. */
function linkRows(r: SharedRun): [string, string, string][] {
  const d = r.device;
  return [
    ["Format version", "1", "Lets future versions of the site keep opening today's links."],
    ["Link type", "result", "A result, an invite to compare, or a comparison of two runs."],
    ["Benchmark", "Neon Flythrough", "Which test was run."],
    ["Benchmark version", r.benchmarkVersion, "Only runs of the same major version measure the same work."],
    ["Resolution", `${r.resolution} (${r.width}×${r.height})`, "The size the scene was drawn at."],
    ["Preset", r.preset, "The graphics settings."],
    ["Run length", `${r.durationS} s`, "How long the timed part lasted."],
    ["Stress test", r.stress ? `${r.stress.laps.length} laps` : "none", "Stress tests carry each lap's average FPS, so the link can show stability (slowest lap ÷ fastest)."],
    ["Score run", r.scoreTest ? `${getScoreTest(r.scoreTest)?.name ?? r.scoreTest}, score ${r.score}` : "none", "Locked score runs carry their score (average FPS × 100)."],
    ["Average FPS", r.avgFps.toFixed(2), "The headline number."],
    ["1% and 5% low FPS", `${fps(r.p1Low)} / ${fps(r.p5Low)}`, "How smooth the slowest moments were."],
    ["Worst frame", `${r.worstMs.toFixed(2)} ms`, "The single slowest frame."],
    ["Frames timed", String(r.frameCount), "Used to check the numbers add up."],
    ["Timing method", r.timing === "gpu-timer" ? "GPU timer" : r.timing === "batch-avg" ? "batch average" : "per frame", "How frame times were measured."],
    ["Graphics API", r.graphicsApi, "WebGL2 or WebGL1."],
    ["Run date", r.date, "The day only, no time of day."],
    ["Browser", browserLabel(d) || "unknown", "Browser name and major version."],
    ["Operating system", osLabel(d) || "unknown", "Windows, macOS, Linux, Android, iOS and so on."],
    ["Device type", d.deviceType, "Phone, tablet or desktop."],
    ["iOS engine", d.webkitEngine ? "yes" : "no", "On iPhone and iPad every browser uses Safari's engine."],
    ["GPU name", d.gpuLabel ?? "not reported", "As the browser reported it (often generic), up to 63 bytes."],
    ["Check value", "1 byte", "Catches links that got cut off or mangled when copied."],
  ];
}

export function aboutHtml(): string {
  const ex = decodeShare(EXAMPLE_CODE);
  const exRun = ex.ok ? ex.payload.runs[0] : null;
  const tech = (body: string) => `<details class="tech"><summary>Technical details</summary>${body}</details>`;
  const ext = (href: string, text: string) => `<a href="${esc(href)}" target="_blank" rel="noopener">${text}</a>`;
  return `
  <article class="about">
    <div class="results-head"><h1 class="sign">About &amp; FAQ</h1>
      <p class="muted">Nothing leaves your device unless you share it, and then only where you send it.</p></div>

    <nav class="about-toc" aria-label="On this page">
      <a href="#/about/what">What this is</a><a href="#/about/principles">Principles</a><a href="#/about/saved">What gets saved</a>
      <a href="#/about/sharing">How sharing works</a><a href="#/about/submitting">Submitting</a><a href="#/about/phones">Phones</a><a href="#/about/faq">FAQ</a>
    </nav>

    <section id="what" class="card about-sec">
      <h2>What this is</h2>
      <p>Open GPU Benchmarker is a free, open-source GPU benchmark that runs in your browser. There's nothing to install: open the page, pick your settings and press Start.</p>
      <p>The code is on ${ext(REPO, "GitHub")} under the ${ext(`${REPO}/blob/main/LICENSE`, "MIT License")}, so you're free to reuse it. The Open GPU Benchmarker name and logo belong to the project, so if you fork it, please give your version its own name.</p>
    </section>

    <section id="principles" class="card about-sec">
      <h2>Our principles</h2>
      <ul>
        <li><b>It runs on your device.</b> The benchmark, the results and the share cards are all made in your browser.</li>
        <li><b>We don't store anything.</b> There's no database, no accounts and no server code. The site is just files.</li>
        <li><b>No accounts, no cookies needed, no tracking of our own.</b> We don't add analytics or tracking scripts. Our host, Cloudflare, may add its own technology to keep the site running. <a href="#/about/host">More about our host.</a></li>
        <li><b>Nothing is shared unless you choose to.</b> You decide what goes public, if anything.</li>
        <li><b>We suggest, you decide.</b> To make things easier, we sometimes suggest a value, our best guess, especially for details most people don't know offhand about their device. Suggested values are always marked, and you can change or clear them. We don't take liberties with your data: measured values come from the run, and anything else is yours to confirm.</li>
      </ul>
      <p>If verified results ever happen, they'll be a separate benchmark that clearly says what it stores. This one stays local-only. <a href="#/about/faq-verified">Want one? Tell us →</a></p>
    </section>

    <section id="run" class="card about-sec">
      <h2>What happens when you run a benchmark</h2>
      <p>Your browser builds a neon city and flies a fixed path through it while it measures how fast your GPU draws each frame. Everything happens on your device. The page doesn't download anything during the run, and the scene and path are the same every time, so runs can be compared.</p>
      ${tech(`<p>The city is generated from fixed seeds with three.js on WebGL2. Frames are drawn back to back with no frame cap. Where the browser supports GPU timer queries, each frame's GPU time is measured; otherwise frame times come from batch averages. Average FPS is frames divided by timed wall-clock.</p>`)}
    </section>

    <section id="saved" class="card about-sec">
      <h2>What gets saved, and where</h2>
      <p>My Results lives in your browser's <b>local storage</b>: a small storage area on your device that belongs to this site. It isn't a cookie, and it's never sent anywhere. Clearing this site's data in your browser deletes all of it. There's no copy anywhere else.</p>
      <p>Here's every note the site keeps:</p>
      <div class="table-scroll"><table class="about-table">
        <thead><tr><th>Name</th><th>What it's for</th><th>When it's cleared</th></tr></thead>
        <tbody>${STORAGE_KEYS.map(([k, where, what, when]) => `<tr><td><code>${esc(k)}</code><br><span class="muted tiny">${where === "sessionStorage" ? "this tab only" : "this browser"}</span></td><td>${esc(what)}</td><td>${esc(when)}</td></tr>`).join("")}</tbody>
      </table></div>
      <p><b>To clear things:</b> <a href="#/history">Clear my saved results</a> in My Results removes your saved runs and the didn't-finish notes. To remove everything above, clear this site's data in your browser settings.</p>
      ${tech(`<p>The first five use <code>localStorage</code> and the last uses <code>sessionStorage</code>. IndexedDB, Cache Storage and service workers aren't used. Clear my saved results removes <code>ogb.results.v1</code> and <code>ogb.unfinished.v1</code>; your last-used settings stay. Filters and sort in My Results are kept in memory only.</p>`)}
    </section>

    <section id="cookies" class="card about-sec">
      <h2>Cookies</h2>
      <p>None. The site doesn't set or read any cookies, and you never need one to use it.</p>
    </section>

    <section id="host" class="card about-sec">
      <h2>Our host: Cloudflare</h2>
      <p>We use Cloudflare as our service provider to host the site. To keep it up, fast and protected, Cloudflare may add its own beacons or other technology. Those are Cloudflare's, covered by ${ext("https://www.cloudflare.com/privacypolicy/", "Cloudflare's privacy policy")}.</p>
      <p>We don't add anything. Nothing in this site's code collects your data, there's no server code of our own, and your data is your own.</p>
      <p>Browsers don't send the part of the address after the <code>#</code>, where share links keep a result, when they request the page.</p>
    </section>

    <section id="sharing" class="card about-sec">
      <h2>How sharing works</h2>
      <h3>When you tap Share</h3>
      <ol>
        <li><b>Your result is read</b> from this browser: the measured numbers, the settings and the run date.</li>
        <li><b>Some device details are added</b>, as your browser reports them: browser and version, operating system, whether it's a phone, tablet or desktop, and the GPU name. They come from the browser's own description of itself (its "user agent") and from WebGL, and were recorded with the result when you ran it.</li>
        <li><b>Everything is packed into a short code</b> of letters, numbers, <code>-</code> and <code>_</code>. Each value is stored as a few bits, like a very compact form, and the bytes are written out in a link-safe alphabet (called base64url).</li>
        <li><b>A check value is added</b>, so a link that gets cut off or mangled is caught instead of showing wrong numbers.</li>
        <li><b>The code goes after the <code>#</code></b> in the address: <code>opengpubenchmarker.com/#/r/&lt;code&gt;</code>.</li>
        <li><b>The card and QR code are drawn on your device.</b> Nothing is uploaded to make them.</li>
        <li><b>Your share sheet hands the link and a line of text to the app you pick.</b> Only that app gets it. Save image downloads the card separately.</li>
      </ol>
      <h3>When someone opens a link</h3>
      <p>Browsers never send the part after the <code>#</code> to the website, so the result stays in their browser. The page unpacks the code and checks it before showing anything:</p>
      <ul>
        <li>the code is complete and spelled exactly as the site writes it,</li>
        <li>the check value matches,</li>
        <li>every value is one the format knows (a real preset, resolution, run length and so on),</li>
        <li>the numbers make sense together: the lows aren't above the average, the frame count matches the run length, the date isn't in the future, and a score equals average FPS × 100.</li>
      </ul>
      <p>If anything fails, it says <i>"This link or code looks damaged or edited"</i> instead of showing the result. A link from a newer version of the site asks you to reload.</p>

      <h3>What's in a link</h3>
      ${
        exRun
          ? `<div class="table-scroll"><table class="about-table">
        <thead><tr><th>Field</th><th>Example</th><th>Why it's there</th></tr></thead>
        <tbody>${linkRows(exRun).map(([f, v, why]) => `<tr><td>${esc(f)}</td><td>${esc(v)}</td><td>${esc(why)}</td></tr>`).join("")}</tbody>
      </table></div>`
          : ""
      }
      <p>The example values come from this real link (it opens a shared result):</p>
      <p class="example-link"><a href="#/r/${EXAMPLE_CODE}"><code>${esc(EXAMPLE_LINK)}</code></a></p>
      <p>A result code is about 35 characters, plus a little more than one character per letter of the GPU name: around 65 with a typical name, or around 100 for the whole link. A comparison carries two runs, so it's roughly twice as long.</p>
      ${tech(`<p>The format is bit-packed binary. Byte 0 is the format version, then the link type, then one record per run (two for a comparison). After that comes an optional extension section (tag, length, value entries that older versions skip), then a CRC-8 check byte, and the whole thing is base64url without padding. The full layout is in <a href="${REPO}/blob/main/docs/share-links.md" target="_blank" rel="noopener">docs/share-links.md</a> and <code>src/benchmark/share-codec.ts</code>.</p>`)}

      <h3>What's not in a link</h3>
      <p>No name, email address, IP address, account, device ID or result ID. It also doesn't carry the system details you typed in (GPU model, CPU, memory and so on), the detailed diagnostics, or the time of day.</p>

      <h3>Link types</h3>
      <ul>
        <li><b>Result:</b> one run, to show off.</li>
        <li><b>Invite to compare:</b> one run, with an offer to run the same test and compare.</li>
        <li><b>Comparison:</b> two runs side by side.</li>
      </ul>

      <h3>How long links last</h3>
      <p>Indefinitely. Every link starts with a format version, and each version keeps its own decoder, so links made today keep opening after the site changes. New optional details can be added in the extension section, which older links simply don't have.</p>

      <h3>Who can read a link</h3>
      <p>Anyone who has it, and any app you paste it into. That's not a security flaw; it's how the link works. The result is encoded, not encrypted, so it can be read back like a screenshot. Share it wherever you'd share a screenshot.</p>

      <h3>The honor system</h3>
      <p>The format is open, so someone could build a link with numbers they never ran. The check value catches accidents, not edits, and nothing is signed. Treat a shared result as a claim, not proof.</p>

      <p class="about-summary"><b>In one line:</b> nothing leaves your device unless you share it, and then only where you send it.</p>
    </section>

    <section id="submitting" class="card about-sec">
      <h2>Submitting to Open GPU Benchmarks</h2>
      <p>${ext(OGB_SITE, "Open GPU Benchmarks")} is a free, open dataset of GPU results. Adding your desktop or laptop result is optional, and it helps other people pick a GPU.</p>
      <p><b>Why isn't it one click?</b> This site keeps nothing and has no server, so it can't submit for you. You submit through GitHub yourself, see every field before it's published, and decide what goes in. Your GitHub username is public on the pull request.</p>
      <p><b>What the license means:</b> submitted results are published under ${ext(CC_BY_DEED, "CC BY 4.0")} (${ext(DATA_LICENSE, "dataset license")}), one of the most open licenses there is for data. We believe benchmark results are most useful when they're open to everyone, so the data isn't fenced off: anyone can use, share and build on it, for any purpose, as long as they credit the source. Being that open also means no one, including us, can limit who uses it or how. Copies other people make stay public, so leave any optional field blank if you'd rather not share it.</p>
      <p>After a desktop run, the results page shows a short invitation to submit. "Not now" hides it until the page reloads, and nothing is stored.</p>
    </section>

    <section id="gpu" class="card about-sec">
      <h2>Don't see your GPU?</h2>
      <p>The GPU catalog is new and growing, and every card added helps. ${ext(UPSTREAM_ISSUES, "Request it with an issue")} (no coding needed), or ${ext(UPSTREAM_TEMPLATES, "add it with a pull request")} using the ${ext(UPSTREAM_CATALOG_README, "ID rules")}. The results page fills the request with the GPU name your browser reported, as a starting point you can edit; it's sent to GitHub only when you click it and submit the issue. Once your GPU is listed, open your result from My Results and submit it.</p>
    </section>

    <section id="phones" class="card about-sec">
      <h2>Phones and tablets</h2>
      <p>Phone and tablet results are for fun and sharing: you can save, share and compare them. They can't be submitted yet, because the dataset covers desktop and laptop GPUs.</p>
      <p>Some phones run out of memory on the heaviest settings (for example 1440p at Ultra or Extreme, or 4K), and the browser closes the page. If that happens, try 1440p High or 1080p. The site remembers settings that didn't finish and warns you next time.</p>
      <p>Phone results list memory channels as "${ASSUMED_HANDHELD_CHANNELS} (assumed)". <a href="#/about/faq-memory-channels">Here's why.</a></p>
    </section>

    <section id="faq" class="card about-sec faq">
      <h2>FAQ</h2>
      ${faq("faq-sent", "Is my data sent anywhere?", `<p>No. Your results stay in this browser. Something leaves only when you share a link, export a file, or submit to Open GPU Benchmarks, and then only where you send it. Like any website, our host Cloudflare sees the page requests themselves. <a href="#/about/host">More about our host.</a></p>`)}
      ${faq("faq-cookies", "Do you use cookies?", `<p>The site doesn't set or need any. My Results uses your browser's local storage, which stays on your device. <a href="#/about/saved">See everything that's saved.</a></p>`)}
      ${faq("faq-one-click", "Why can't I submit with one click?", `<p>The site keeps nothing and has no server, so you submit through GitHub yourself. That way you see exactly what's published before it goes public.</p>`)}
      ${faq("faq-faked", "Can shared results be faked?", `<p>Yes. The link format is open, so someone could make a link with numbers they never ran. The check value catches accidents, not edits. Treat a shared result as a claim, not proof.</p>`)}
      ${faq("faq-link", "What exactly is in a share link?", `<p>Your measured numbers, the settings, the run date, your browser and OS, the device type and the GPU name your browser reported. No name, account, IP address or device ID. <a href="#/about/sharing">See the full table.</a></p>`)}
      ${faq("faq-generic-gpu", "Why does my GPU show as \"Apple GPU\" or something generic?", `<p>That's the name your browser reports, and some browsers hide the real model on purpose for privacy (Safari always says "Apple GPU", and Brave can hide it too). It's only used for display and sharing. For submitting, you pick your exact GPU from the catalog yourself.</p>`)}
      ${faq("faq-suggested", "Why are some fields filled in already?", `<p>To make things easier, we sometimes suggest a value, our best guess, for details most people don't know offhand. Suggested values are always marked, and you can change or clear them. Measured values come from the run, and anything else is yours to confirm.</p>`)}
      ${faq("faq-guessed", "Why are some settings guessed?", `<p>While building sharing and phone support, we found that some details can't be read by a browser at all. So we made sensible best guesses to let everyone share a complete result. Guesses are always marked, and you can change them.</p>`)}
      ${faq("faq-memory-channels", `Why does my phone result say "${ASSUMED_HANDHELD_CHANNELS} (assumed)" memory channels?`, `<p>Browsers can't see how a phone's memory is wired, so we assume ${ASSUMED_HANDHELD_CHANNELS}. That matches current flagship phones, whose memory runs as four narrow 16-bit channels, but many mid-range and budget phones use two, and some chip makers call the same setup "dual channel".</p><p>It's there for context only, and phone results can't be submitted yet. Four phone channels add up to the width of a single desktop memory channel, so phone and desktop channel counts aren't comparable.</p>${tech(`<p>Phone LPDDR memory channels are 16 bits wide; a desktop DDR channel is 64 bits, one memory stick. The value is stored with the result as <code>memory_channels: ${ASSUMED_HANDHELD_CHANNELS}</code> and marked as suggested (CSV <code>suggested_fields</code>, JSON <code>suggested</code>). Editing it removes the mark.</p>`)}`)}
      ${faq("faq-delete", "Can I delete my results?", `<p>Yes. Delete one result or all of them in <a href="#/history">My Results</a>, or clear this site's data in your browser. There's no other copy. Links you already shared and results you already submitted aren't affected.</p>`)}
      ${faq("faq-gpu-missing", "Why isn't my GPU listed, and how do I add it?", `<p>The catalog is new and growing. ${ext(UPSTREAM_ISSUES, "Request it with an issue")} or ${ext(UPSTREAM_TEMPLATES, "add it with a pull request")}. <a href="#/about/gpu">More on adding a GPU.</a></p>`)}
      ${faq("faq-phone-submit", "Can I submit a phone result?", `<p>Not yet. The dataset lists desktop and laptop GPUs. You can still save, share and compare phone results.</p>`)}
      ${faq("faq-stress", "What do the stress tests measure?", `<p>Whether your device keeps its speed when it's busy for a while. Stress: Entry and Stress: Extreme fly the same 96 s path 6 times, about 10 minutes. Every lap draws exactly the same frames, so if a later lap is slower, the device slowed itself down: usually because it got hot (thermal throttling), hit a power limit or switched to a battery saver.</p><p><b>Stability</b> is the slowest lap's average FPS divided by the fastest lap's. 97% or more counts as steady, the same mark 3DMark's stress tests use. A browser can't read temperatures or clock speeds, so this comes from the frame rate alone. Stress tests can be shared and compared, but not submitted to Open GPU Benchmarks.</p>`)}
      ${faq("faq-crash", "Why did my browser crash on the heaviest settings?", `<p>The heaviest settings need a lot of graphics memory. Some phones and older computers run out, and the browser closes the page to protect itself. Try a lower resolution or preset; the site remembers settings that didn't finish here and warns you next time.</p>`)}
      ${faq("faq-verified", "Will there ever be verified results?", `<p>Maybe. It would be a separate benchmark that clearly says what it stores; this one stays local-only. If you'd like to see a verified benchmark, ${ext(`${REPO}/issues`, "request one on GitHub")}. If enough people are interested, we'll work on building one.</p>`)}
    </section>

    <p class="about-legal muted tiny">© 2026 the <a href="${REPO}" target="_blank" rel="noopener">Open GPU Benchmarker maintainers</a>. Code released under the MIT License. The Open GPU Benchmarker name and logo aren't covered by the MIT License.</p>
    <p class="about-legal muted tiny">Source: ${ext(REPO, "github.com/MattyStacks/openbenchmarker")} · Results dataset: ${ext(UPSTREAM_REPO, "open-gpu-benchmarks")}</p>
  </article>`;
}

function faq(id: string, q: string, a: string): string {
  return `<details class="faq-item" id="${id}"><summary>${esc(q)}</summary>${a}</details>`;
}

export function renderAbout(section: string | null): void {
  showView("about");
  const view = $("#view-about");
  if (!view.dataset.built) {
    view.innerHTML = aboutHtml();
    view.dataset.built = "1";
  }
  const target = section ? document.getElementById(section) : null;
  if (target instanceof HTMLDetailsElement) target.open = true;
  requestAnimationFrame(() => (target ? target.scrollIntoView({ block: "start" }) : window.scrollTo(0, 0)));
}
