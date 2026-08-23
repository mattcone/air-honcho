/**
 * Rivals: the cast that gets dealt, how they enter, and whether they actually
 * compete. Phase 2's acceptance test is that the player changes decisions
 * because of what rivals do, so the tests that matter most here are the ones
 * about pressure, not about plumbing.
 */
import { describe, expect, it } from 'vitest';
import { archetypeCostAdvantage } from '../src/sim/costbase.ts';
import { applyAction, endTurn, getCarrier, newGame } from '../src/sim/engine.ts';
import { Rng } from '../src/sim/rng.ts';
import { CONSTANTS, difficultyMods } from '../src/sim/world.ts';
import {
  ARCHETYPES, admitRival, effectiveConfig, getArchetype, maybeDefend, maybeSpawnEntrant, planRivals,
  playerAttention, plannedRival,
} from '../src/sim/ai/archetype.ts';
import { buildMarketIndex, rivalsOf } from '../src/sim/economics.ts';
import { controlledBy } from '../src/sim/market.ts';
import { maybeInvestInTech, candidateTypes, hubDominance, marketIndex, pruneLosers } from '../src/sim/ai/common.ts';
import { TECH_NODES } from '../src/sim/tech.ts';
import rivalData from '../src/data/rivals.json' with { type: 'json' };
const GAUGE_SPREAD = rivalData.draw.gaugeBiasSpread;
const MAX_RIVALS = rivalData.draw.maxRivals;
const MIN_RIVALS = rivalData.draw.minRivals;
import type { GameState, PlannedRival } from '../src/sim/types.ts';

const plan = (seed: number): PlannedRival[] => planRivals(Rng.fromSeed(seed));

describe('the cast is dealt, not fixed', () => {
  it('is identical for the same seed', () => {
    expect(plan(7)).toEqual(plan(7));
    expect(newGame(7, 'LON').rivalPlan).toEqual(newGame(7, 'LON').rivalPlan);
  });

  it('differs between seeds', () => {
    const casts = [1, 2, 3, 4, 5, 6].map((s) => JSON.stringify(plan(s)));
    expect(new Set(casts).size).toBe(casts.length);
  });

  it('varies who turns up, not just their order', () => {
    const names = [1, 2, 3, 4, 5, 6, 7, 8].map((s) => plan(s).map((r) => r.name).sort().join(','));
    expect(new Set(names).size).toBeGreaterThan(1);
  });

  it('varies how many turn up', () => {
    const counts = new Set(Array.from({ length: 30 }, (_, i) => plan(i).length));
    expect(counts.size).toBeGreaterThan(1);
    for (const n of counts) {
      expect(n).toBeGreaterThanOrEqual(MIN_RIVALS);
      expect(n).toBeLessThanOrEqual(MAX_RIVALS);
    }
  });

  it('varies the archetype mix, so a learned cast cannot be coasted on', () => {
    const mixes = [1, 2, 3, 4, 5, 6, 7, 8].map((s) =>
      plan(s).map((r) => r.archetypeId).sort().join(','),
    );
    expect(new Set(mixes).size).toBeGreaterThan(1);
  });

  it('deals distinct carriers with staggered entries', () => {
    for (const seed of [1, 5, 11]) {
      const cast = plan(seed);
      expect(new Set(cast.map((r) => r.id)).size).toBe(cast.length);
      const turns = cast.map((r) => r.entryTurn);
      expect([...turns].sort((a, b) => a - b)).toEqual(turns); // ascending
      expect(new Set(turns).size).toBe(turns.length); // never two at once
    }
  });

  it('gives every carrier a personality inside the designed band', () => {
    for (const r of plan(3)) {
      expect(r.aggression).toBeGreaterThan(0.5);
      expect(r.aggression).toBeLessThan(2);
      expect(r.thrift).toBeGreaterThan(0.5);
      expect(r.reach).toBeGreaterThan(0.5);
      expect(ARCHETYPES.some((a) => a.id === r.archetypeId)).toBe(true);
    }
  });

  it('does not disturb the RNG stream the quarters run on', () => {
    // The cast is drawn from a derived stream; two games with the same seed must
    // still settle identically whatever cast they were dealt.
    expect(newGame(9, 'LON').rngState).toBe(Rng.fromSeed(9).save());
  });
});

describe('personality bends the archetype', () => {
  const base = (id: string): PlannedRival => ({
    id: 'x', name: 'X', color: '#000', archetypeId: id,
    entryTurn: 1, attentionMillions: 1, aggression: 1, thrift: 1, reach: 1, gaugeBias: 1,
  });

  it('leaves a neutral personality alone', () => {
    const cfg = effectiveConfig(base('ulcc'));
    const raw = getArchetype('ulcc');
    /*
     * The commit bar is an absolute dollar figure and `effectiveConfig` scales it by
     * the difficulty's `yield` on purpose — a fixed bar in a thinner world makes
     * rivals passive in exactly the setting meant to make them fierce. So a neutral
     * PERSONALITY leaves it at the archetype's value times that, not at the value
     * itself.
     *
     * This asserted plain equality and passed only because medium's yield happened
     * to be exactly 1.0. It failed the moment medium was tuned, reporting 288000
     * against 300000 — which is 0.96, the new constant, not a bug. A test that means
     * "personality does nothing" must not also quietly assert "this difficulty is
     * identity on every axis".
     */
    const yieldMod = difficultyMods('medium').yield;
    expect(cfg.minProjectedNetPerQuarter).toBeCloseTo(raw.minProjectedNetPerQuarter * yieldMod, 6);
    // A dimension yield does not touch, so this one is a straight identity.
    expect(cfg.maxSectorKm).toBeCloseTo(raw.maxSectorKm, 6);
  });

  it('makes a bolder carrier commit on a thinner profit', () => {
    const timid = effectiveConfig({ ...base('ulcc'), aggression: 0.7 });
    const bold = effectiveConfig({ ...base('ulcc'), aggression: 1.5 });
    expect(bold.minProjectedNetPerQuarter).toBeLessThan(timid.minProjectedNetPerQuarter);
    expect(bold.incursionAppetite!).toBeGreaterThan(timid.incursionAppetite!);
  });

  it('makes a bolder loss-buyer stomach a DEEPER loss, not a shallower one', () => {
    // The flag carrier's threshold is negative: it buys share at a loss. Scaling
    // it the same way as a positive threshold would quietly make the most
    // aggressive flag carriers the most cautious.
    const raw = getArchetype('flag');
    expect(raw.minProjectedNetPerQuarter).toBeLessThan(0);
    const timid = effectiveConfig({ ...base('flag'), aggression: 0.7 });
    const bold = effectiveConfig({ ...base('flag'), aggression: 1.5 });
    expect(bold.minProjectedNetPerQuarter).toBeLessThan(timid.minProjectedNetPerQuarter);
  });

  it('scales cash discipline and reach', () => {
    const lean = effectiveConfig({ ...base('legacy'), thrift: 0.7, reach: 0.75 });
    const fat = effectiveConfig({ ...base('legacy'), thrift: 1.4, reach: 1.3 });
    expect(fat.reserveCash).toBeGreaterThan(lean.reserveCash);
    expect(fat.maxSectorKm).toBeGreaterThan(lean.maxSectorKm);
  });
});

describe('entry', () => {
  it('admits nobody before the first carrier is due', () => {
    const state = newGame(4, 'LON');
    const earliest = Math.min(...state.rivalPlan.map((r) => r.entryTurn));
    const before: GameState = { ...state, turn: earliest - 1 };
    expect(admitRival(before, Rng.fromSeed(1)).carriers).toHaveLength(1);
  });

  it('admits at most one carrier a quarter', () => {
    const state = newGame(4, 'LON');
    const late: GameState = { ...state, turn: 90 };
    expect(admitRival(late, Rng.fromSeed(1)).carriers).toHaveLength(2);
  });

  it('pulls a rival in early when the player is visibly making money', () => {
    // Pillar 4: success attracts sharks, with no difficulty slider.
    const state = newGame(4, 'LON');
    const due = state.rivalPlan[0]!;
    const rich: GameState = {
      ...state,
      turn: 1,
      history: Array.from({ length: CONSTANTS.game.quartersPerYear }, () => ({
        turn: 1, carrierId: 'player', revenue: 0, fuel: 0, crew: 0, maintenance: 0,
        handling: 0, lease: 0, standing: 0, fixed: 0, overhead: 0, interest: 0, tax: 0,
        netIncome: due.attentionMillions * 1e6, cashAfter: 0,
      })),
    };
    expect(playerAttention(rich)).toBeGreaterThanOrEqual(due.attentionMillions * 1e6);
    expect(admitRival(rich, Rng.fromSeed(1)).carriers).toHaveLength(2);
  });

  it('ignores losses when measuring attention', () => {
    const state = newGame(4, 'LON');
    const poor: GameState = {
      ...state,
      history: [{
        turn: 1, carrierId: 'player', revenue: 0, fuel: 0, crew: 0, maintenance: 0,
        handling: 0, lease: 0, standing: 0, fixed: 0, overhead: 0, interest: 0, tax: 0, netIncome: -5e8, cashAfter: 0,
      }],
    };
    expect(playerAttention(poor)).toBe(0);
  });

  it('gives an entrant a hub of its own and puts it on the map', () => {
    const state: GameState = { ...newGame(4, 'LON'), turn: 90 };
    const after = admitRival(state, Rng.fromSeed(1));
    const rival = after.carriers.find((c) => !c.isPlayer)!;
    expect(rival.homeCityId).not.toBe('LON');
    expect(rival.archetypeId).not.toBeNull();
    expect(after.routes.some((r) => r.carrierId === rival.id)).toBe(true);
  });

  it('spawns each carrier with its archetype\'s dividend policy', () => {
    const after = admitRival({ ...newGame(4, 'LON'), turn: 90 }, Rng.fromSeed(1));
    const rival = after.carriers.find((c) => !c.isPlayer)!;
    expect(rival.dividend).toBe(getArchetype(rival.archetypeId!).dividend);
  });
});

describe('a raided board fights back', () => {
  /** A world with a cash-rich target and a raider holding `stake` of it. */
  const raided = (stake: number): GameState => {
    const base = newGame(1, 'LON');
    const player = getCarrier(base, 'player');
    const target = { ...player, id: 't', name: 'Target', isPlayer: false, archetypeId: 'legacy', homeCityId: 'NYC', cash: 200_000_000 };
    const raider = { ...target, id: 'r', name: 'Raider', homeCityId: 'MEX', holdings: { t: target.shares * stake } };
    return { ...base, carriers: [player, target, raider] };
  };

  it('dilutes a raider that nears control by issuing equity', () => {
    const state = raided(0.45);
    const startShares = getCarrier(state, 't').shares;
    // The defence fires only some quarters (chance < 1), so try a few streams.
    let fired = false;
    for (let seed = 0; seed < 12 && !fired; seed++) {
      const after = maybeDefend(state, 't', Rng.fromSeed(seed));
      if (getCarrier(after, 't').shares > startShares) {
        fired = true;
        // Issuing shares dilutes the raider's fraction.
        const now = getCarrier(after, 't');
        expect((now.holdings['t'] ?? 0)).toBe(0); // target holds nothing of itself
        expect((getCarrier(after, 'r').holdings['t'] ?? 0) / now.shares).toBeLessThan(0.45);
      }
    }
    expect(fired).toBe(true);
  });

  it('leaves a carrier alone when no one is near control', () => {
    const state = raided(0.2); // below the defence threshold
    const startShares = getCarrier(state, 't').shares;
    for (let seed = 0; seed < 12; seed++) {
      expect(getCarrier(maybeDefend(state, 't', Rng.fromSeed(seed)), 't').shares).toBe(startShares);
    }
  });

  it('stops defending once the raider has taken control — no diluting your own controller', () => {
    const state = raided(0.6); // the raider already controls it
    const startShares = getCarrier(state, 't').shares;
    for (let seed = 0; seed < 12; seed++) {
      expect(getCarrier(maybeDefend(state, 't', Rng.fromSeed(seed)), 't').shares).toBe(startShares);
    }
  });
});

describe('archetypes have a dividend character', () => {
  it('has mature carriers return cash and growth carriers reinvest', () => {
    // A legacy hub pays out; a roll-up ploughs everything into debt and deals.
    expect(getArchetype('legacy').dividend).toBeGreaterThan(getArchetype('ulcc').dividend);
    expect(getArchetype('flag').dividend).toBeGreaterThan(0);
    expect(getArchetype('rollup').dividend).toBe(0);
    for (const a of ARCHETYPES) {
      expect(a.dividend).toBeGreaterThanOrEqual(0);
      expect(a.dividend).toBeLessThanOrEqual(CONSTANTS.finance.maxDividend);
    }
  });
});

describe('rivals apply real pressure', () => {
  /** Play a game where the player does nothing, so only rivals move. */
  function played(seed: number, turns: number): GameState {
    let state = newGame(seed, 'LON');
    for (let i = 0; i < turns; i++) state = endTurn(state);
    return state;
  }

  it('fills the world with carriers that fly things', () => {
    const state = played(11, 60);
    const rivals = state.carriers.filter((c) => !c.isPlayer);
    expect(rivals.length).toBeGreaterThan(2);
    expect(state.routes.length).toBeGreaterThan(rivals.length);
  });

  it('has carriers contest each other rather than each flying alone', () => {
    // Checked across seeds, over each game rather than at a frozen end-state: an
    // individual all-AI run can spread into non-overlapping markets, but the
    // competitive core is that carriers contest each other in the large. Most
    // games should see a market fought over at some point.
    let contestedGames = 0;
    for (const seed of [3, 7, 11, 17, 23]) {
      let state = newGame(seed, 'LON');
      let contested = false;
      for (let i = 0; i < 60 && !contested; i++) {
        state = endTurn(state);
        const index = buildMarketIndex(state);
        if (state.routes.some((r) => rivalsOf(index, r) > 0)) contested = true;
      }
      if (contested) contestedGames++;
    }
    expect(contestedGames, 'carriers never contested a market in most seeds').toBeGreaterThanOrEqual(3);
  });

  it('stays deterministic with rivals in play', () => {
    expect(JSON.stringify(played(21, 40))).toBe(JSON.stringify(played(21, 40)));
  });

  it('produces a different world for a different seed', () => {
    expect(JSON.stringify(played(21, 40))).not.toBe(JSON.stringify(played(22, 40)));
  });

  it('keeps a bankrupt rival off the map', () => {
    const state = played(11, 80);
    for (const carrier of state.carriers) {
      if (carrier.bankruptTurn === null) continue;
      expect(state.routes.some((r) => r.carrierId === carrier.id)).toBe(false);
      expect(carrier.fleet).toHaveLength(0);
    }
  // Budgets raised 2026-08-07: the funded growth allowance lets rivals deploy cash as
  // fast as they earn it, so a hundred-turn game now carries several times the routes
  // and fleet it used to. These fixtures are unchanged — the WORK per game grew.
  });

  it('never lets a rival act after the game has ended', () => {
    let state = newGame(11, 'LON');
    for (let i = 0; i < CONSTANTS.game.horizonTurns + 5; i++) state = endTurn(state);
    expect(state.turn).toBe(CONSTANTS.game.horizonTurns);
    expect(applyAction(state, { type: 'OPEN_ROUTE', carrierId: 'player', from: 'LON', to: 'NYC' }).ok)
      .toBe(false);
  });
});

describe('an airline buys the technology it is the sort of airline to buy', () => {
  /** Fund `n` programs for a carrier under one archetype's appetite. */
  const fund = (archetypeId: string, rounds: number): string[] => {
    let state = newGame(11, 'LON');
    const cfg = effectiveConfig({
      id: 'r', name: 'R', color: '#000', archetypeId,
      entryTurn: 0, attentionMillions: 0,
      aggression: 1, thrift: 1, reach: 1, gaugeBias: 1,
    });
    // Give the carrier more cash than the whole tree costs, so nothing it
    // declines was declined for want of money.
    state = {
      ...state,
      carriers: state.carriers.map((c) =>
        c.id === 'player' ? { ...c, cash: 5_000_000_000, archetypeId } : c,
      ),
    };
    for (let i = 0; i < rounds; i++) {
      state = maybeInvestInTech(state, 'player', cfg);
      // Land everything immediately so the next round sees it delivered.
      state = {
        ...state,
        carriers: state.carriers.map((c) =>
          c.id === 'player'
            ? { ...c, tech: [...c.tech, ...c.techInProgress.map((t) => t.nodeId)], techInProgress: [] }
            : c,
        ),
      };
    }
    return getCarrier(state, 'player').tech;
  };

  it('never funds what its archetype will not buy', () => {
    // A ULCC runs no alliance and no frequent-flyer program. Ryanair has
    // neither, and the whole point of the archetype is that it is legible.
    for (const id of ARCHETYPES.map((a) => a.id)) {
      const avoided = getArchetype(id).tech?.avoid ?? [];
      const bought = fund(id, 30);
      for (const node of avoided) {
        expect(bought, `${id} funded ${node}, which it should refuse`).not.toContain(node);
      }
    }
  });

  it('stops short of the whole tree, so funding one program forgoes another', () => {
    for (const id of ARCHETYPES.map((a) => a.id)) {
      const bought = fund(id, 40);
      expect(bought.length, `${id} bought the entire tree`).toBeLessThan(TECH_NODES.length);
      expect(bought.length, `${id} bought nothing at all`).toBeGreaterThan(0);
    }
  });

  it('funds what it prefers before what is merely cheap', () => {
    // The legacy hub's alliance and loyalty program are its crown jewels, and it
    // takes them ahead of cheaper programs it cares less about.
    const legacy = fund('legacy', 6);
    const cheapest = [...TECH_NODES].sort((a, b) => a.cost - b.cost)[0]!;
    expect(legacy).toContain('revenue-management');
    expect(legacy.indexOf('revenue-management')).toBeLessThan(
      legacy.includes(cheapest.id) ? legacy.indexOf(cheapest.id) + 1 : Infinity,
    );
  });

  it('gives two carriers of the same archetype different programs', () => {
    // Thrift varies by game, and a thriftier carrier runs a shorter program.
    const spendthrift = effectiveConfig({
      id: 'a', name: 'A', color: '#000', archetypeId: 'legacy',
      entryTurn: 0, attentionMillions: 0, aggression: 1, thrift: 0.7, reach: 1, gaugeBias: 1,
    });
    const tightfisted = effectiveConfig({
      id: 'b', name: 'B', color: '#000', archetypeId: 'legacy',
      entryTurn: 0, attentionMillions: 0, aggression: 1, thrift: 1.4, reach: 1, gaugeBias: 1,
    });
    expect(spendthrift.tech!.appetite).toBeGreaterThan(tightfisted.tech!.appetite);
  });
});

describe('carriers vary in how well they plan their fleet', () => {
  it('rolls a spread of gauge biases, not one value', () => {
    const biases = plan(7).map((r) => r.gaugeBias);
    expect(biases.length).toBeGreaterThan(2);
    const spread = Math.max(...biases) - Math.min(...biases);
    expect(spread).toBeGreaterThan(0.2); // some sharp, some sloppy
    // Centered on 1 (competence), within the configured band.
    for (const b of biases) {
      expect(b).toBeGreaterThan(1 - GAUGE_SPREAD - 1e-9);
      expect(b).toBeLessThan(1 + GAUGE_SPREAD + 1e-9);
    }
  });

  it('makes an over-gauging carrier aim at bigger aircraft than a sharp one', () => {
    // gaugeBias skews the capacity a carrier aims for. A poor planner
    // (bias > 1) shortlists larger metal for the same market; a sharp one
    // (bias 1) targets the right size. Test the mechanism it governs directly:
    // the shortlist, averaged over a range of markets, must skew larger.
    const state = newGame(11, 'LON');
    const avgSeats = (gaugeBias: number): number => {
      let total = 0;
      let count = 0;
      for (const market of [200, 500, 1000, 2000, 4000]) {
        for (const dist of [800, 2000, 6000]) {
          const types = candidateTypes(state, dist, market, 0, gaugeBias);
          for (const t of types) { total += t.seats; count++; }
        }
      }
      return count > 0 ? total / count : 0;
    };
    expect(avgSeats(1.6)).toBeGreaterThan(avgSeats(0.6));
  });
});

describe('the field regenerates — new airlines spin up', () => {
  const perYear = CONSTANTS.game.quartersPerYear;
  /** A history of profitable quarters for a carrier, long enough to read as such. */
  const profitable = (id: string, turn: number) =>
    Array.from({ length: perYear }, () => ({
      turn, carrierId: id, revenue: 0, fuel: 0, crew: 0, maintenance: 0, handling: 0,
      lease: 0, standing: 0, fixed: 0, overhead: 0, interest: 0, tax: 0,
      netIncome: 30_000_000, cashAfter: 0,
    }));

  /** A game where the whole scheduled cast has entered and one has failed. */
  const matureWithVacancy = (): GameState => {
    let state = newGame(4, 'LON');
    const cast = state.rivalPlan;
    const survivors = cast.slice(0, -1).map((r) => ({
      ...getCarrier(state, 'player'), id: r.id, name: r.name, isPlayer: false,
      color: r.color, archetypeId: r.archetypeId, homeCityId: 'NYC', cash: 200_000_000,
    }));
    const failed = cast.at(-1)!;
    const dead = {
      ...getCarrier(state, 'player'), id: failed.id, name: failed.name, isPlayer: false,
      color: failed.color, archetypeId: failed.archetypeId, homeCityId: 'PAR',
      bankruptTurn: 30, fleet: [], cash: -1,
    };
    return {
      ...state,
      turn: CONSTANTS.entrant.minTurn + 4,
      enteredRivals: cast.map((r) => r.id), // whole cast has arrived
      carriers: [getCarrier(state, 'player'), ...survivors, dead],
      history: survivors.flatMap((s) => profitable(s.id, state.turn)),
    };
  };

  it('spawns a new carrier into a thinned, profitable market', () => {
    const state = matureWithVacancy();
    const planBefore = state.rivalPlan.length;
    // Try a handful of seeds — entry is chance-gated, so at least one should fire.
    const anySpawned = [1, 2, 3, 4, 5, 6, 7, 8].some((seed) => {
      const after = maybeSpawnEntrant(state, Rng.fromSeed(seed));
      return after.rivalPlan.length > planBefore;
    });
    expect(anySpawned).toBe(true);
  });

  it('never spawns before the early game is over', () => {
    const state = { ...matureWithVacancy(), turn: CONSTANTS.entrant.minTurn - 1 };
    for (let seed = 0; seed < 10; seed++) {
      expect(maybeSpawnEntrant(state, Rng.fromSeed(seed)).rivalPlan.length).toBe(state.rivalPlan.length);
    }
  });

  it('does not spawn while the scheduled cast is still arriving', () => {
    const state = { ...matureWithVacancy(), enteredRivals: [] }; // nobody has entered
    for (let seed = 0; seed < 10; seed++) {
      expect(maybeSpawnEntrant(state, Rng.fromSeed(seed)).rivalPlan.length).toBe(state.rivalPlan.length);
    }
  });

  it('keeps the active field within the cap across a full game', () => {
    for (const seed of [1, 7, 13, 21]) {
      let state = newGame(seed, 'LON');
      let peak = 0;
      for (let i = 0; i < CONSTANTS.game.horizonTurns; i++) {
        state = endTurn(state);
        peak = Math.max(peak, state.carriers.filter((c) => !c.isPlayer && c.bankruptTurn === null).length);
      }
      expect(peak, `seed ${seed}`).toBeLessThanOrEqual(MAX_RIVALS);
    }
    // Four full present games with a now-active M&A market (stakes and buy-outs each
    // clone the state) run past the 5s default — and past 15s once medium's field
    // got a second growth move a quarter, which is more work every turn rather than
    // anything slower per unit of work.
  });

  it('lets more than the roll-up buy companies out — but not the ULCC', () => {
    const acquisitive = ARCHETYPES.filter((a) => a.acquisitive).map((a) => a.id);
    expect(acquisitive).toContain('rollup'); // the serial acquirer
    expect(acquisitive).toContain('legacy'); // and the deep-pocketed majors
    expect(acquisitive).toContain('flag');
    expect(acquisitive).not.toContain('ulcc'); // a ULCC grows organically, not by M&A
    // The roll-up stays the keenest: it opens campaigns at the base rate, the
    // others only occasionally.
    expect(getArchetype('rollup').acquisitionAppetite ?? 1).toBeGreaterThan(
      getArchetype('legacy').acquisitionAppetite ?? 1,
    );
  });
});

describe('merger review stops the field consolidating to one', () => {
  /*
   * Two different questions used to be one assertion, and they need separating.
   *
   * §9 says nobody runs away with the world. The old test read that as "more than one
   * carrier survives AND the biggest holds under 90% of rival routes", on two seeds,
   * both required to pass. But a field that dies of BANKRUPTCY hands its last survivor
   * 100% of the routes by arithmetic, with no merger involved — so a bankruptcy cascade
   * failed an antitrust test. Measured on ten seeds, there are no mergers at all in
   * these games: `minCarriersAfterMerger` already blocks them, and every loss is a
   * failure.
   *
   * So they are now measured apart:
   *
   *   CONSOLIDATION is the doctrine, and it is strict. Wherever a field survived at
   *   all, no carrier may hold 90% of rival routes. This is a real invariant and it
   *   holds with room to spare — the worst observed across ten seeds, on either side
   *   of the book-value fix, was 50%.
   *
   *   COLLAPSE is a rate, and gets a tolerance. Roughly one field in ten dies over a
   *   full history game, on the shipped code as much as on any branch: `main`
   *   today ends seed 200 with ZERO surviving rivals. Demanding that every seed keep a
   *   live field asserts something false about the game.
   */
  it('does not let a surviving field consolidate past the antitrust floor', () => {
    const floor = CONSTANTS.finance.minCarriersAfterMerger;
    expect(floor).toBeGreaterThan(1);
    const seeds = [100, 101, 102, 103, 104, 105, 200, 201];
    const MIN_LIVE_FIELDS = 6;
    let liveFields = 0;
    const collapsed: number[] = [];
    for (const seed of seeds) {
      /*
       * A neutral observer, for the same reason the history suite needs one: this
       * judges the RIVAL field, and history now deals the player an airline. A
       * player who never acts but owns aircraft fails in the crisis window, which
       * ends the game and leaves the field judged at turn 39 — where one carrier
       * holding every rival route is arithmetic on a tiny number, not consolidation.
       */
      let state = newGame(seed, 'LON', undefined, { scenario: 'history', startingOperation: false });
      while (state.turn < state.horizonTurns && !state.gameOver) state = endTurn(state);
      const live = state.carriers.filter((c) => c.bankruptTurn === null && !c.isPlayer).length;
      const rivalRoutes = state.routes.filter((r) => r.carrierId !== state.playerCarrierId).length;
      const biggest = Math.max(
        0,
        ...state.carriers
          .filter((c) => !c.isPlayer && c.bankruptTurn === null)
          .map((c) => state.routes.filter((r) => r.carrierId === c.id).length),
      );
      if (live < 2) { collapsed.push(seed); continue; }
      liveFields += 1;
      // The doctrine, on every field that survived to be judged.
      if (rivalRoutes > 0) {
        expect(biggest / rivalRoutes, `seed ${seed} consolidated`).toBeLessThan(0.9);
      }
    }
    // And the field must usually survive at all — a rate, with the tolerance the
    // measured collapse rate demands.
    expect(liveFields, `fields collapsed on seeds ${collapsed.join(', ')}`)
      .toBeGreaterThanOrEqual(MIN_LIVE_FIELDS);
  }, 400_000);
});

describe('a rival commits to the sector it opened', () => {
  /** A widebody on a thin short market — a certain loser, so pruneLosers wants it gone. */
  function losing(openedTurn: number, turn: number, difficulty: 'medium' | 'hard', cash = 500_000_000): GameState {
    const base = newGame(1, 'LON', undefined, { difficulty });
    const rival = {
      ...base.carriers[0]!, id: 'r1', name: 'Test Air', isPlayer: false, archetypeId: 'legacy', cash,
      fleet: [{
        id: 'T1', typeId: 'AROSW6', ownership: 'leased' as const,
        acquiredTurn: 0, deliversTurn: 0, bookValue: 0, routeId: 'rt',
      }],
    };
    return {
      ...base, turn,
      carriers: [base.carriers[0]!, rival],
      routes: [{ id: 'rt', carrierId: 'r1', from: 'LAS', to: 'SLC', posture: 'match' as const, openedTurn }],
    };
  }
  const RESERVE = { reserveCash: 30_000_000 };

  it('holds a freshly opened loser through its ramp-up instead of bailing at once', () => {
    // The point of the commitment window: an entrant into the player's market has
    // to be squeezed out over years, not in a single quarter. Without this the
    // player wins every war of attrition by default and never feels competition.
    for (const d of ['medium', 'hard'] as const) {
      const young = losing(10, 11, d);
      expect(pruneLosers(young, marketIndex(young), 'r1', RESERVE).routes, d).toHaveLength(1);
    }
  });

  it('still closes a long-standing loser', () => {
    const old = losing(0, 40, 'hard');
    expect(pruneLosers(old, marketIndex(old), 'r1', RESERVE).routes).toHaveLength(0);
  });

  it('is not a suicide pact — a carrier below its reserve cuts anyway', () => {
    const broke = losing(10, 11, 'hard', 1_000_000);
    expect(pruneLosers(broke, marketIndex(broke), 'r1', RESERVE).routes).toHaveLength(0);
  });

  it('digs in for far longer on hard than on medium', () => {
    const q = (d: 'easy' | 'medium' | 'hard'): number =>
      Math.round(CONSTANTS.routes.commitmentQuarters * CONSTANTS.difficulty[d].contestPressure);
    expect(q('hard')).toBeGreaterThan(q('medium'));
    expect(q('medium')).toBeGreaterThanOrEqual(q('easy'));
  });
});

describe('archetypes fly different fleets', () => {
  // A low-cost carrier flying widebodies is not a balance nuance, it is the
  // archetype failing to read as itself. Two things caused it and both are pinned
  // here: the shortlist never OFFERED a narrowbody on a decent market, and once it
  // did, every carrier appraised it with the same cost base and picked the same
  // aircraft.

  it('offers every class the sector can take, not just the biggest', () => {
    // `candidateTypes` ranks by |capacity - target|, but target is what the whole
    // ROUTE might win while capacity is what ONE aircraft carries. Above about
    // 20,000 a week the target exceeds every aircraft in the game, so the ranking
    // collapsed to "biggest first" and came back all widebody — measured, five
    // widebodies and nothing else. The shortlist is a budget on how many types get
    // priced; it must not be the thing that picks the winner.
    const game = newGame(5, 'LON');
    for (const market of [5_000, 20_000, 50_000, 100_000]) {
      const klasses = new Set(candidateTypes(game, 1000, market, 0, 1).map((t) => t.klass));
      expect(klasses.size, `market ${market}/wk offered only ${[...klasses].join(', ')}`)
        .toBeGreaterThan(1);
    }
    // On a thick market specifically, a narrowbody has to be on the list at all.
    const thick = candidateTypes(game, 1000, 100_000, 0, 1);
    expect(thick.some((t) => t.klass === 'Narrowbody')).toBe(true);
  });

  it('gives a low-cost carrier a cost reason to stay narrowbody', () => {
    // The advantage IS the single dense narrowbody fleet, so it must not travel to
    // a widebody. Set equal, every archetype converges on the same aircraft.
    const narrow = archetypeCostAdvantage('ulcc', new Set(['Narrowbody']));
    const wide = archetypeCostAdvantage('ulcc', new Set(['Widebody']));
    expect(narrow).toBeLessThan(1);
    // Strictly worse than an ordinary carrier, not merely less advantaged — at a
    // gentler penalty the ULCC still flew 65% widebodies.
    expect(wide).toBeGreaterThan(1);
  });

  it('points the prestige archetypes the other way', () => {
    for (const id of ['flag', 'legacy']) {
      const wide = archetypeCostAdvantage(id, new Set(['Widebody']));
      const narrow = archetypeCostAdvantage(id, new Set(['Narrowbody']));
      expect(wide, `${id} should favour widebodies`).toBeLessThan(narrow);
    }
    // And the two families must actually disagree, or there is no variation.
    expect(archetypeCostAdvantage('ulcc', new Set(['Widebody'])))
      .toBeGreaterThan(archetypeCostAdvantage('flag', new Set(['Widebody'])));
  });

  it('leaves the player alone', () => {
    // The player has no archetype and must not inherit a fleet preference.
    expect(archetypeCostAdvantage(null, new Set(['Widebody']))).toBe(1);
    expect(archetypeCostAdvantage(null, new Set(['Narrowbody']))).toBe(1);
  });
});

/**
 * The holding-company powers are the AI's too.
 *
 * A power only the player can use is not a strategy, it is a cheat code with extra
 * steps: the player could command a treasury at a fraction of the exposure and keep
 * buying with money that was not theirs, and no rival could answer — `maybeDefend`
 * only dilutes, and gives up entirely once a raider is past the control threshold.
 *
 * This pins the capability rather than a rate, because the rate is a balance figure
 * and will move. Two earlier placements were correct code that could never run —
 * `maybeTakeStake` returns immediately for acquisitive carriers and caps everyone
 * else below the control line, and `maybeAcquire` returns early exactly when the
 * antitrust floor makes subsidiaries persist. Both measured zero. A test that only
 * asserted "nothing broke" would have passed for both.
 */
describe('a rival spends the treasuries it commands', () => {
  it('directs a subsidiary to buy shares its parent is accumulating', () => {
    let fired = 0;
    let subsidiaryQuarters = 0;

    for (const seed of [19000, 19001, 19002, 19003, 19004, 19005]) {
      let state = newGame(seed, 'LON', undefined, { difficulty: 'medium', scenario: 'present' });
      const previous = new Map<string, number>();

      for (let turn = 0; turn < 100 && !state.gameOver; turn++) {
        state = endTurn(state);
        for (const carrier of state.carriers) {
          if (carrier.isPlayer || carrier.bankruptTurn !== null) continue;
          const subs = controlledBy(state, carrier).filter((c) => !c.isPlayer);
          if (subs.length === 0) continue;
          subsidiaryQuarters += 1;
          for (const sub of subs) {
            const now = Object.values(sub.holdings ?? {}).reduce((a, b) => a + b, 0);
            if (now > (previous.get(sub.id) ?? 0) + 1e-6) fired += 1;
            previous.set(sub.id, now);
          }
        }
      }
    }

    /*
     * Subsidiaries have to exist at all, or the rest proves nothing. The figure is
     * soft on purpose and spread over six seeds: it is a check that the fixture is
     * alive, not a balance assertion, and a tighter one calibrated to one cast broke
     * the moment an archetype was added to the roster — which is a change to the
     * game, not to this capability.
     */
    expect(subsidiaryQuarters, 'no rival ever held a subsidiary — the fixture is inert').toBeGreaterThan(20);
    // ...and their treasuries have to actually get spent.
    expect(fired, 'rivals hold subsidiaries but never direct them').toBeGreaterThan(0);
  });

  it('counts effective control in merger review, not the company register', () => {
    // A pyramid never merges anything, so a floor counting solvent carriers would
    // never trip on one. Nobody exploits this today — rivals merge the moment they
    // can — which is exactly why it is worth pinning before that changes.
    const state = newGame(19000, 'LON', undefined, { difficulty: 'medium', scenario: 'present' });
    const rivals = state.carriers.filter((c) => !c.isPlayer);
    if (rivals.length < 2) return;
    const [a, b] = rivals as [typeof rivals[0], typeof rivals[0]];

    const pyramided: GameState = {
      ...state,
      carriers: state.carriers.map((c) =>
        c.id === a.id ? { ...c, holdings: { ...c.holdings, [b.id]: b.shares * 0.6 } } : c,
      ),
    };
    // The register still reads the same number of carriers...
    expect(pyramided.carriers.filter((c) => c.bankruptTurn === null).length)
      .toBe(state.carriers.filter((c) => c.bankruptTurn === null).length);
    // ...but one of them is no longer independent.
    expect(controlledBy(pyramided, getCarrier(pyramided, a.id)).map((c) => c.id)).toContain(b.id);
  });
});

/**
 * The Territorial wants a city, not a market.
 *
 * The roster had four shapes and the player's report was that rivals were
 * predictable — not that their numbers were too similar (aggression already varies
 * 0.9-1.7 per carrier, and gauge by +/-0.5) but that they were all trying to do the
 * same KIND of thing. This one collects a hub the way the board game collects a
 * colour group: takes sectors out of its own city at margins the others walk away
 * from, contests anyone who lands there, and once it holds the place, charges for it.
 *
 * Pinned as a SHAPE rather than as figures. The exact percentages are balance and
 * will move; what must not quietly stop being true is that it ends up holding more
 * of its hub than the legacy carrier does and pricing dearer there.
 */
describe('the Territorial archetype plays differently', () => {
  it('holds more of its own hub, and charges for it', () => {
    const dom = new Map<string, number[]>();
    const premium = new Map<string, { dear: number; all: number }>();

    /*
     * Twenty-four seeds, not twelve, and compared on the MEAN of pooled carriers
     * rather than the median.
     *
     * At twelve this test was measuring its own sampling noise. Only about one
     * Territorial and half a legacy carrier survive per seed, so the median was taken
     * over a dozen observations drawn from distributions that overlap almost
     * completely (Territorial 7-100%, legacy 13-75%). Adding four seeds moved the
     * legacy median from 34% to 62% and flipped the assertion — the balance had not
     * changed at all. A shape assertion resting on a coin flip is worse than no
     * assertion, because it gets "fixed" by tuning the game to fit the noise.
     */
    for (let seed = 21000; seed < 21024; seed++) {
      let state = newGame(seed, 'LON', undefined, { difficulty: 'medium', scenario: 'present' });
      for (let turn = 0; turn < 100 && !state.gameOver; turn++) state = endTurn(state);

      for (const carrier of state.carriers) {
        if (carrier.isPlayer || carrier.bankruptTurn !== null || !carrier.archetypeId) continue;
        const kind = plannedRival(state, carrier.id).archetypeId;
        const mine = state.routes.filter((r) => r.carrierId === carrier.id);
        if (mine.length === 0) continue;

        const home = mine.filter((r) => r.from === carrier.homeCityId || r.to === carrier.homeCityId);
        (dom.get(kind) ?? dom.set(kind, []).get(kind)!)
          .push(hubDominance(state, carrier.id, carrier.homeCityId));
        const p = premium.get(kind) ?? { dear: 0, all: 0 };
        p.dear += home.filter((r) => r.posture === 'premium').length;
        p.all += home.length;
        premium.set(kind, p);
      }
    }

    const mean = (xs: number[]): number => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
    const territorial = dom.get('monopolist') ?? [];
    const legacy = dom.get('legacy') ?? [];
    // The fixture has to contain both, or this compares nothing. Raised with the seed
    // count: these are the sample sizes the comparison below actually needs.
    expect(territorial.length, 'too few Territorials survived to compare').toBeGreaterThan(12);
    expect(legacy.length, 'too few legacy carriers survived to compare').toBeGreaterThan(8);

    expect(mean(territorial), 'a Territorial should end up holding more of its hub than a legacy carrier')
      .toBeGreaterThan(mean(legacy));

    const dearShare = (k: string): number => {
      const p = premium.get(k);
      return p && p.all > 0 ? p.dear / p.all : 0;
    };
    expect(dearShare('monopolist'), 'a Territorial should price its own hub dearer than a legacy carrier')
      .toBeGreaterThan(dearShare('legacy'));
  }, 700_000);
});
