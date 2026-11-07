import { describe, expect, it } from 'vitest';
import { PreviewCadence } from '../src/app/preview-cadence';
describe('display-independent preview cadence', () => {
  for (const hz of [60, 90, 120, 144, 165, 240, 400]) {
    for (const throughput of [40, 155, 215, 600]) {
      it(`uses a regular display divisor at ${hz} Hz with ${throughput} render FPS`, () => {
        const c = new PreviewCadence(); const step = 1000 / hz;
        for (let i = 1; i <= Math.ceil(hz * 3); i++) c.advance(i * step, throughput, true);
        const divisor = Math.ceil(hz / (throughput * .9));
        expect(c.divisor).toBe(divisor);
        expect(c.delayTicks % divisor).toBe(0);
        const requested: number[] = [];
        for (let i = Math.ceil(hz * 3) + 1; i < hz * 5; i++) {
          if (c.advance(i * step, throughput, false).request) requested.push(c.tick);
        }
        expect(requested.length).toBeGreaterThan(0);
        for (let i = 1; i < requested.length; i++) expect(requested[i] - requested[i - 1]).toBe(divisor);
      });
    }
  }
  it('adapts when a window moves between refresh rates without changing the rendered workload', () => {
    const c = new PreviewCadence();
    for (let i = 1; i <= 360; i++) c.advance(i * 1000 / 120, 215, true);
    expect(c.divisor).toBe(1);
    let reset = false;
    for (let i = 1; i <= 800; i++) reset = c.advance(3000 + i * 1000 / 400, 215, false).reset || reset;
    expect(c.divisor).toBe(3);
    expect(reset).toBe(true);
  });
  it('does not switch cadence for an isolated delayed callback during the timed run', () => {
    const c = new PreviewCadence();
    for (let i = 1; i <= 360; i++) c.advance(i * 1000 / 120, 155, true);
    expect(c.advance(3050, 155, false).reset).toBe(false);
    expect(c.divisor).toBe(1);
  });
});

it('advances past missed refreshes instead of stretching buffered playback', () => {
  const c = new PreviewCadence();
  for (let i = 1; i <= 360; i++) c.advance(i * 1000 / 120, 215, true);
  const tick = c.tick;
  c.advance(3025, 215, false);
  expect(c.tick - tick).toBe(3);
});

it('backs off preview traffic for sustained compositor misses despite high render FPS', () => {
  const c = new PreviewCadence();
  for (let i = 1; i <= 360; i++) c.advance(i * 1000 / 120, 195, true);
  let now = 3000;
  // Approximate the report: fast median refresh but only ~75 callbacks/sec.
  for (let i = 0; i < 180; i++) { now += [8.4, 8.4, 16.8, 8.4, 25.2][i % 5]; c.advance(now, 195, false); }
  expect(c.divisor).toBe(2);
  expect(c.callbackStats().callbackFps).toBeLessThan(80);
  // Recovery does not make it oscillate back to the unsustainable rate mid-run.
  for (let i = 0; i < 240; i++) { now += 1000 / 120; c.advance(now, 195, false); }
  expect(c.divisor).toBe(2);
});

it('requests a current image when a delayed callback crosses a cadence boundary', () => {
  const c = new PreviewCadence();
  for (let i = 1; i <= 360; i++) c.advance(i * 1000 / 120, 90, true);
  expect(c.divisor).toBe(2);
  const next = c.advance(3025, 90, false);
  expect(next.request).toBe(true);
});
