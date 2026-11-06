import { describe, expect, it, vi } from 'vitest';
import { PresentationQueue } from '../src/app/presentation-queue';
const frame = () => ({ close: vi.fn() });
describe('timestamped preview delivery', () => {
  it('keeps 120 Hz deadlines regular despite uneven completion times', () => {
    const q = new PresentationQueue();
    const frames = Array.from({ length: 6 }, frame);
    const step = 1000 / 120;
    // Completion notifications arrive in clumps, ahead of their playout deadlines.
    frames.slice(0, 3).forEach((f, i) => q.push(f, 50 + i * step, i + 6));
    expect(q.take(5, 40, true)).toBeNull();
    for (let i = 0; i < 3; i++) expect(q.take(i + 6, 50 + i * step, true)).toBe(frames[i]);
    frames.slice(3).forEach((f, i) => q.push(f, 50 + (i + 3) * step, i + 9));
    for (let i = 3; i < 6; i++) expect(q.take(i + 6, 50 + i * step, true)).toBe(frames[i]);
    expect(q.stats().fps).toBeCloseTo(120);
    expect(q.stats().maxMs).toBeCloseTo(step);
    expect(q.stats().dropped).toBe(0);
  });
  it('discards obsolete images after a missed deadline without displaying future frames', () => {
    const q = new PresentationQueue(); const a = frame(), b = frame(), c = frame();
    q.push(a, 50, 50); q.push(b, 60, 60); q.push(c, 70, 70);
    expect(q.take(65, 65, true)).toBe(b);
    expect(a.close).toHaveBeenCalledOnce();
    expect(b.close).not.toHaveBeenCalled();
    expect(c.close).not.toHaveBeenCalled();
    expect(q.stats().dropped).toBe(1);
    expect(q.take(70, 70, true)).toBe(c);
  });
  it('bounds retained graphics resources and releases them on abort', () => {
    const q = new PresentationQueue(2); const a = frame(), b = frame(), c = frame();
    q.push(a, 50, 50); q.push(b, 60, 60); q.push(c, 70, 70);
    expect(a.close).toHaveBeenCalledOnce();
    q.dispose();
    expect(b.close).toHaveBeenCalledOnce(); expect(c.close).toHaveBeenCalledOnce();
    expect(q.take(100, 100, true)).toBeNull();
  });
  it('excludes warmup handoffs from the timed presentation rate', () => {
    const q = new PresentationQueue();
    q.push(frame(), 50, 50); q.take(50, 50, false);
    q.push(frame(), 100, 100); q.take(100, 100, true);
    q.push(frame(), 110, 110); q.take(110, 110, true);
    expect(q.stats()).toMatchObject({ frames: 2, fps: 100, p95Ms: 10, maxMs: 10 });
  });
});

it('retains a full 50 ms buffer at 400 Hz without dropping images', () => {
  const q = new PresentationQueue();
  for (let tick = 1; tick <= 100; tick++) {
    q.push(frame(), (tick + 20) * 2.5, tick + 20);
    const image = q.take(tick, tick * 2.5, true);
    if (tick > 20) expect(image).not.toBeNull();
  }
  expect(q.stats()).toMatchObject({ frames: 80, fps: 400, dropped: 0 });
  q.dispose();
});
