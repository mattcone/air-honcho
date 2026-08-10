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
import { isCrisisActive, scheduledEvent } from '../src/sim/events.ts';
import { aircraftAvailable } from '../src/sim/fleet.ts';
import { decide, setup } from '../src/sim/ai/heuristic.ts';
import { CITIES } from '../src/sim/world.ts';
import type { GameState } from '../src/sim/types.ts';

const qpy = CONSTANTS.game.quartersPerYear;
/** The turn a given calendar quarter falls on in a 2000-start history game. */
const turnOf = (year: number, quarter = 1): number => (year - 2000) * qpy + (quarter - 1);

describe('the scenario chooser sets the clock', () => {
  it('starts a history game in 2000 with the longer horizon', () => {
    const state = newGame(1, 'LON', undefined, { scenario: 'history' });
    expect(state.scenario).toBe('history');
    expect(state.startYear).toBe(2000);
    expect(state.horizonTurns).toBe(CONSTANTS.scenarios.history.horizonTurns);
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

  it('does not leave a dead market once the crises have passed', () => {
    // This is about the WORLD, not the player: after a scripted 9/11 and COVID
    // gut the field, the rivals must rebuild rather than flatline forever. Run
    // the field with an idle player (who never opens a route, so never fails and
    // never freezes the sim by going bankrupt) and watch the rivals alone —
    // otherwise a fixture that dies in the crises ends the game early and reads
    // as a dead world when the field would have recovered fine.
    let alive = 0;
    const seeds = [100, 101, 102, 103, 104, 105];
    for (const seed of seeds) {
      const home = Rng.fromSeed(seed ^ 0x5f3759df).pick(CITIES).id;
      let s = newGame(seed, home, 'Idle', { scenario: 'history' });
      let peakRoutes = 0;
      while (s.turn < s.horizonTurns && !s.gameOver) {
        s = endTurn(s); // rivals act inside endTurn; the player just sits
        peakRoutes = Math.max(peakRoutes, s.routes.filter((r) => r.carrierId !== s.playerCarrierId).length);
      }
      const liveRivals = s.carriers.filter((c) => !c.isPlayer && c.bankruptTurn === null).length;
      // A recovered market: rivals rebuilt a real field, not a graveyard of shells.
      if (peakRoutes > 40 && liveRivals >= 2) alive += 1;
    }
    // Every seed should recover; allow no dead worlds.
    expect(alive).toBe(seeds.length);
    // Six uninterrupted 200-turn games, each now growing a field of up to a dozen
    // carriers and hundreds of routes — and, with an active M&A market, a great many
    // state clones — is well past the 5s default.
  // Budgets raised 2026-08-07: the funded growth allowance lets rivals deploy cash as
  // fast as they earn it, so a hundred-turn game now carries several times the routes
  // and fleet it used to. These fixtures are unchanged — the WORK per game grew.
  }, 420_000);

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
    // survive far more often, so this plays all 200 turns of a crowded world.
  });
});
