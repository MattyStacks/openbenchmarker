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
