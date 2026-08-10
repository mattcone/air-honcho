/**
 * A canary for the RUNTIME, not for the game.
 *
 * CLAUDE.md §6 promises that the same seed and the same inputs give the same game,
 * and the save format leans on it harder than that: a save stores `rngState` and
 * expects a reload to carry on exactly where it left off. Both promises are made
 * across time — across a Node upgrade, a new machine, someone else's browser.
 *
 * Every other determinism test in this suite compares two runs INSIDE ONE PROCESS.
 * Those catch accidental shared state and stray `Math.random`, and they are worth
 * having, but they cannot see the failure this file is for: all 505 of them would
 * still pass on a runtime that had quietly changed what `Math.log` returns, while
 * every save in the wild diverged on reload.
 *
 * That is not hypothetical. ECMAScript does not specify `sin`, `cos`, `log`, `exp`,
 * `pow` or `atan2` to bit precision — implementations are free to differ in the last
 * place, and V8 has changed its own more than once. This sim sits on all of them:
 * `Rng.normal` is Box-Muller (`log`, `sqrt`, `cos`), great-circle distance is
 * spherical trigonometry (`sin`, `cos`, `atan2`, `asin`), and the fuel walk is a log-
 * space random walk.
 *
 * So these are literal expected values, asserted with `toBe` — full bit precision,
 * no tolerance. A failure here does NOT mean the game got worse. It means the ground
 * moved, and every existing save should be treated as suspect until someone works out
 * what changed and whether a save migration is owed.
 *
 * Deliberately pinned to PURE primitives — the RNG stream and the distance function —
 * and not to game outcomes. Those depend on `constants.json` and are supposed to move
 * whenever the balance is tuned; a canary that cried every time someone changed a
 * constant would be turned off within a week. Nothing here changes unless the
 * arithmetic itself does.
 *
 * Values generated on Node 26.7.0 / V8, macOS arm64, and verified byte-identical to a
 * 24-seed 100-turn fixture run on Node 26.6.0 before the upgrade that prompted this.
 */
import { describe, expect, it } from 'vitest';
import { Rng } from '../src/sim/rng.ts';
import { cityDistanceKm } from '../src/sim/world.ts';

describe('the runtime still does the same arithmetic', () => {
  it('draws the same raw stream from a fixed seed', () => {
    // Integer ops only (`Math.imul`, xor, shifts), so this is the control: if this
    // fails, something far more basic is wrong than a transcendental drifting.
    const rng = Rng.fromSeed(42);
    expect(Array.from({ length: 3 }, () => rng.next())).toEqual([
      0.48698886926285923, 0.50504879467189312, 0.071340484544634819,
    ]);
  });

  it('draws the same normals — Math.log, Math.sqrt and Math.cos', () => {
    // The fuel-price walk and all event jitter come through here.
    const rng = Rng.fromSeed(42);
    expect(Array.from({ length: 3 }, () => rng.normal())).toEqual([
      -1.1548041283078365, -0.29653971596502215, -1.0953749166737998,
    ]);
  });

  it('measures the same great circles — Math.sin, Math.cos, Math.atan2 and Math.asin', () => {
    // Distance feeds the gravity model, so a drift here moves demand on every sector
    // in the world at once. Three spans, because a short hop and an antipodal one
    // exercise different parts of the formula.
    expect(cityDistanceKm('LON', 'NYC')).toBe(5570.4522659340919);
    expect(cityDistanceKm('SYD', 'LON')).toBe(16994.091505217428);
    expect(cityDistanceKm('TYO', 'SAO')).toBe(18535.362517337671);
  });
});
