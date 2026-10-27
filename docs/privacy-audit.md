# Privacy audit

Date: 2026-10-22, re-checked 2026-10-23 for Plan 7 (About & FAQ, `memory_channels`, share-link extension section). Branch: `feature/share-results`. Scope: source (`src/`, `index.html`, `public/`), built output (`dist/`, `npm run build`), and the live response headers of production and the preview. Later copy (share text, About & FAQ) must stay accurate to this report; re-run the checks below when it changes.

Principle being audited: everything runs in the browser; the site stores nothing on a server (no database, KV, cookies, accounts or server code); nothing is shared or submitted unless the user explicitly shares, exports or submits it.

## Findings

| Area | Result |
|---|---|
| Cookies | None. No `document.cookie`, no `Set-Cookie` (static assets only; `public/_headers` sets no cookie headers). |
| Analytics / beacons / error reporting | None in the site's own code. No analytics, `sendBeacon`, Sentry or similar in source or `dist/`. |
| Cloudflare (host) features | Not in `src/` or `dist/`, added by Cloudflare at the edge. Checked 2026-10-23: HTML served to a browser user agent (Edge) has Cloudflare's auto-injected Web Analytics beacon (`static.cloudflareinsights.com/beacon.min.js`, `data-cf-beacon`); plain `curl` doesn't get it. Responses carry Cloudflare's `nel` + `report-to` headers (Network Error Logging). No `Set-Cookie` seen. |
| Network requests from app code | None. No `fetch(`, `XMLHttpRequest`, `WebSocket` or `EventSource` in `src/`. The only URLs in the bundle are hyperlinks, catalog metadata and licence/attribution strings (GitHub, opengpubenchmarks.com, threejs.org, schema.org, creativecommons.org); they load nothing unless clicked. |
| Web fonts / third-party assets | None. System fonts only (`src/style.css`: "System fonts only, no external assets"); no `@font-face`, Google Fonts or CDN assets. Three.js is bundled at build time. |
| `sessionStorage` | One key, `ogb.challenge.v1` (`src/app/challenge.ts`): the share code of a run you chose to compare with ("Set up the same test"), kept in this tab only so it survives a reload or crash. Cleared when the comparison is shown on your result, or on "Stop comparing". |
| IndexedDB / Cache Storage | Not used anywhere in source or `dist/`. |
| `localStorage` | `src/app/store.ts`, `src/app/run-guard.ts` and `src/app/history-view.ts`, five keys (below). |
| Clipboard / Web Share | Only on explicit taps: copy YAML / lookup commands (`src/app/results-view.ts`), and Share / Copy link / Save image (`src/app/share.ts`). Share hands the link and text to the system share sheet (`navigator.share`), never the card PNG (since Plan 5; Save image is a separate download); where Share is missing it copies the link and text to the clipboard. The site sends nothing itself. |
| Share links | `#/r/<payload>`: the whole result encoded (not encrypted) in the URL fragment (`src/benchmark/share-codec.ts`). Browsers never send the fragment in HTTP requests, so opening a link sends nothing about the result to the site. It is decoded and shown only in the recipient's browser. A link carries the measured numbers, settings, run date, browser + version, OS, device type and the GPU name as reported by the browser. It never carries the user-filled `system` fields, the diagnostics or the result id. Anyone with a link can read it. |
| Links to GitHub and opengpubenchmarks.com | Plain links that open in a new tab, only when clicked; the page never opens one by itself. GitHub's new-file form link carries the submission YAML (shown in the preview first). The "Request your GPU" link opens a prefilled, editable GitHub issue whose query string carries only the GPU name as reported by the browser (labelled as a starting point); it never carries result data, and nothing is posted until the user submits the issue on GitHub. |
| Share card | Drawn on a 2D canvas in the browser (`renderCard`), QR code generated locally (`uqr`, bundled; no network). |
| `navigator.deviceMemory` | Read only to add a hint to the phone high-resolution confirmation (Chromium only). Never stored. |
| Browser APIs read for diagnostics/device | `navigator.userAgent` / `userAgentData` (including `getHighEntropyValues(["platform","brands"])`), `navigator.brave.isBrave()`, `navigator.hardwareConcurrency`, Battery Status API (Chromium), WebGL `WEBGL_debug_renderer_info`. All read locally, shown labelled as detected, never sent anywhere by the site. |

## Every storage use

| Key / API | File | What is stored | Leaves the browser? |
|---|---|---|---|
| `ogb.results.v1` (`localStorage`) | `src/app/store.ts` | Saved `BenchResult[]` (measured result, user-filled `system`, `diag`, the separate `device` field, a `suggested` list naming system fields that hold a marked best guess (today only `memoryChannels: "4"` on phone and tablet runs), on compared runs a `challenge` field holding the compared-with run's share code, and on runs prefilled from an earlier result a `carriedFrom` date and time for the form's note; both are stripped from JSON export and never submitted. `system` includes the overclock details (core and memory clock offset, power limit) and, for a GPU not in the catalog yet, its typed name and requested `gpu_id`) | Only when the user exports JSON/CSV, downloads/copies YAML, or opens the GitHub submission form |
| `ogb.config.v1` (`localStorage`) | `src/app/store.ts` | Last-used run config (resolution, preset, duration) | Never |
| `ogb.challenge.v1` (`sessionStorage`) | `src/app/challenge.ts` | Pending comparison (share code) for this tab | Never |
| `ogb.historyView.v1` (`localStorage`) | `src/app/history-view.ts` | My Results display preference, `cards` or `table` | Never |
| `ogb.runInProgress.v1` (`localStorage`) | `src/app/run-guard.ts` | The run currently in progress (resolution, preset, duration, start time, phase; for stress tests, the test and laps finished). Written before a run and removed when it ends in any way. If it's still there on the next load, the OS closed the page mid-run | Never |
| `ogb.unfinished.v1` (`localStorage`) | `src/app/run-guard.ts` | Resolution/preset combos that didn't finish on this device (count, last time, phase), used for the "Didn't finish on this device last time" hint. A combo is removed once a run at it finishes | Never |

Clearing site data deletes all of them. In My Results, "Clear my saved results" removes `ogb.results.v1` and `ogb.unfinished.v1`; the run config stays. My Results filters and sort live in memory only (nothing stored). There is no server copy to delete.

## Hosting

Static assets only (`wrangler.toml` has no `main`, no bindings). Checked 2026-10-23 with `curl -D -` on `https://opengpubenchmarker.com/` and `https://share-results.opengpubenchmarker.com/`: no `Set-Cookie` header, and the site's own HTML loads only `/assets/index-*.js`; Cloudflare injects its Web Analytics beacon for browser user agents (see Findings). The About page says we add nothing, nothing in the site's code collects user data, and Cloudflare, as service provider, may add its own beacons or other technology to keep the site running, under its privacy policy; it makes no specific claims about Cloudflare's features or retention. Previews (`npm run preview:deploy`) serve the same build on `share-results.opengpubenchmarker.com` and `*.mattys.workers.dev`, marked `noindex`; each is its own origin with its own localStorage.

## Built output checked

`npm run build` produces `dist/index.html` plus one hashed JS and one CSS asset under `dist/assets/`, with `public/` files copied verbatim. Grepping `dist/` found: `localStorage` present (the uses above), no `sessionStorage`/IndexedDB/`document.cookie`/`sendBeacon`, and no external asset loads (external strings are links/metadata only).

## How to re-check

```sh
grep -rn "localStorage\|sessionStorage\|indexedDB\|document.cookie\|sendBeacon\|fetch(\|WebSocket" src/ index.html
npm run build
grep -o "indexedDB\|document.cookie\|sendBeacon" dist/assets/*.js   # sessionStorage: only ogb.challenge.v1
grep -rn "@font-face\|fonts.googleapis" src/ index.html dist/assets/*.css
```

## About & FAQ page (Plan 7)

`#/about` (`src/app/about-view.ts`) is the plain-language version of this report. Its storage table must list exactly the `ogb.*.v1` keys in `src/` and this report must name each of them (`tests/about.test.ts`). The candidates Plan 6 left for it, all now covered there:

- What CC BY 4.0 allows: reuse with credit, including commercial use and AI training; copies other people made stay public (upstream's [license page](https://opengpubenchmarks.com/license/)).
- Why submitting isn't automatic: the site keeps nothing and has no server; you submit through GitHub yourself, so your GitHub username is public on the pull request.
- How a GPU gets into the catalog: request it with an issue, or add it with a pull request (`templates/catalog_*.yaml`, ID rules in `data/gpus/README.md`); the snapshot here updates with each site release.
- What the "Request your GPU" link sends: only the browser-reported GPU name, to GitHub, when you click it; you edit it before submitting.
- Why phone and tablet runs can't be submitted yet: the dataset lists desktop and laptop GPUs (an upstream schema change for phone runs is planned; see [upstream-todos.md](upstream-todos.md)).
