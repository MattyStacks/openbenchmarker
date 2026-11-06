import type { Preset } from '../benchmark/presets';
import type { TimedBatch } from '../benchmark/metrics';
import type { Flythrough } from './scenes';
export interface WorkerSettings {
  preset: Preset; width: number; height: number; duration: number; lapCount: number;
  cpuBatchMs: number; gpuBatchMs: number; inFlight: number; timers: boolean;
}
export interface WorkerReady {
  type: 'ready'; renderer: string; vendor: string; maxTextureSize: number; features: Flythrough['features'];
}
export interface WorkerProgress {
  type: 'progress'; sentAt: number; phase: 'warmup' | 'timed'; elapsed: number; timedStart: number;
  warm: TimedBatch[]; timed: TimedBatch[]; gpu: { frame: number; ms: number }[];
  recent: number[]; frames: number; lapStarts: number[];
}
export type WorkerOutput = WorkerReady | WorkerProgress | { type: "frame"; image: ImageBitmap } | { type: 'finished'; reason: string } | { type: 'error'; reason: string };
export type WorkerInput = { type: 'init'; canvas: OffscreenCanvas; settings: WorkerSettings } | { type: 'start' } | { type: 'present' } | { type: 'abort'; reason: string };
