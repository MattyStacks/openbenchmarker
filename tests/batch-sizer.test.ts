import { describe, expect, it } from 'vitest';
import { BatchSizer } from '../src/benchmark/batch-sizer';
describe('GPU batch sizing', () => {
  it('does not grow batches when fence notification intervals alternate between long and near-zero', () => {
    const sizer = new BatchSizer(16);
    for (let i = 0; i < 100; i++) {
      expect(sizer.observe(3, 36, 6)).toBe(3);
      expect(sizer.observe(3, 0.01, 6)).toBe(3);
    }
  });
  it('averages fence notification jitter when GPU timers are unavailable', () => {
    const sizer = new BatchSizer(16);
    for (let i = 0; i < 5; i++) { sizer.observe(3, 36, null); sizer.observe(3, 0, null); }
    const stable = sizer.observe(3, 0.01, null);
    expect(stable).toBeGreaterThanOrEqual(2);
    expect(stable).toBeLessThanOrEqual(3);
    expect(sizer.observe(3, 0.01, null)).toBe(stable);
  });
  it('responds to real GPU cost changes, while bounding batch sizes', () => {
    const sizer = new BatchSizer(16);
    expect(sizer.observe(1, 1, 0.5)).toBe(32);
    expect(sizer.observe(1, 1, 8)).toBe(2);
    expect(sizer.observe(1, 1, 32)).toBe(1);
    expect(sizer.observe(1, 1, 0.00001)).toBe(256);
  });
});
