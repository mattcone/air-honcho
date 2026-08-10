/**
 * The headless regression suite from the balance doctrine: N all-AI games x the
 * full horizon, asserting invariants rather than exact numbers. Exact numbers
 * would break on every balance tweak; invariants only break when the economy
 * does something it should never do.
 *
 * Phase 0 asserts the invariants that mean something with a placeholder economy.
 * The rest of the doctrine's list — no carrier above 90% global share by year 15,
 * median ULCC outliving median roll-up artist, fuel spikes denting margins —
 * needs rivals and events, and lands with Phase 2 and Phase 3.
 */
import { describe, expect, it } from 'vitest';
import { runGame, runGames, type RouteObservation } from '../src/sim/headless.ts';
import { archetypeCostAdvantage } from '../src/sim/costbase.ts';
import { getArchetype } from '../src/sim/ai/archetype.ts';
import { CONSTANTS } from '../src/sim/world.ts';

const GAMES = 20;
const HORIZON = CONSTANTS.game.horizonTurns;
const results = runGames(1000, GAMES, HORIZON);

describe(`${GAMES} all-AI games x ${HORIZON} turns`, () => {
  it('produces a finite, non-NaN result for every game', () => {
    for (const r of results) {
      expect(Number.isFinite(r.finalCash), `seed ${r.seed}`).toBe(true);
      expect(Number.isFinite(r.bestQuarter), `seed ${r.seed}`).toBe(true);
      expect(Number.isFinite(r.worstQuarter), `seed ${r.seed}`).toBe(true);
    }
  });

  it('always reaches an end state', () => {
    for (const r of results) {
      expect(r.gameOver, `seed ${r.seed} never ended`).not.toBeNull();
      expect(r.turnsPlayed).toBeLessThanOrEqual(HORIZON);
    }
  });

  it('does not bankrupt every carrier by year 10', () => {
    const aliveAtYear10 = results.filter((r) => r.bankruptTurn === null || r.bankruptTurn > 40);
    expect(aliveAtYear10.length).toBeGreaterThan(0);
  });

  it('never exceeds the per-sector aircraft cap', () => {
    for (const r of results) {
      expect(r.fleet).toBeLessThanOrEqual(r.routes * CONSTANTS.routes.maxAircraftPerRoute + 1);
    }
  });

  it('keeps a bankrupt carrier bankrupt — no resurrection', () => {
    // A carrier that was BOUGHT OUT is also out of the game, but with zero cash
    // rather than negative — distinguish it from one that went broke.
    for (const r of results.filter((r) => r.bankruptTurn !== null && !r.playerAcquired)) {
      expect(r.finalCash, `seed ${r.seed} came back from the dead`).toBeLessThan(0);
      expect(r.routes).toBe(0);
    }
  });

  it('spreads home bases around the world rather than clustering', () => {
    expect(new Set(results.map((r) => r.homeCityId)).size).toBeGreaterThan(GAMES / 2);
  });
});

describe('the economy is winnable and not degenerate', () => {
  const active = results.filter((r) => r.routes > 0 || r.finalNetWorth !== CONSTANTS.game.startingCash);

  it('has most seeds actually build an airline', () => {
    // A fixture that survives by never opening a route proves nothing. If this
    // drops, either the economy got harsh or the fixture got timid.
    expect(active.length / results.length).toBeGreaterThan(0.4);
  });

  it('lets a competent operator grow', () => {
    const grew = active.filter((r) => r.finalNetWorth > CONSTANTS.game.startingCash * 1.5);
    expect(grew.length, 'nobody grew past 1.5x starting net worth').toBeGreaterThan(0);
  });

  it('keeps load factors plausible where sectors are flown', () => {
    for (const r of results.filter((r) => r.routes > 0)) {
      expect(r.finalLoadFactor, `seed ${r.seed}`).toBeGreaterThan(0.3);
      expect(r.finalLoadFactor, `seed ${r.seed}`).toBeLessThanOrEqual(1);
    }
  });

  it('does not let one carrier own the world', () => {
    // No global-share model until Phase 2; the proxy is that nobody saturates
    // every sector cap across a huge network.
    for (const r of results) {
      expect(r.routes, `seed ${r.seed}`).toBeLessThan(60);
    }
  });
});

describe('the world fills with rivals', () => {
  it('brings carriers in on every seed', () => {
    // Entered, not survived: since Phase 3 a rival can be wiped out by a fuel
    // spike or a grounding, and a game where they all failed is a real outcome.
    for (const r of results) {
      expect(r.rivalsEntered, `seed ${r.seed} faced nobody`).toBeGreaterThan(0);
    }
  });

  it('lets rivals fail, but not routinely', () => {
    const entered = results.reduce((s, r) => s + r.rivalsEntered, 0);
    const failed = results.reduce((s, r) => s + r.rivalsFailed, 0);
    expect(failed, 'no rival ever failed').toBeGreaterThan(0);
    expect(failed / entered, 'rivals are being wiped out').toBeLessThan(0.4);
  });

  it('gives rivals a real presence rather than a token one', () => {
    const withNetworks = results.filter((r) => r.rivalRoutes > r.rivals);
    expect(withNetworks.length / results.length).toBeGreaterThan(0.8);
  });

  it('does not let the player quietly own the world', () => {
    // If the player ends up holding most sectors, rivals are not competing.
    const mean = results.reduce((s, r) => s + r.playerRouteShare, 0) / results.length;
    expect(mean).toBeLessThan(0.5);
  });

  it('varies the size of the field between seeds', () => {
    expect(new Set(results.map((r) => r.rivals)).size).toBeGreaterThan(1);
  });
});

describe('archetypes behave like themselves', () => {
  // CLAUDE.md §9 wants a ULCC to outlive a roll-up artist. That is a survival
  // RATE, and at hazards near 0.1 per 100 quarters it takes on the order of a
  // hundred games to measure — far more than this suite runs, and asserting it
  // on twenty games flakes on whether the roll-up happened to fail at all.
  //
  // So the outcome is tracked by hand via `npm run simulate` (recorded in
  // DECISIONS.md) and what is pinned here is the mechanism that produces it,
  // which is exact and cheap.
  it('gives the low-cost carrier a real cost advantage, not just lower fares', () => {
    expect(archetypeCostAdvantage('ulcc')).toBeLessThan(archetypeCostAdvantage('rollup'));
    expect(archetypeCostAdvantage('ulcc')).toBeLessThan(archetypeCostAdvantage('legacy'));
    // Real low-cost carriers run 40-50% below a legacy network carrier all-in,
    // so a tenth off the controllable lines is the floor of what counts.
    expect(archetypeCostAdvantage('ulcc')).toBeLessThanOrEqual(0.9);
  });

  it('gives the state-backed carrier the deepest pockets', () => {
    const cash = (id: string) => getArchetype(id).startingCash;
    expect(cash('flag')).toBeGreaterThan(cash('ulcc'));
    expect(cash('flag')).toBeGreaterThan(cash('rollup'));
    // And the willingness to fly at a loss for share, which is its whole point.
    expect(getArchetype('flag').minProjectedNetPerQuarter).toBeLessThan(0);
  });

  it('leaves the roll-up artist thinly capitalized, as designed', () => {
    const roll = getArchetype('rollup');
    expect(roll.reserveCash).toBeLessThan(getArchetype('legacy').reserveCash);
    expect(roll.growthDrag!).toBeLessThan(getArchetype('legacy').growthDrag!);
  });

  it('does at least see rivals fail across the suite', () => {
    const failed = results.reduce(
      (sum, r) => sum + Object.values(r.rivalHazard).reduce((s, h) => s + h.failed, 0),
      0,
    );
    expect(failed, 'no rival failed anywhere — Phase 3 variance is not biting').toBeGreaterThan(0);
  });
});

describe('two games feel meaningfully different', () => {
  // Phase 3's stated acceptance test. Variety has to show up in what actually
  // happened, not just in the seed.
  it('varies the fuel market run to run', () => {
    const fuel = results.map((r) => r.finalFuelPrice);
    const spread = Math.max(...fuel) / Math.min(...fuel);
    expect(spread, 'every game ended at the same fuel price').toBeGreaterThan(1.5);
  });

  it('varies which events a game lived through', () => {
    const decks = results.map((r) => [...r.eventsSeen].sort().join(','));
    expect(new Set(decks).size / decks.length).toBeGreaterThan(0.6);
  });

  it('subjects every game to some kind of shock', () => {
    const quiet = results.filter((r) => r.eventsSeen.length === 0);
    expect(quiet.length / results.length).toBeLessThan(0.2);
  });

  it('produces genuinely different outcomes, not the same game with noise', () => {
    // How wide the middle half of outcomes is, against the typical magnitude of an
    // outcome. A tight cluster would mean the seed changes the scenery and nothing
    // else.
    //
    // Scaled by MEAN MAGNITUDE rather than the median: now that takeover is a real
    // loss condition, outcomes are bimodal — a seized carrier finishes at exactly
    // zero, a surviving one in the billions — so the median can legitimately sit
    // on 0 with half the games worth billions. That is the widest possible spread,
    // yet a median-relative measure divides by zero and reads it as no variety at
    // all. The mean magnitude has no such blind spot.
    /*
     * Spread of outcomes, as a coefficient of variation over ALL twenty games.
     *
     * This replaces an interquartile range scaled by the mean magnitude, and the
     * reason is methodological rather than convenient. That measure read only two
     * of the twenty data points, and which two depends entirely on where the
     * bankrupt/surviving boundary falls: near a 50% survival rate p25 sits at zero
     * and p75 in the billions and it reads enormous, while at a high survival rate
     * both quartiles land inside the surviving band and it compresses however
     * varied the games actually were. So it measured the survival draw as much as
     * the variety. Across six seed bases it ranged 0.41 to 2.23 — a 5.4x spread on
     * a quantity that is supposed to be a property of the game, not of the base.
     *
     * A coefficient of variation uses every game, is the standard statistic for
     * exactly this question, and over the same six bases ranges 0.48 to 1.05. It
     * still goes to zero if every game ends the same way, which is the thing the
     * Phase 3 acceptance criterion is actually about.
     *
     * Found because Chapter 11 moved ONE fixture from 14 survivors to 17 and
     * failed the old measure, while leaving mean divergence across bases
     * unchanged (1.567 before, 1.580 after) — the change was in the instrument,
     * not in the game.
     */
    const magnitudes = results.map((r) => Math.abs(r.finalNetWorth));
    const mean = magnitudes.reduce((s, v) => s + v, 0) / magnitudes.length;
    expect(mean, 'every game ended at nothing').toBeGreaterThan(0);
    const variance =
      magnitudes.reduce((s, v) => s + (v - mean) ** 2, 0) / magnitudes.length;
    const spread = Math.sqrt(variance) / mean;
    expect(spread, 'outcomes cluster — the seed changes the scenery and nothing else')
      .toBeGreaterThan(0.35);
    // And the games must not merely differ in size — they must end differently.
    expect(new Set(results.map((r) => String(r.gameOver))).size).toBeGreaterThan(1);
  });
});

describe('reproducibility', () => {
  // Each of these runs several full games inside the test, so they need more than
  // the default per-test budget.
  it('gives byte-identical results for a repeated seed', () => {
    expect(runGame(4242)).toEqual(runGame(4242));
  });

  it('gives different results for different seeds', () => {
    const cash = runGames(500, 8).map((r) => r.finalCash);
    expect(new Set(cash).size).toBeGreaterThan(1);
  // Budgets raised 2026-08-07: the funded growth allowance lets rivals deploy cash as
  // fast as they earn it, so a hundred-turn game now carries several times the routes
  // and fleet it used to. These fixtures are unchanged — the WORK per game grew.
  }, 240_000);

  it('does not depend on how many games ran before it', () => {
    // Catches accidental shared mutable state between runs.
    const alone = runGame(777);
    runGames(0, 5);
    expect(runGame(777)).toEqual(alone);
  });
});

/**
 * Demand-model shape, from docs/demand-audit.md (2026-07-28).
 *
 * The audit found load factor pinned to its ceiling on 83.8% of sector-quarters,
 * making it a constant read back rather than an outcome. These assertions encode
 * the SHAPE the model is supposed to have, not the figures it happens to hit, so
 * a future balance change cannot silently re-flatten the game.
 *
 * Deliberately loose, and each carries the value measured on the day it was
 * written so a drift is legible rather than mysterious. The load-factor bounds in
 * particular want tightening hard once spill is redistributed (proposal P1) —
 * they are a ratchet against regression, not a statement that today is healthy.
 */
describe('demand model shape', () => {
  const rows: RouteObservation[] = [];
  for (let seed = 2000; seed < 2006; seed++) {
    runGame(seed, HORIZON, 'present', 'medium', (batch) => {
      for (const r of batch) rows.push(r);
    });
  }

  const sorted = (pick: (r: RouteObservation) => number): number[] =>
    rows.map(pick).sort((a, b) => a - b);
  const quantile = (xs: readonly number[], q: number): number =>
    xs.length ? xs[Math.min(xs.length - 1, Math.floor((xs.length - 1) * q))]! : 0;

  it('observes enough sector-quarters to say anything', () => {
    expect(rows.length).toBeGreaterThan(5_000);
  });

  it('does not let the load ceiling swallow the whole distribution', () => {
    // 83.8% at the ceiling when written. Above 95% would mean load factor has
    // stopped being an outcome altogether.
    const atCeiling = rows.filter((r) => r.loadFactor >= r.loadCeiling - 0.005).length;
    expect(atCeiling / rows.length).toBeLessThan(0.95);
  });

  it('keeps some spread in load factor', () => {
    /*
     * REGRESSED DELIBERATELY, 2026-07-30. The spread was 2.9 points when this was
     * written and is now ~1.5, because the competition load penalty became
     * saturation-aware: a contested sector on a market with demand to spare
     * returns to the ceiling instead of being punished for having company. That
     * bought multi-carrier markets, which the game needs and did not have — 97.9%
     * of served markets held exactly one carrier — at the cost of making an
     * already-flat distribution flatter.
     *
     * The bound is lowered rather than deleted so it still catches a TOTAL
     * collapse, and it should be raised back once P1 (redistributing spill rather
     * than deleting it, docs/demand-audit.md) does the job properly. Load factor
     * being pinned is that document's finding, not this assertion's to fix.
     */
    const lf = sorted((r) => r.loadFactor * 100);
    expect(quantile(lf, 0.75) - quantile(lf, 0.25)).toBeGreaterThan(1);
  });

  it('keeps a real spread in margin', () => {
    // 17 points p25->p75 when written. Margin is the healthy axis today.
    const m = sorted((r) => r.margin * 100);
    expect(quantile(m, 0.75) - quantile(m, 0.25)).toBeGreaterThan(8);
  });

  it('leaves some sectors losing money', () => {
    // 4.6% when written, and the audit wants MORE, not fewer. Zero would mean
    // every route is a winner and route choice has stopped mattering.
    const losing = rows.filter((r) => r.netCash < 0).length;
    expect(losing / rows.length).toBeGreaterThan(0.01);
  });

  it('does not let long-haul become structurally dead', () => {
    // The reported symptom. Median margins were 3.4 points apart when written;
    // a 20-point gap would mean the distance bands have genuinely diverged.
    const band = (f: (km: number) => boolean): number => {
      const m = rows.filter((r) => f(r.distanceKm)).map((r) => r.margin * 100).sort((a, b) => a - b);
      return quantile(m, 0.5);
    };
    const short = band((km) => km < 1500);
    const long = band((km) => km > 5000);
    expect(Math.abs(short - long)).toBeLessThan(20);
  });

  it('keeps competition biting on margin', () => {
    // Contested 24.9% vs uncontested 32.8% when written. If these converge,
    // rival entry has stopped being felt and pillar 4 is broken.
    const med = (rs: readonly RouteObservation[]): number =>
      quantile(rs.map((r) => r.margin * 100).sort((a, b) => a - b), 0.5);
    const alone = rows.filter((r) => r.competitors === 0);
    const contested = rows.filter((r) => r.competitors > 0);
    expect(alone.length).toBeGreaterThan(100);
    expect(contested.length).toBeGreaterThan(100);
    expect(med(alone) - med(contested)).toBeGreaterThan(2);
  });
});
