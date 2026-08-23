/**
 * History mode: the optional 2000-start run with real events anchored to their
 * dates, period aircraft that give way to modern ones, and the COVID/bailout
 * mechanic. The acceptance test for the mode is that it models the real shocks
 * without leaving a dead world behind — a crisis guts the field but the market
 * recovers rather than flatlining.
 */
import { describe, expect, it } from 'vitest';
import { applyAction, endTurn, getCarrier, newGame } from '../src/sim/engine.ts';
import { Rng } from '../src/sim/rng.ts';
import { CONSTANTS } from '../src/sim/world.ts';
import { HISTORICAL, isCrisisActive, scheduledEvent } from '../src/sim/events.ts';
import { aircraftAvailable, canReach, getAircraftType } from '../src/sim/fleet.ts';
import { decide, setup } from '../src/sim/ai/heuristic.ts';
import { CITIES, cityDistanceKm } from '../src/sim/world.ts';
import {
  assignedTo, buildMarketIndex, computeRouteEconomics, feedFactor, rivalCapacityOf, rivalsOf,
  stationOverheadFor,
} from '../src/sim/economics.ts';
import { conditionsFor, klassesOf } from '../src/sim/conditions.ts';
import type { GameState } from '../src/sim/types.ts';

const qpy = CONSTANTS.game.quartersPerYear;
/** The turn a given calendar quarter falls on in a 2000-start history game. */
/*
 * Derived from the scenario, never from a year typed in here. When the start moved
 * 2000 -> 1995 this helper was the only reason three unrelated assertions failed:
 * they were pinning the arithmetic of the old start rather than the real dates the
 * timeline is supposed to hit.
 */
const turnOf = (year: number, quarter = 1): number =>
  (year - CONSTANTS.scenarios.history.startYear) * qpy + (quarter - 1);

describe('the scenario chooser sets the clock', () => {
  it('starts a history game at the configured year with the longer horizon', () => {
    const state = newGame(1, 'LON', undefined, { scenario: 'history' });
    expect(state.scenario).toBe('history');
    expect(state.startYear).toBe(CONSTANTS.scenarios.history.startYear);
    expect(state.horizonTurns).toBe(CONSTANTS.scenarios.history.horizonTurns);
  });

  /*
   * The head start is the point of the start year, so pin the head start.
   *
   * At a 2000 start the recession landed on turn 4 and September 11 on turn 6, and
   * every measured game ended in bankruptcy with death-turn quartiles of 14/14/16 —
   * an airline barely a year old meeting the worst three years in the industry's
   * history. Whatever the start year says, the player needs room to build first.
   */
  it('leaves years of quiet trading before the first scripted crisis', () => {
    const first = Math.min(...HISTORICAL.map((h) => turnOf(h.year, h.quarter)));
    expect(first).toBeGreaterThanOrEqual(5 * qpy);
  });

  it('leaves the present-day game in 2026 by default', () => {
    const state = newGame(1, 'LON');
    expect(state.scenario).toBe('present');
    expect(state.startYear).toBe(2026);
  });
});

describe('scripted history fires on its real dates', () => {
  it('drops September 11 in the third quarter of 2001, and only in history', () => {
    const history: GameState = { ...newGame(4, 'LON', undefined, { scenario: 'history' }), turn: turnOf(2001, 3) };
    const scripted = scheduledEvent(history);
    expect(scripted?.source).toBe('sept11');

    // The same turn in a present-day game is just a quarter in 2032 — no script.
    const present: GameState = { ...newGame(4, 'LON'), turn: turnOf(2001, 3) };
    expect(scheduledEvent(present)).toBeNull();
  });

  it('never fires two quarters early or late', () => {
    const before: GameState = { ...newGame(4, 'LON', undefined, { scenario: 'history' }), turn: turnOf(2001, 2) };
    const after: GameState = { ...newGame(4, 'LON', undefined, { scenario: 'history' }), turn: turnOf(2001, 4) };
    expect(scheduledEvent(before)?.source).not.toBe('sept11');
    expect(scheduledEvent(after)?.source).not.toBe('sept11');
  });

  it('reaches COVID in the first quarter of 2020', () => {
    const state: GameState = { ...newGame(4, 'LON', undefined, { scenario: 'history' }), turn: turnOf(2020, 1) };
    expect(scheduledEvent(state)?.source).toBe('covid');
  });
});

describe('a crisis brings a government bailout', () => {
  /** A broke carrier one quarter into a running crisis. */
  const brokeInCrisis = (bailouts: number): GameState => {
    const base = newGame(4, 'LON', undefined, { scenario: 'history' });
    const covid = { source: 'covid', kind: 'event' as const, until: base.turn + 4, effects: { demand: 0.4 } };
    return {
      ...base,
      events: [covid],
      carriers: base.carriers.map((c) =>
        c.isPlayer ? { ...c, cash: -20_000_000, fleet: [], bailouts } : c,
      ),
    };
  };

  it('is only on offer while a crisis runs', () => {
    expect(isCrisisActive(brokeInCrisis(0))).toBe(true);
    const calm = newGame(4, 'LON', undefined, { scenario: 'history' });
    expect(isCrisisActive(calm)).toBe(false);
  });

  it('rescues a carrier that would otherwise fail, and books it as debt', () => {
    const after = endTurn(brokeInCrisis(0));
    const me = getCarrier(after, 'player');
    expect(me.bankruptTurn).toBeNull(); // survived
    expect(me.cash).toBeGreaterThanOrEqual(0); // lifted above zero
    expect(me.cash).toBeCloseTo(CONSTANTS.finance.bailoutCushion, -3); // just a cushion
    expect(me.debt).toBeGreaterThan(0); // the loan is on the books
    expect(me.bailouts).toBe(1);
  });

  it('is not infinite — a carrier out of bailouts finally fails', () => {
    const after = endTurn(brokeInCrisis(CONSTANTS.finance.maxBailouts));
    expect(getCarrier(after, 'player').bankruptTurn).not.toBeNull();
  });

  it('does not rescue a broke carrier when no crisis is running', () => {
    const base = newGame(4, 'LON', undefined, { scenario: 'history' });
    const broke: GameState = {
      ...base,
      carriers: base.carriers.map((c) => (c.isPlayer ? { ...c, cash: -20_000_000, fleet: [] } : c)),
    };
    expect(getCarrier(endTurn(broke), 'player').bankruptTurn).not.toBeNull();
  });
});

describe('the fleet is anchored to its real launch dates', () => {
  it('offers period aircraft at a 2000 start and withholds the modern ones', () => {
    const state = newGame(7, 'LON', undefined, { scenario: 'history' });
    // A 1980s narrowbody is in service; a 2030s next-gen jet is decades away.
    const eighties = Object.entries(state.aircraftIntro).filter(([, t]) => t === 0);
    expect(eighties.length).toBeGreaterThan(0);
    const future = Object.entries(state.aircraftIntro).filter(([, t]) => t >= state.horizonTurns);
    // Nothing that only launches beyond the horizon can be flown at the start.
    for (const [id] of future) expect(aircraftAvailable(state, id)).toBe(false);
  });

  it('lets more aircraft enter service as the decades turn', () => {
    const state = newGame(7, 'LON', undefined, { scenario: 'history' });
    const availableAt = (turn: number) =>
      Object.keys(state.aircraftIntro).filter((id) => aircraftAvailable({ ...state, turn }, id)).length;
    expect(availableAt(turnOf(2030))).toBeGreaterThan(availableAt(turnOf(2000)));
  });

  it('refuses an order for a jet that has not launched yet', () => {
    const state = newGame(7, 'LON', undefined, { scenario: 'history' });
    const gated = Object.entries(state.aircraftIntro).find(([, t]) => t > 0)?.[0];
    expect(gated).toBeDefined();
    const early = applyAction(state, { type: 'ACQUIRE_AIRCRAFT', carrierId: 'player', typeId: gated!, ownership: 'leased' });
    expect(early.ok).toBe(false);
  });
});

describe('history deals an airline instead of a startup', () => {
  const deal = (seed: number) => {
    const s = newGame(seed, 'LON', undefined, { scenario: 'history' });
    return { state: s, player: getCarrier(s, s.playerCarrierId) };
  };

  it('opens with sectors already flying, and present-day does not', () => {
    const { state, player } = deal(1);
    expect(state.routes.length).toBeGreaterThan(0);
    expect(player.fleet.length).toBe(state.routes.length);

    const present = newGame(1, 'LON');
    expect(present.routes).toHaveLength(0);
    expect(getCarrier(present, present.playerCarrierId).fleet).toHaveLength(0);
  });

  it('deals a different airline to every seed, and the same one twice to one seed', () => {
    const shape = (seed: number) => {
      const { state, player } = deal(seed);
      return state.routes.map((r) => `${r.to}:${player.fleet.find((a) => a.routeId === r.id)!.typeId}`).join(',');
    };
    expect(shape(7)).toBe(shape(7));
    const shapes = new Set([1, 2, 3, 4, 5, 6, 7, 8].map(shape));
    // Eight seeds must not collapse onto one or two openings.
    expect(shapes.size).toBeGreaterThanOrEqual(6);
  });

  it('never deals metal that cannot fly the sector or has not been built yet', () => {
    for (let seed = 1; seed <= 40; seed += 1) {
      const { state, player } = deal(seed);
      for (const route of state.routes) {
        const tail = player.fleet.find((a) => a.routeId === route.id);
        expect(tail, `route ${route.id} has no aircraft`).toBeDefined();
        const type = getAircraftType(tail!.typeId);
        expect(canReach(type, cityDistanceKm(route.from, route.to)),
          `${type.name} cannot reach ${route.to} on seed ${seed}`).toBe(true);
        expect(aircraftAvailable(state, type.id), `${type.name} not yet built on seed ${seed}`).toBe(true);
        // Already in service: an opening airline is trading, not awaiting delivery.
        expect(tail!.deliversTurn).toBeLessThanOrEqual(0);
      }
    }
  });

  it('deals a going concern, not a burden', () => {
    // The grant has to be an airline worth inheriting: it carries a station charge
    // every quarter whether or not the sectors pay, so a random draw of dead city
    // pairs would be worse than no grant at all.
    let profitable = 0;
    let total = 0;
    for (let seed = 1; seed <= 30; seed += 1) {
      const { state, player } = deal(seed);
      const index = buildMarketIndex(state);
      for (const route of state.routes) {
        const tails = assignedTo(player, route.id);
        const econ = computeRouteEconomics(
          route, tails, 0, conditionsFor(state, player, route, klassesOf(tails)),
          rivalsOf(index, route), rivalCapacityOf(index, route),
          feedFactor(state.routes, player.id, route.from, route.to, route.id),
          stationOverheadFor(state.routes, player.id, route.from, route.to, true),
        );
        total += 1;
        if (econ.netCash > 0) profitable += 1;
      }
    }
    expect(profitable / total).toBeGreaterThan(0.7);
  });
});

describe('the world survives its own history', () => {
  // The point of the mode: a scripted 9/11 and COVID gut the field, but the
  // market must recover rather than flatline into a dead world. Run several
  // full games and assert the field is alive at the finish.
  const runHistory = (seed: number): GameState => {
    const aiRng = Rng.fromSeed(seed ^ 0x5f3759df);
    const home = aiRng.pick(CITIES).id;
    let s = newGame(seed, home, 'Stub', { scenario: 'history' });
    s = setup(s, s.playerCarrierId, aiRng);
    while (s.turn < s.horizonTurns && !s.gameOver) {
      s = decide(s, s.playerCarrierId, aiRng);
      s = endTurn(s);
    }
    return s;
  };

  /*
   * Recovery is a RATE, not a certainty — so this measures the rate.
   *
   * It used to run six seeds and demand that all six recover. That assertion was
   * false about the shipped game and green only because of which seeds it picked:
   * measured on twelve seeds the test does not use, `main` leaves TWO worlds dead
   * (201 and 203). With a per-world death rate around 10%, six-of-six perfection
   * fails roughly two draws in five, so the old test reported which seeds were lucky
   * rather than whether the world recovers.
   *
   * It cost an evening to learn that: a correctness fix elsewhere shifted every
   * trajectory slightly, one world flipped from two surviving carriers to one, and
   * the red tick was read as the fix destabilising the economy. A matched control on
   * unused seeds showed the failure rate was identical — 10/12 before, 11/12 after.
   *
   * Twelve seeds and a floor of nine. Observed 10-11 of 12 on both sides of that fix,
   * so nine leaves about one standard deviation of headroom. Be honest about what
   * this can and cannot see: it catches a change that kills a QUARTER of all worlds,
   * and it deliberately cannot see one extra dead world, because at twelve seeds that
   * is indistinguishable from chance. Widening the seed set is the only way to see
   * smaller effects, and it costs about 21 seconds a seed.
   */
  it('leaves most markets alive once the crises have passed', () => {
    const seeds = [100, 101, 102, 103, 104, 105, 200, 201, 202, 203, 204, 205];
    const MIN_RECOVERED = 9;
    const dead: number[] = [];
    let alive = 0;
    for (const seed of seeds) {
      const home = Rng.fromSeed(seed ^ 0x5f3759df).pick(CITIES).id;
      /*
       * The observer must be able to hold still. History deals the player an opening
       * airline, and a player who never acts but owns aircraft goes bankrupt in the
       * crisis window — which ends the game and stops this measurement around turn
       * 31 with the rival field still growing. That read as four dead worlds when
       * every one of them had three to seven healthy rivals still flying.
       */
      let s = newGame(seed, home, 'Idle', { scenario: 'history', startingOperation: false });
      let peakRoutes = 0;
      while (s.turn < s.horizonTurns && !s.gameOver) {
        s = endTurn(s); // rivals act inside endTurn; the player just sits
        peakRoutes = Math.max(peakRoutes, s.routes.filter((r) => r.carrierId !== s.playerCarrierId).length);
      }
      const liveRivals = s.carriers.filter((c) => !c.isPlayer && c.bankruptTurn === null).length;
      // A recovered market: rivals rebuilt a real field, not a graveyard of shells.
      if (peakRoutes > 40 && liveRivals >= 2) alive += 1;
      else dead.push(seed);
    }
    expect(alive, `dead worlds on seeds ${dead.join(', ')}`).toBeGreaterThanOrEqual(MIN_RECOVERED);
  }, 600_000);

  it('runs a full history game without a NaN or a negative-seat state', () => {
    const end = runHistory(103);
    for (const record of end.history) {
      expect(Number.isFinite(record.netIncome)).toBe(true);
      expect(Number.isFinite(record.revenue)).toBe(true);
    }
    for (const carrier of end.carriers) {
      expect(Number.isFinite(carrier.cash)).toBe(true);
      expect(carrier.bailouts).toBeGreaterThanOrEqual(0);
    }
    // Budgeted like its sibling above. It used to fit inside the 5s default only
    // because the fixture went bankrupt early and the run stopped; carriers now
    // survive far more often, so this plays the scenario's full horizon on a crowded
    // world (120 turns since the run was cut to 1995-2024).
  });
});
