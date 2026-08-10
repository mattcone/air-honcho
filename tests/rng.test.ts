import { describe, expect, it } from 'vitest';
import { Rng, hashSeed, seedToState } from '../src/sim/rng.ts';

describe('Rng', () => {
  it('produces the same stream for the same seed', () => {
    const a = Rng.fromSeed(42);
    const b = Rng.fromSeed(42);
    const drawA = Array.from({ length: 50 }, () => a.next());
    const drawB = Array.from({ length: 50 }, () => b.next());
    expect(drawA).toEqual(drawB);
  });

  it('decorrelates adjacent seeds', () => {
    // Without the seed mix, mulberry32 gives near-identical opening draws for
    // seeds 1, 2, 3 — which would make "try seed+1" feel like the same game.
    const firsts = [1, 2, 3, 4, 5].map((s) => Rng.fromSeed(s).next());
    for (let i = 1; i < firsts.length; i++) {
      expect(Math.abs((firsts[i] as number) - (firsts[i - 1] as number))).toBeGreaterThan(0.01);
    }
  });

  it('resumes exactly from a saved state', () => {
    const original = Rng.fromSeed(7);
    for (let i = 0; i < 10; i++) original.next();

    const resumed = new Rng(original.save());
    expect(Array.from({ length: 20 }, () => resumed.next())).toEqual(
      Array.from({ length: 20 }, () => original.next()),
    );
  });

  it('survives a JSON round-trip of its state', () => {
    const rng = Rng.fromSeed(99);
    rng.next();
    const revived = new Rng(JSON.parse(JSON.stringify({ s: rng.save() })).s);
    expect(revived.next()).toBe(new Rng(rng.save()).next());
  });

  it('stays in [0, 1)', () => {
    const rng = Rng.fromSeed(3);
    for (let i = 0; i < 20000; i++) {
      const v = rng.next();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('covers the full inclusive range of int()', () => {
    const rng = Rng.fromSeed(11);
    const seen = new Set<number>();
    for (let i = 0; i < 5000; i++) seen.add(rng.int(1, 6));
    expect([...seen].sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('draws a roughly standard normal', () => {
    const rng = Rng.fromSeed(5);
    const n = 50000;
    let sum = 0;
    let sumSq = 0;
    for (let i = 0; i < n; i++) {
      const v = rng.normal();
      sum += v;
      sumSq += v * v;
    }
    const mean = sum / n;
    expect(Math.abs(mean)).toBeLessThan(0.02);
    expect(Math.abs(Math.sqrt(sumSq / n - mean * mean) - 1)).toBeLessThan(0.03);
  });

  it('shuffles without mutating the input', () => {
    const source = Object.freeze([1, 2, 3, 4, 5, 6, 7, 8]);
    const shuffled = Rng.fromSeed(1).shuffle(source);
    expect(source).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect([...shuffled].sort((a, b) => a - b)).toEqual([...source]);
  });

  it('throws rather than returning undefined from an empty pick', () => {
    expect(() => Rng.fromSeed(1).pick([])).toThrow(/empty/);
  });

  it('hashes seed strings stably and distinctly', () => {
    expect(hashSeed('golden-goose')).toBe(hashSeed('golden-goose'));
    expect(hashSeed('golden-goose')).not.toBe(hashSeed('golden-geese'));
  });

  it('keeps seed state a uint32', () => {
    for (const seed of [0, 1, 2 ** 31, 2 ** 32 - 1]) {
      const state = seedToState(seed);
      expect(Number.isInteger(state)).toBe(true);
      expect(state).toBeGreaterThanOrEqual(0);
      expect(state).toBeLessThan(2 ** 32);
    }
  });
});
