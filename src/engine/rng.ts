/** Deterministic PRNG (mulberry32). Every random choice in the scene comes from one of these. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The scene seed. Same seed + same preset = same frames on every machine. */
export const SEED = 1984;

/**
 * Independent mulberry32 stream per subsystem, so tuning one subsystem never shifts another's
 * layout. `salt` is a fixed small integer per subsystem.
 */
export function stream(seed: number, salt: number): () => number {
  return mulberry32((Math.imul(seed ^ 0x9e3779b9, 0x85ebca6b) + Math.imul(salt + 1, 0xc2b2ae35)) >>> 0);
}

export const pick = <T>(rnd: () => number, arr: readonly T[]): T => arr[Math.floor(rnd() * arr.length)];
export const range = (rnd: () => number, a: number, b: number) => a + rnd() * (b - a);
