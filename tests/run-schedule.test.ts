import { describe, expect, it } from "vitest";
import { BATCH_MS } from "../src/app/env";
import { nextBatchFrames } from "../src/benchmark/metrics";
import { QUEUE_DEPTH, queueSleepMs } from "../src/benchmark/run-schedule";

// A discrete-event model of the run loop in src/app/run.ts feeding a GPU queue, so a scheduling
// change tuned on one machine can't quietly starve another (3.1.0 was tuned on a Linux 2080 Ti and
// fed a Windows RTX 5080 only 25-55% of the time). Timers are the part a unit test can model: on
// Linux they fire within ~1 ms; on Windows the worst case is a whole system tick (15.6 ms), e.g.
// when no process has raised the timer resolution (Edge 157 on an idle page measured 1-2 ms late).
// Canvas presentation stalls can't be modelled here; npm run perf:matrix catches those.

interface Policy {
  depth: number;
  /** Frames for the next batch, from the last batch's frames and completion interval. */
  nextFrames(frames: number, ms: number, gpuFrameMs: number): number;
  /** Timer delay with the queue full and the oldest batch due in etaMs; 0 polls on the next task. */
  sleepMs(etaMs: number): number;
}

const current: Policy = {
  depth: QUEUE_DEPTH,
  nextFrames: (frames, ms) => nextBatchFrames(frames, ms, BATCH_MS),
  sleepMs: queueSleepMs,
};

/** 3.1.0's worker for light frames: two batches of ~4 ms GPU, and a 1 ms timer whenever the queue was full. */
const v310: Policy = {
  depth: 2,
  nextFrames: (_frames, _ms, gpuFrameMs) => Math.max(1, Math.round(4 / gpuFrameMs)),
  sleepMs: () => 1,
};

type Timer = (now: number, delay: number) => number;
/** Linux: high-resolution timers, a little late. */
const linuxTimer: Timer = (now, delay) => now + delay + 0.1;
/** Windows at the default timer resolution: fires on the next 15.625 ms system tick. */
const windowsTimer: Timer = (now, delay) => Math.ceil((now + delay) / 15.625 + 1e-9) * 15.625;

interface Machine {
  timer: Timer;
  /** Main-thread hiccup (GC, other tabs): the loop is blocked this long once a second. */
  hiccupMs?: number;
}

const MACHINES: Record<string, Machine> = {
  linux: { timer: linuxTimer },
  windows: { timer: windowsTimer },
  "windows + 30 ms hiccups": { timer: windowsTimer, hiccupMs: 30 },
  "linux + 30 ms hiccups": { timer: linuxTimer, hiccupMs: 30 },
};

/** GPU ms per frame from a phone-light Low frame up to Extreme on a slow GPU. */
const FRAME_GPU_MS = [0.3, 1.5, 4, 7, 10, 15, 25];

/** Page JavaScript per frame: small next to GPU time, as on the 5080 (0.16 ms at 1.55 ms GPU). */
const cpuMsFor = (gpuMs: number) => Math.min(2, 0.1 + gpuMs * 0.05);

const TASK_MS = 0.02; // a MessageChannel round trip
const FENCE_MS = 0.2; // GPU finish to fence signalled
const SETTLE_MS = 500;
const END_MS = 4000;

/** Run the loop against one GPU; returns the share of [SETTLE_MS, END_MS] the GPU was busy, and the share the loop slept. */
function simulate(policy: Policy, machine: Machine, gpuFrameMs: number): { gpuBusy: number; asleep: number } {
  const cpuFrameMs = cpuMsFor(gpuFrameMs);
  const flights: { done: number; frames: number }[] = [];
  let t = 0, gpuFreeAt = 0, gpuBusy = 0, asleep = 0;
  let lastComplete = 0, lastFrameMs = 0, batchFrames = 1, nextHiccup = 1000;
  const overlap = (a: number, b: number) => Math.max(0, Math.min(b, END_MS) - Math.max(a, SETTLE_MS));
  while (t < END_MS) {
    if (machine.hiccupMs && t >= nextHiccup) { t += machine.hiccupMs; nextHiccup += 1000; }
    let k = 0;
    while (k < flights.length && flights[k].done + FENCE_MS <= t) k++;
    if (k) {
      const done = flights.splice(0, k);
      const frames = done.reduce((n, f) => n + f.frames, 0);
      const ms = t - lastComplete;
      lastComplete = t;
      lastFrameMs = ms / frames;
      batchFrames = policy.nextFrames(Math.max(1, Math.round(frames / k)), ms / k, gpuFrameMs);
    }
    if (flights.length < policy.depth) {
      const tick0 = t;
      let n = 0;
      do { t += cpuFrameMs; n++; } while (n < batchFrames && t - tick0 < BATCH_MS);
      const start = Math.max(t, gpuFreeAt);
      gpuFreeAt = start + n * gpuFrameMs;
      gpuBusy += overlap(start, gpuFreeAt);
      flights.push({ done: gpuFreeAt, frames: n });
    }
    const sleep = flights.length >= policy.depth && lastFrameMs > 0 ? policy.sleepMs(lastComplete + lastFrameMs * flights[0].frames - t) : 0;
    const next = sleep ? machine.timer(t, sleep) : t + TASK_MS;
    if (sleep) asleep += overlap(t, next);
    t = next;
  }
  return { gpuBusy: gpuBusy / (END_MS - SETTLE_MS), asleep: asleep / (END_MS - SETTLE_MS) };
}

describe("run loop keeps every GPU fed on every OS", () => {
  for (const [name, machine] of Object.entries(MACHINES)) {
    for (const gpuMs of FRAME_GPU_MS) {
      it(`${name}: ${gpuMs} ms frames keep the GPU at least 95% busy`, () => {
        expect(simulate(current, machine, gpuMs).gpuBusy).toBeGreaterThanOrEqual(0.95);
      });
    }
  }

  it("heavy frames sleep on a timer instead of pinning a CPU core", () => {
    for (const machine of [MACHINES.linux, MACHINES.windows]) {
      expect(simulate(current, machine, 25).asleep).toBeGreaterThan(0.25);
    }
  });

  it("queue sleeps leave the oldest batch time to be noticed, and never sleep past MAX_SLEEP_MS", () => {
    expect(queueSleepMs(3)).toBe(0);
    expect(queueSleepMs(7)).toBe(0);
    expect(queueSleepMs(9)).toBe(4);
    expect(queueSleepMs(100)).toBe(10);
  });

  // The check above only matters if it can fail: a two-batch queue that sleeps whenever it is full
  // (3.1.0's worker) passes on Linux timers and fails on worst-case Windows timers.
  it("catches a shallow queue that sleeps whenever it is full on Windows timers", () => {
    expect(simulate(v310, MACHINES.linux, 1.5).gpuBusy).toBeGreaterThan(0.9);
    expect(simulate(v310, MACHINES.windows, 1.5).gpuBusy).toBeLessThan(0.8);
  });
});
