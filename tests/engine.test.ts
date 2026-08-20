import { describe, expect, it } from 'vitest';
import { applyAction, endTurn, findTail, getCarrier, newGame, turnLabel } from '../src/sim/engine.ts';
import { CONSTANTS } from '../src/sim/world.ts';
import type { GameState } from '../src/sim/types.ts';

const open = (state: GameState, from: string, to: string) =>
  applyAction(state, { type: 'OPEN_ROUTE', carrierId: state.playerCarrierId, from, to });

const startedGame = (): GameState => newGame(1234, 'LON');

describe('newGame', () => {
  it('seats the player at the chosen home with the starting cash', () => {
    const state = startedGame();
    const player = getCarrier(state, state.playerCarrierId);
    expect(player.homeCityId).toBe('LON');
    expect(player.cash).toBe(CONSTANTS.game.startingCash);
    expect(state.turn).toBe(0);
    expect(state.routes).toEqual([]);
  });

  it('rejects an unknown home city', () => {
    expect(() => newGame(1, 'XXX')).toThrow(/Unknown home city/);
  });
});

describe('OPEN_ROUTE', () => {
  it('opens a sector and charges the opening cost', () => {
    const before = startedGame();
    const result = open(before, 'LON', 'NYC');
    expect(result.ok).toBe(true);
    expect(result.state.routes).toHaveLength(1);
    // Home base is LON, so only New York is a station this carrier has to stand up.
    expect(getCarrier(result.state, 'player').cash).toBe(
      CONSTANTS.game.startingCash - CONSTANTS.routes.openingCost - CONSTANTS.routes.newStationCost,
    );
  });

  it('charges for each endpoint it does not already serve', () => {
    const base = startedGame(); // home LON
    // Away from the network entirely: two stations to stand up.
    const away = open(base, 'NYC', 'LAX');
    expect(away.ok).toBe(true);
    expect(getCarrier(away.state, 'player').cash).toBe(
      CONSTANTS.game.startingCash
        - CONSTANTS.routes.openingCost
        - 2 * CONSTANTS.routes.newStationCost,
    );

    // Having opened LON-NYC, a second sector out of New York re-uses that station,
    // so only Los Angeles is charged. This asymmetry is what makes a hub worth
    // building rather than scattering single sectors across the map.
    const first = open(base, 'LON', 'NYC').state;
    const cashAfterFirst = getCarrier(first, 'player').cash;
    const second = open(first, 'NYC', 'LAX');
    expect(second.ok).toBe(true);
    expect(getCarrier(second.state, 'player').cash).toBe(
      cashAfterFirst - CONSTANTS.routes.openingCost - CONSTANTS.routes.newStationCost,
    );

    // And a sector between two cities already served costs the base fee alone.
    const third = open(second.state, 'LON', 'LAX');
    expect(third.ok).toBe(true);
    expect(getCarrier(third.state, 'player').cash).toBe(
      getCarrier(second.state, 'player').cash - CONSTANTS.routes.openingCost,
    );
  });

  it('leaves the previous state untouched', () => {
    const before = startedGame();
    const after = open(before, 'LON', 'NYC').state;
    expect(before.routes).toHaveLength(0);
    expect(after).not.toBe(before);
    expect(getCarrier(before, 'player').cash).toBe(CONSTANTS.game.startingCash);
  });

  it('treats a city pair as unordered', () => {
    const once = open(startedGame(), 'LON', 'NYC').state;
    const twice = open(once, 'NYC', 'LON');
    expect(twice.ok).toBe(false);
    expect(twice.error).toMatch(/already fly/i);
    expect(twice.state.routes).toHaveLength(1);
  });

  it('refuses a city pair below the minimum distance', () => {
    // London–Paris is ~340 km, but London–Manchester is ~262 km; pick a pair
    // that is unambiguously too short whatever the constant is tuned to.
    const result = open(startedGame(), 'NYC', 'PHL');
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/New York–Philadelphia/);
    expect(result.error).toContain('130 km');
    expect(result.error).toContain(`${CONSTANTS.routes.minDistanceKm} km`);
  });

  it('refuses a route to itself', () => {
    expect(open(startedGame(), 'LON', 'LON').ok).toBe(false);
  });

  it('refuses unknown cities', () => {
    expect(open(startedGame(), 'LON', 'ZZZ').ok).toBe(false);
  });

  it('refuses to open what it cannot pay for', () => {
    const broke = startedGame();
    getCarrier(broke, 'player').cash = 1;
    const result = open(broke, 'LON', 'NYC');
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/cash/i);
  });
});

describe('route edits', () => {
  it('sets posture and closes routes', () => {
    const state = open(startedGame(), 'LON', 'NYC').state;
    const routeId = state.routes[0]!.id;

    expect(applyAction(state, { type: 'SET_POSTURE', routeId, posture: 'undercut' }).state.routes[0]!.posture).toBe(
      'undercut',
    );
    expect(applyAction(state, { type: 'CLOSE_ROUTE', routeId }).state.routes).toHaveLength(0);
    expect(applyAction(state, { type: 'CLOSE_ROUTE', routeId: 'nope' }).ok).toBe(false);
  });
});

describe('endTurn', () => {
  it('advances the quarter and records a result per carrier', () => {
    const state = endTurn(open(startedGame(), 'LON', 'NYC').state);
    expect(state.turn).toBe(1);
    expect(state.history).toHaveLength(1);
    expect(state.history[0]!.turn).toBe(1);
  });

  it('books net income against cash exactly', () => {
    const before = open(startedGame(), 'LON', 'NYC').state;
    const cashBefore = getCarrier(before, 'player').cash;
    const after = endTurn(before);
    const record = after.history.at(-1)!;
    expect(record.netIncome).toBeCloseTo(
      record.revenue - record.fuel - record.crew - record.maintenance - record.handling -
        record.lease - record.standing - record.fixed - record.overhead - record.tax,
      6,
    );
    expect(getCarrier(after, 'player').cash).toBeCloseTo(cashBefore + record.netIncome, 6);
    expect(record.cashAfter).toBeCloseTo(getCarrier(after, 'player').cash, 6);
  });

  it('is deterministic for a given seed and action sequence', () => {
    const play = () => {
      let state = newGame(2024, 'SIN');
      state = open(state, 'SIN', 'TYO').state;
      state = open(state, 'SIN', 'SYD').state;
      for (let i = 0; i < 25; i++) state = endTurn(state);
      return state;
    };
    expect(JSON.stringify(play())).toBe(JSON.stringify(play()));
  });

  /** Open ZRH–PRG, staff it with `typeId`, run `turns` quarters, return cash. */
  const playStaffed = (seed: number, typeId: string, turns = 25): number => {
    let state = open(newGame(seed, 'ZRH'), 'ZRH', 'PRG').state;
    state = applyAction(state, {
      type: 'ACQUIRE_AIRCRAFT', carrierId: 'player', typeId, ownership: 'leased',
    }).state;
    const tailId = getCarrier(state, 'player').fleet[0]!.id;
    state = applyAction(state, {
      type: 'ASSIGN_AIRCRAFT', carrierId: 'player', tailId, routeId: state.routes[0]!.id,
    }).state;
    for (let i = 0; i < turns; i++) state = endTurn(state);
    return getCarrier(state, 'player').cash;
  };

  it('diverges for different seeds', () => {
    // Needs a sector with spare seats — see the sold-out case below.
    expect(playStaffed(1, 'AROSW5')).not.toBe(playStaffed(2, 'AROSW5'));
  });

  it('reaches even a sold-out sector with variance', () => {
    // This test used to assert the opposite. Through Phases 1 and 2 the only
    // stochastic input was demand, and a route already turning traffic away
    // simply spilled less — so two seeds settled identically on a full aircraft
    // and a competent operator's income was a straight line.
    //
    // Phase 3 fixed that on purpose: the fuel price walks and part of the
    // schedule fails to operate, both of which bite whether or not there are
    // spare seats to sell.
    expect(playStaffed(1, 'TARN42')).not.toBe(playStaffed(2, 'TARN42'));
  });

  it('grounds a carrier that runs out of cash and ends the game', () => {
    let state = open(startedGame(), 'LON', 'NYC').state;
    // Forced into a hole deeper than any single quarter's result can fill, so
    // the test exercises the bankruptcy path rather than the economics.
    getCarrier(state, 'player').cash = -1e12;
    state = endTurn(state);
    expect(state.carriers[0]!.bankruptTurn).toBe(1);
    expect(state.routes).toHaveLength(0);
    expect(state.gameOver?.reason).toMatch(/bankrupt/i);
    expect(state.gameOver?.outcome).toBe('lost');
  });

  it('stops at the horizon and records whether the player won', () => {
    let state = startedGame();
    for (let i = 0; i < CONSTANTS.game.horizonTurns + 10; i++) state = endTurn(state);
    expect(state.turn).toBe(CONSTANTS.game.horizonTurns);
    expect(state.gameOver).not.toBeNull();
    expect(['won', 'lost']).toContain(state.gameOver!.outcome);
    // A full-horizon game with a live M&A market runs several seconds, and longer
    // again when the rest of the suite is competing for the CPU.
  });

  it('refuses actions once the game is over', () => {
    let state = startedGame();
    for (let i = 0; i < CONSTANTS.game.horizonTurns; i++) state = endTurn(state);
    expect(open(state, 'LON', 'NYC').ok).toBe(false);
  });

  it('never produces NaN in a long run', () => {
    let state = open(newGame(77, 'DXB'), 'DXB', 'LON').state;
    for (let i = 0; i < 60 && !state.gameOver; i++) {
      state = endTurn(state);
      const player = getCarrier(state, 'player');
      expect(Number.isFinite(player.cash)).toBe(true);
      expect(Number.isFinite(state.history.at(-1)!.revenue)).toBe(true);
    }
  });

  it('never books negative revenue', () => {
    // Demand noise is multiplicative; a deep enough draw must still clamp at
    // zero rather than paying passengers to fly.
    let state = open(newGame(9, 'JNB'), 'JNB', 'LON').state;
    for (let i = 0; i < 80 && !state.gameOver; i++) {
      state = endTurn(state);
      expect(state.history.at(-1)!.revenue).toBeGreaterThanOrEqual(0);
    }
  });
});

describe('turnLabel', () => {
  it('reads as a calendar quarter from the configured start year', () => {
    const { startYear } = CONSTANTS.game;
    expect(turnLabel(0)).toBe(`Q1 ${startYear}`);
    expect(turnLabel(3)).toBe(`Q4 ${startYear}`);
    expect(turnLabel(4)).toBe(`Q1 ${startYear + 1}`);
    expect(turnLabel(100)).toBe(`Q1 ${startYear + 25}`);
  });
});

describe('fleet aging levers', () => {
  const buy = (state: GameState, typeId: string, ownership: 'owned' | 'leased') =>
    applyAction(state, { type: 'ACQUIRE_AIRCRAFT', carrierId: 'player', typeId, ownership });

  it('charges a break fee for handing a lease back early', () => {
    const state = buy(startedGame(), 'AROSN3', 'leased').state;
    const tailId = getCarrier(state, 'player').fleet[0]!.id;
    const cashBefore = getCarrier(state, 'player').cash;
    const after = applyAction(state, { type: 'DISPOSE_AIRCRAFT', carrierId: 'player', tailId });
    expect(after.ok).toBe(true);
    expect(getCarrier(after.state, 'player').cash).toBeLessThan(cashBefore);
  });

  it('lets a served-out lease go back for nothing', () => {
    let state = buy(startedGame(), 'AROSN3', 'leased').state;
    const tailId = getCarrier(state, 'player').fleet[0]!.id;
    for (let i = 0; i < CONSTANTS.fleet.leaseTermYears * CONSTANTS.game.quartersPerYear; i++) {
      state = endTurn(state);
    }
    const cashBefore = getCarrier(state, 'player').cash;
    const after = applyAction(state, { type: 'DISPOSE_AIRCRAFT', carrierId: 'player', tailId });
    expect(after.ok).toBe(true);
    expect(getCarrier(after.state, 'player').cash).toBeCloseTo(cashBefore, 6);
  });

  it('overhauls an owned aircraft for cash and resets its age', () => {
    // Fund the balance sheet directly: a bought airframe plus ten years of
    // standing costs would otherwise bankrupt the carrier before it can age.
    const funded = startedGame();
    getCarrier(funded, 'player').cash = 1e9;
    let state = buy(funded, 'AROSN3', 'owned').state;
    const tailId = getCarrier(state, 'player').fleet[0]!.id;
    for (let i = 0; i < 40; i++) state = endTurn(state);
    const cashBefore = getCarrier(state, 'player').cash;

    const after = applyAction(state, { type: 'OVERHAUL_AIRCRAFT', carrierId: 'player', tailId });
    expect(after.ok).toBe(true);
    expect(getCarrier(after.state, 'player').cash).toBeLessThan(cashBefore);
    expect(findTail(getCarrier(after.state, 'player'), tailId)!.overhauledTurn).toBe(state.turn);
  });

  it('refuses to overhaul a leased aircraft', () => {
    const state = buy(startedGame(), 'AROSN3', 'leased').state;
    const tailId = getCarrier(state, 'player').fleet[0]!.id;
    const result = applyAction(state, { type: 'OVERHAUL_AIRCRAFT', carrierId: 'player', tailId });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/own/i);
  });
});
