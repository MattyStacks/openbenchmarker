# Phone reference (checked by hand)

Phones can't run `npm run perf:matrix`, so check Low/720p on Matt's iPhone (Safari, "Apple GPU")
against a preview deploy before any release that touches the render loop or the presets.

| Version | Low/720p avg FPS | Notes |
|---|---:|---|
| 2.2.0 | ~300 | The reference: Low must stay light enough for phones. |
| 3.1.0 | 17–21 | 64-step haze on Low; YAML `limit: gpu`, 41.7 of 47 ms per frame waiting on the GPU. Withdrawn by 4.0.0. |
| 4.0.0 | to check | Same presets and loop as 2.2.0, so expect ~300. |

A Low/720p result far below the 2.2.0 figure means Low got heavier: see the phone-light test
in `tests/scene.test.ts`.
