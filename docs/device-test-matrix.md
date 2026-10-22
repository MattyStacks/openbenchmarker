# Device test matrix (high resolution)

Filled in by hand while testing the preview, `https://share-results.opengpubenchmarker.com`. The site never collects these results. Background is in [high-res-memory.md](high-res-memory.md).

How to test each device:
1. Run each combo below. Use 30 s runs, which are enough to show a crash.
2. Write the outcome in the cell:
   - **✓** finished
   - **✗** the browser closed or reloaded the page. The next load should show "Your last run … didn't finish".
   - **CL** context lost. The run ends on its own and is marked invalid.
   - **–** not tried
3. If a run crashes, check that the notice appears after the reload, that "Run at 1080p" works, and that the combo shows "Didn't finish on this device last time".
4. Note the device's RAM, and `navigator.deviceMemory` if the phone confirmation shows it.

Combos: 1080p Extreme (control), then 1440p High, 1440p Ultra, 1440p Extreme, 4K Low, 4K Medium, 4K Ultra, 4K Extreme.

| Device / browser | RAM | 1080p Ext | 1440p High | 1440p Ultra | 1440p Ext | 4K Low | 4K Med | 4K Ultra | 4K Ext | Notes |
|---|---|---|---|---|---|---|---|---|---|---|
| iPhone, Safari | | ✓ | ✓ | ✗ | ✗ | – | – | – | – | 2026-10-22. Plan 2 preview: the phone confirmation and the "didn't finish" notice both appeared |
| iPhone, Chrome (WebKit) | | | | | | | | | | |
| iPad, Safari | | | | | | | | | | |
| Android high-RAM, Chrome | | | | | | | | | | |
| Android low-RAM, Chrome | | | | | | | | | | |
| Android, Samsung Internet | | | | | | | | | | |
