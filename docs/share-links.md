# Share links, codes, comparisons and share cards

A valid result can be shared as `https://opengpubenchmarker.com/#/r/<payload>` plus a card image. Browsers never send the URL fragment (`#…`) in HTTP requests, so opening a link sends nothing about the result to the site. The page decodes it in the recipient's browser. Link previews keep the generic `og-image.png`; the card carries the result visually.

The result is **encoded, not encrypted**. Anyone with the link can read it, the same as with a screenshot. The format is open and nothing is signed, so sharing runs on the honor system. The checksum and the validity checks catch damage and careless edits, not determined forgery.

Code: `src/benchmark/share-codec.ts` (format), `src/app/share.ts` (link, text, card, share flow) and `src/app/shared-view.ts` (the `#/r/` page). Tests: `tests/share-codec.test.ts`.

## Binary layout, schema v1

Bits are packed most significant first, then base64url without padding (RFC 4648 §5). Each schema version keeps its own frozen lookup tables and decoder in the codec, so a v1 link decodes forever, even after the site's presets, durations or browser list change.

**Header**

| Field | Bits | Range / values | Scale |
|---|---|---|---|
| Schema version | 8 | 1. Higher shows "made by a newer version of the site" | — |
| Link type | 2 | 0 result · 1 challenge · 2 comparison (two runs) · 3 reserved | — |
| Reserved | 6 | must be 0 | — |

**Run record** (once, or twice for a comparison)

| Field | Bits | Range / values | Scale |
|---|---|---|---|
| Benchmark | 4 | 0 `openbenchmarker_neon_flythrough`, 1–15 reserved | — |
| Version major.minor.patch | 4 · 6 · 6 | 0–15 · 0–63 · 0–63 | — |
| Resolution | 3 | 720p · 1080p · 1440p · 4K (4–7 reserved) | — |
| Preset | 3 | Low · Medium · High · Ultra · Extreme (5–7 reserved) | — |
| Duration | 2 | 30 · 60 · 90 s · 3 = stress test (its length comes from the stress entry, tag 1) | — |
| Score test | 2 | none · Entry · Extreme (3 reserved) | — |
| Scored | 1 | 1 = valid, exactly matching score test | score = avg FPS × 100, recomputed, never stored |
| Avg FPS | 24 | 0–167,772.15 | 0.01 FPS (gives the score exactly) |
| 1% low FPS | 20 | 0–104,857.5 | 0.1 FPS |
| 5% low FPS | 20 | 0–104,857.5 | 0.1 FPS |
| Worst frame | 20 | 0–10,485.75 ms | 0.01 ms. The run records milliseconds and the results page shows 2 decimals, so this keeps it exact |
| Frames timed | 24 | 0–16,777,215 | 1 |
| Timing method | 2 | unknown · GPU timer · batch average | — |
| Graphics API | 1 | WebGL2 · WebGL1 | — |
| Run date | 16 | days since 1970-01-01 (to 2149) | 1 day |
| Browser | 4 | other · Chrome · Edge · Brave · Firefox · Safari · Opera · Vivaldi · Samsung Internet (9–15 reserved) | — |
| Browser major | 10 | 0 unknown, 1–1023 | — |
| OS | 3 | other · Windows · macOS · Linux · ChromeOS · Android · iOS/iPadOS | — |
| Device type | 2 | unknown · phone · tablet · desktop/laptop | — |
| iOS WebKit engine | 1 | 0/1 | — |
| GPU name length | 6 | 0–63 UTF-8 bytes, cut at a character boundary | — |
| GPU name | 8 × length | browser-reported label (plan 1's `normalizeGpuLabel`) | — |

**Trailer:** zero padding to a whole byte, then the optional **extension section**, then a **CRC-8** (SMBUS, poly 0x07) over every byte before it. A record without a GPU name is 184 bits (23 bytes), so a result link with no GPU name and no extensions is 2 + 23 + 1 = 26 bytes.

### Extension section (added in Plan 7, still v1)

Zero or more entries between the padding and the CRC, each **tag (1 byte), length (1 byte), value (length bytes)**:

- Decoders read every entry and skip tags they don't know (the payload keeps them in `ext`, so a re-encode gives the same link). New **optional** fields can join links this way with no version bump.
- Tag 0 is reserved (a stray zero byte after the padding still reads as damaged, as before). Tag 1 is the stress entry (below). Tags 2–255 are free; assign one here, with its value format, before using it.
- The version byte changes only for breaking changes: a new fixed field, a reordered table, or a different meaning for an existing bit.
- `memory_channels` and the other user-filled system fields are **not** in links (see below).

**Tag 1: stress entry.** One for each run whose Duration is 3 (stress test), written right after the padding, before any other entry. Each finished lap's avg FPS for Stress: Entry or Stress: Extreme:

| Byte | Contents |
|---|---|
| 0 | bit 7: run index (0, or 1 for a comparison's second run) · bit 6: laps in whole FPS (set only when a lap passes 6,553.5 FPS) · bits 5–0: test, 1 Entry, 2 Extreme |
| 1… | each lap's avg FPS, 2 bytes big-endian, in 0.1 FPS (or whole FPS with bit 6) |

The lap count is (length − 1) ÷ 2, and a lap is always 96 s (one pass of the flight), so Duration = laps × 96 s. A different lap length would be a new test number. Per-lap 1% lows stay in the saved result and aren't shared. Six laps make a 15-byte entry (+20 characters): a stress result with an RTX 5080 name is 121 characters, still QR version 7.
- Compatibility: v1 links made before the section existed have no bytes after the padding, so they decode exactly as before. `tests/share-codec.test.ts` pins four such codes (result, challenge, comparison, no GPU name) and checks that they decode to identical runs and re-encode to the same string. v1 had not reached production when the section was added, so no deployed decoder rejects entries.

Never in a link: the user-filled system fields, the diagnostics, the result id, the run time of day, or anything else from `BenchResult`.

### Decoding

A link is rejected as **"This link looks damaged or edited"** if any of these fail:
- base64url is malformed or isn't the canonical spelling. The last character's spare bits must be zero, so a single-character edit can't decode to the same bytes.
- The CRC-8 doesn't match. CRC-8 catches every error burst of 8 bits or fewer, which covers any single-character edit. The tests try every one.
- Bytes are truncated, the padding isn't zero, an extension entry is cut short or uses tag 0, an enum is out of range, or the GPU name isn't valid UTF-8.
- Plausibility fails. These checks are always true of real runs (see `computeRunStats`: every frame time is at least its share of the wall-clock):
  - 1% low ≤ 5% low ≤ avg, with 0.05 FPS for rounding.
  - The worst frame is no faster than the 1% low.
  - Frames ÷ avg (the timed wall-clock) is between 0.99 × duration and 1.01 × duration + 2 s + 4 frames. The run stops submitting at the duration, then waits for the batches still queued: at most three in flight (`MAX_IN_FLIGHT`), each at least one frame, plus scheduling slack. A 5 FPS phone can end about 0.8 s late.
  - The run date is between 2024-01-01 and tomorrow. Tomorrow is allowed because the run date is local time and "today" is UTC.
  - Stress runs: Duration 3 comes with exactly one stress entry, and the reverse. The test's locked preset, resolution and lap count must match, no score test, and the laps' mean must be within 1% (+0.05 FPS) of the run's avg FPS. Laps are equal wall-clock, so the mean of their throughputs is the run's avg up to a few batches and rounding.

## Length and QR size

Measured with the production origin (`https://opengpubenchmarker.com/#/r/` is 35 characters):

| Link | Length | QR version (ECC L / **M** / Q) |
|---|---|---|
| No GPU name | 70 | 4 / **5** / 6 |
| "Apple GPU" | 82 | 5 / **5** / 7 |
| "NVIDIA GeForce RTX 5080" | 101 | 5 / **6** / 8 |
| 40-character GPU name (the plan 1 cap) | 122 | 6 / **7** / 9 |
| Comparison, two RTX 5080 runs | 162 | — / **9** / — |
| Stress result, 6 laps, RTX 5080 | 121 | — / **7** / — |
| Comparison, two stress runs | 183 | — / **10** / — |

The card uses **ECC M** (15% recovery) with a 4-module quiet zone. M keeps the code at version 5–7 (37–45 modules), and screens and screenshots are clean enough that Q's extra redundancy isn't needed. On the 1200×630 card the code is about 300 px. Decoding the rendered card with jsQR worked at 1200, 600, 480, 420 and 300 px wide (a chat thumbnail).

The QR library is **`uqr` 0.1.3** (MIT, unjs, zero dependencies). It's a TypeScript port of Nayuki's widely used QR generator, and it reports the version used. It costs **10.2 KB minified, 3.9 KB gzipped**. `qrcode` pulls in pngjs and yargs, and `qrcode-generator` is larger.

## Card

One size, **1200×630**. It's the link-preview shape, so it shows uncropped in iMessage, Discord, X and Reddit, and it matches `og-image.png`. A 1080×1350 portrait version would suit phone feeds better, but it would mean a second layout to keep right. It can be added later if people ask.

```
┌──────────────────────────────────────────────────────────────┐
│ NEON FLYTHROUGH · v2.2.0                      ┌────────────┐ │
│ 143.2 AVG FPS          (huge, magenta glow)   │  ▓▓ QR ▓▓  │ │
│ 1% LOW   5% LOW                               │  ▓▓▓▓▓▓▓▓  │ │
│ 118.4    126.0                                └────────────┘ │
│ 4K · Extreme · 60 s                        Scan for the full │
│ Score: Extreme 14,321      (score runs only)        result   │
│ NVIDIA GeForce RTX 5080  reported by browser                 │
│ Edge 141 · Windows · 2026-10-22                              │
│ opengpubenchmarker.com   Shared on the honor system          │
└──────────────────────────────────────────────────────────────┘
```

The card uses the site's system font stacks (no web fonts), so there's nothing to load before drawing. It's drawn synchronously, and the PNG is built synchronously too (`toDataURL`). That way the Share button can hand it to `navigator.share` inside the tap; Safari rejects a share that happens after an `await`. Cards are only drawn on the results page and in My Results, after the run has released its WebGL context.

## Shared view (phone layout)

```
SHARED RESULT
Neon Flythrough · 4K · Extreme · 60 s
[ Score: Extreme 14321 ] [ Avg FPS 143.2 ]
[ 1% low 118.4 ]         [ 5% low 126.0 ]
[ Worst 11.37 ms ]       [ Frames 8600 ]
[ Run settings … ]
Benchmark · Run date · GPU (reported by the browser) · Browser and device · Timing
| Shared on the honor system. Measured in the sharer's browser;
| nothing is stored or verified. How sharing works →  (#/about, plan 7)
[ RUN THE SAME TEST ▶ ]  → home with the settings selected; a note says
                           whether your choice is like-for-like
```

Every decoded string goes through `esc()`. A test link whose GPU name was `<img src=x onerror=alert(1)>` showed it as plain text.

## Share flow

1. **Share my result** (and every other Share button) gives the share sheet the **link** (`url`) and a line of text, and **never attaches the card image**. Attaching the image made iOS Messages and other apps send only the picture, so the link got lost; that happened twice. The card is offered on its own through **Save image**. Guarded by `tests/share-keeps-link.test.ts` (part of `npm test`) and `npm run check:share`, which clicks every Share button at phone and desktop width. Where there's no share sheet (desktop Firefox, some Linux browsers) or it fails, the text and link are copied to the clipboard with a confirmation. Cancelling the sheet (`AbortError`) shows nothing.
2. **Copy link** and **Save image** are always next to it. "Preview the share card" shows the PNG.
3. In My Results, valid rows have a Share button that does step 1.

Share text, e.g.: *"Score: Extreme 14,321: 143.2 FPS avg, 118.4 1% low in the Neon Flythrough browser GPU benchmark (4K · Extreme · 60 s) on NVIDIA GeForce RTX 5080. Measured in my browser, shared on the honor system:"* followed by the link. It's about 190 characters, which fits on X with the link.

## Test steps

**Locally:** `npm test`, `npm run build`, `npm run preview`. Run a short 720p test, then on the results page:
1. Tap **Share result**. On desktop Chrome or Edge, the Windows share sheet should open with the image. Firefox should say "Link and text copied".
2. Tap **Copy link** and open the link in a private window. The shared view should match the results page.
3. Tap **Save image** and check the PNG.
4. In My Results, check that valid rows have Share and invalid rows don't.
5. Paste the link with its last character changed. It should say "damaged or edited".

**Preview** (`npm run preview:deploy`, then `https://share-results.opengpubenchmarker.com`). The link uses the page's own origin, so preview links open the preview.

| Device / browser | Share sheet with image | Text-only / copy fallback | Link opens shared view | QR scans off the card | Notes |
|---|---|---|---|---|---|
| iPhone, Safari | ✓ (the share sheet's preview icon is blank) | | | | 2026-10-22: Share and Copy link work; the share box layout is fine |
| Android, Chrome | | | | | |
| Desktop Chrome | | | | | |
| Desktop Edge | | | | | |
| Desktop Brave | | | | | |
| Desktop Firefox | — | copy | | | no Web Share |

QR scan test: show the card full-screen on one device and scan it with another phone's camera. Then do the same with a screenshot of the card sent through iMessage or Discord (the thumbnail and the opened image).

## Comparisons (Plan 5, revised after testing)

Sharing comes first: **Share my result** is the main button and always sends the **link** (`url`) and text, never an attached image (use Save image for the card). Comparing is a visible, separate option on every screen, on desktop as well as phones. You can compare against someone else's run or against one of your own earlier runs, in any browser or on any device. The numbers always show however far apart they are; only a different major benchmark version hides the %.

```
Any shared link (Share my result, an invite, or a comparison)
   ▼
Shared view: [Run the same test & compare]   [Compare with mine]
   ▼  same settings selected + banner "Comparing with 343.6 FPS avg … Press Start when you're ready"
   │  (nothing starts; "Stop comparing" turns it back into a plain run)
Home: [Start]  → the run carries the code (RunConfig.challenge → BenchResult.challenge)
   ▼
Result page, comparison first: Side by side (Compared with | This run), % and notes,
[Share the comparison] (primary) [Share this run only]; then this run in full, Details (open), submit
```

Where you can compare:
- **Home, "Compare with another run"** (below Run settings, collapsed until opened): paste a shared link or code, or pick one of your saved runs. The same settings get selected, the banner appears, and your next run shows side by side.
- **Results page, "Compare this run"** (under the share box): paste a link or code, or pick one of your runs. The panel opens in place, with **Share the comparison**.
- **My Results:** a **Compare** button on every card and in every table row. It opens the same box under the card, or as a full-width row in the table. **Open a shared result** is a visible input at the top.
- **Shared views:** **Compare with mine** is always shown. It uses your saved runs with the same settings and major version; if there are none it says so.

Notes (`src/app/compare.ts`, neutral wording):
- not like-for-like (different settings)
- different benchmark versions
- different devices (e.g. "iPad vs desktop/laptop")
- different browsers (Brave on iOS/WebKit counts as a different browser from Brave on Windows)
- "Same GPU and OS, different browser: this compares browsers"
- "Same browser, different GPU"
- within 0.5%: "about the same"

Link types:
- `challenge` (an invite) still exists. Every shared link is comparable now, so the share box no longer offers a separate invite.
- In a `comparison` link, `runs[0]` is the run compared with and `runs[1]` the other run.

Storage:
- `sessionStorage` `ogb.challenge.v1` holds the pending comparison (this tab only; it survives a reload or crash).
- The `challenge` field on the saved result keeps the comparison so you can look at it again. It's stripped from JSON export.

**Two-result links** (production origin, ECC M): two runs with typical GPU names are about 165 characters (QR version 9). With two 40-character GPU names, 181 characters (QR version 10). An invite with a 40-character GPU name is 122 characters (version 7). Rendered invite and comparison cards decode with jsQR at 1200, 600 and 420 px wide.

```
Comparison card (1200×630, neutral: the faster run only gets a small ▲ %)
1440P · ULTRA · 60 S · V2.2.0                          ┌──QR──┐
SHARED RUN            COMPARED RUN                     │      │
142.3                 155.0                            └──────┘
AVG FPS               AVG FPS ▲ 8.9%                Scan for both runs
1% low 118.4          1% low 121.0
NVIDIA GeForce RTX 5080   NVIDIA GeForce RTX 5080
Chrome 141 · Windows      Edge 141 · Windows
8.9% apart · Same GPU and OS, different browser: this compares browsers
opengpubenchmarker.com   Shared on the honor system
```

## Share codes

A code is just the end of a link: the part after `#/r/`. **Copy code** (share box, My Results ⋯) copies only that part, for places where a link is awkward. **Have a code?** (My Results, and the damaged-link page) opens any of these:
- a bare code
- `#/r/<code>`
- a full link from any host

Spaces, line breaks and trailing punctuation that chat apps add are ignored (`extractShareCode`). The code is decoded in the browser and nothing is sent anywhere. A bad code shows "damaged or edited".

### Demo (preview)
1. iPhone or iPad: run 720p Low → **Share my result** → send it to the PC. The link arrives with the image.
2. PC: open it → **Run the same test & compare** (settings selected, banner, nothing starts) → **Start**.
3. PC: the result opens comparison-first → **Share the comparison** → send it back.
4. Phone: open it → both runs side by side → **Compare with mine**.
5. PC: My Results → table view → **Compare** on a row → pick another of your runs, or paste the phone's code.

**Browser comparison on one PC:** run in Edge → Copy code → open Chrome → home **Compare**, paste the code → Start. The notes say "Same GPU and OS, different browser: this compares browsers".
