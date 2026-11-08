import type { Preset } from '../benchmark/presets';
import type { TimedBatch } from '../benchmark/metrics';
import type { Flythrough } from './scenes';
export interface WorkerSettings {
  preset: Preset; width: number; height: number; duration: number; lapCount: number;
  cpuBatchMs: number; gpuBatchMs: number; inFlight: number; timers: boolean;
  /** GPU work (ms) to keep queued; 0 keeps the batch-count limit only. */
  queueMs?: number;
  /**
   * Heavy frames (longer than gpuBatchMs × inFlight) up to leadMaxFrameMs: queue the next frame
   * once less than leadMs of GPU work is estimated outstanding. Longer frames run one at a time.
   */
  leadMs: number; leadMaxFrameMs: number;
  /** One heavy frame at a time: poll every task once its estimated finish is this close (ms). */
  spinMs: number;
}
export interface WorkerReady {
  type: 'ready'; renderer: string; vendor: string; maxTextureSize: number; features: Flythrough['features'];
}
export interface WorkerProgress {
  type: 'progress'; sentAt: number; phase: 'warmup' | 'timed'; elapsed: number; timedStart: number;
  warm: TimedBatch[]; timed: TimedBatch[]; gpu: { frame: number; ms: number }[];
  recent: number[]; frames: number; lapStarts: number[];
}
export type WorkerOutput = WorkerReady | WorkerProgress | { type: "frame"; image: ImageBitmap; targetAt: number; targetTick: number; generation: number; sampledAt: number; receivedAt: number; renderedAt: number; postedAt: number } | { type: 'finished'; reason: string } | { type: 'error'; reason: string };
export type WorkerInput = { type: 'init'; canvas: OffscreenCanvas; settings: WorkerSettings } | { type: 'start' } | { type: 'present'; sampledAt: number; targetAt: number; targetTick: number; generation: number } | { type: 'abort'; reason: string };
