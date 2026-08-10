/**
 * Seeded PRNG. `Math.random` is banned everywhere in /sim — same seed plus same
 * inputs must always produce the same game.
 *
 * mulberry32: 32-bit state, fast, good enough distribution for a turn-based
 * economic sim, and the entire generator state is a single uint32 — which is
 * what makes it cheap to serialize into a save file.
 */

/** The complete, serializable state of a generator. */
export type RngState = number;

export function seedToState(seed: number): RngState {
  // Mix the seed so that adjacent seeds (1, 2, 3...) don't produce correlated
  // opening games. Any avalanche mix works; this is the fmix32 finalizer.
  let h = seed >>> 0;
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

/** Hash an arbitrary string to a seed, so games can be shared by name. */
export function hashSeed(text: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export class Rng {
  private state: RngState;

  constructor(state: RngState) {
    this.state = state >>> 0;
  }

  static fromSeed(seed: number): Rng {
    return new Rng(seedToState(seed));
  }

  /** Snapshot for the save file. */
  save(): RngState {
    return this.state;
  }

  /** Uniform in [0, 1). */
  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Uniform in [min, max). */
  float(min: number, max: number): number {
    return min + this.next() * (max - min);
  }

  /** Uniform integer in [min, max] inclusive. */
  int(min: number, max: number): number {
    return min + Math.floor(this.next() * (max - min + 1));
  }

  /** True with the given probability. */
  chance(p: number): boolean {
    return this.next() < p;
  }

  /** Standard normal via Box–Muller. Used for fuel-price walks and event jitter. */
  normal(mean = 0, stdDev = 1): number {
    // u must be non-zero for the log.
    const u = 1 - this.next();
    const v = this.next();
    const z = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
    return mean + z * stdDev;
  }

  pick<T>(items: readonly T[]): T {
    if (items.length === 0) throw new Error('Rng.pick: empty array');
    return items[this.int(0, items.length - 1)] as T;
  }

  /** Fisher–Yates on a copy; the input is left alone. */
  shuffle<T>(items: readonly T[]): T[] {
    const out = items.slice();
    for (let i = out.length - 1; i > 0; i--) {
      const j = this.int(0, i);
      const a = out[i] as T;
      out[i] = out[j] as T;
      out[j] = a;
    }
    return out;
  }
}
