/**
 * Demand and route economics. These tests pin the *shape* of the model — the
 * trade-offs the game is made of — not specific balance figures, which move
 * every time constants.json is tuned.
 */
import { describe, expect, it } from 'vitest';
import {
  assignedTo, buildMarketIndex, computeRouteEconomics, computeCarrierQuarter, feedFactor,
  feedMultiplier, idleCost, marketBoard, marketKey, rivalCapacityOf, rivalsOf, stationOverheadFor,
  technologyValue,
} from '../src/sim/economics.ts';
import {
  attractiveness, clearDemandCache, competitionFareMultiplier, demandShare, expectedLoad,
  fareOneWay, incumbentStrength, marketDemandWeekly, priceStimulation,
} from '../src/sim/demand.ts';
import { getCity, CONSTANTS } from '../src/sim/world.ts';
import { applyAction, endTurn, getCarrier, newGame } from '../src/sim/engine.ts';
import { AIRCRAFT_TYPES, getAircraftType } from '../src/sim/fleet.ts';
import type { Aircraft, Carrier, PricingPosture, Route } from '../src/sim/types.ts';
import { NEUTRAL, conditionsFor, klassesOf, type Conditions } from '../src/sim/conditions.ts';

const route = (from: string, to: string, posture: PricingPosture = 'match'): Route => ({
  id: 'r', carrierId: 'player', from, to, posture, openedTurn: 0,
});

const tails = (typeId: string, n = 1, ownership: 'owned' | 'leased' = 'leased'): Aircraft[] =>
  Array.from({ length: n }, (_, i) => ({
    id: `AC-${i}`, typeId, ownership, acquiredTurn: 0, deliversTurn: 0, bookValue: 0, routeId: 'r',
  }));

/** Baseline operating conditions: nothing unusual happening in the world. */
const CALM: Conditions = { ...NEUTRAL, fuelPrice: 0.8 };

const econ = (r: Route, t: Aircraft[], mult = 1) =>
  computeRouteEconomics(r, t, 0, { ...CALM, demand: CALM.demand * mult });

describe('market demand', () => {
  it('grows with population and falls with distance', () => {
    const big = marketDemandWeekly(getCity('NYC'), getCity('CHI'));
    const small = marketDemandWeekly(getCity('MSY'), getCity('STL'));
    expect(big).toBeGreaterThan(small);

    const near = marketDemandWeekly(getCity('LON'), getCity('PAR'));
    const far = marketDemandWeekly(getCity('LON'), getCity('SYD'));
    expect(near).toBeGreaterThan(far);
  });

  it('is symmetric', () => {
    expect(marketDemandWeekly(getCity('LON'), getCity('NYC'))).toBeCloseTo(
      marketDemandWeekly(getCity('NYC'), getCity('LON')), 6);
  });

  it('is always positive and finite', () => {
    for (const [a, b] of [['LON', 'NYC'], ['POM', 'CNS'], ['MLE', 'SIN'], ['ANC', 'TYO']] as const) {
      const d = marketDemandWeekly(getCity(a), getCity(b));
      expect(Number.isFinite(d), `${a}-${b}`).toBe(true);
      expect(d, `${a}-${b}`).toBeGreaterThan(0);
    }
  });
});

describe('demand share', () => {
  /** Share for one carrier flying `f` round trips at `posture`, against rivals. */
  const share = (f: number, posture: PricingPosture, market: number, rivalTotal = 0) =>
    demandShare(attractiveness(f, posture), rivalTotal, market);

  it('is zero without service and rises with frequency', () => {
    expect(share(0, 'match', 10000)).toBe(0);
    expect(share(20, 'match', 10000)).toBeGreaterThan(share(10, 'match', 10000));
  });

  it('never reaches 1 — the incumbent always keeps some', () => {
    // The unmodeled rest of the industry. Without it a lone carrier would take
    // the whole market and the map would be a solved problem.
    expect(share(10_000, 'match', 10000)).toBeLessThan(1);
    expect(share(10_000, 'undercut', 500)).toBeLessThan(1);
  });

  it('has diminishing returns on piling frequency onto one sector', () => {
    // Equal increments of frequency, not doublings: each extra round trip must
    // buy less share than the one before it.
    const at = (f: number) => share(f, 'match', 50000);
    expect(at(20) - at(10)).toBeGreaterThan(at(30) - at(20));
    expect(at(30) - at(20)).toBeGreaterThan(at(40) - at(30));
  });

  it('makes bigger markets harder to dominate', () => {
    expect(share(20, 'match', 5000)).toBeGreaterThan(share(20, 'match', 100000));
  });

  it('trades share against yield through posture', () => {
    expect(share(20, 'undercut', 10000)).toBeGreaterThan(share(20, 'match', 10000));
    expect(share(20, 'premium', 10000)).toBeLessThan(share(20, 'match', 10000));

    const a = getCity('LON'), b = getCity('NYC');
    expect(fareOneWay(a, b, 'undercut')).toBeLessThan(fareOneWay(a, b, 'match'));
    expect(fareOneWay(a, b, 'premium')).toBeGreaterThan(fareOneWay(a, b, 'match'));
  });
});

describe('competition between carriers', () => {
  const own = attractiveness(20, 'match');

  it('splits a market: every rival costs the incumbent share', () => {
    const alone = demandShare(own, 0, 20000);
    const one = demandShare(own, own, 20000);
    const two = demandShare(own, own * 2, 20000);
    expect(one).toBeLessThan(alone);
    expect(two).toBeLessThan(one);
  });

  it('costs enough share to be worth reacting to', () => {
    // The Phase 2 acceptance test is that the player changes decisions because
    // of rivals. If one equal rival barely dents your share, nobody would.
    const alone = demandShare(own, 0, 20000);
    const contested = demandShare(own, own, 20000);
    expect(1 - contested / alone).toBeGreaterThan(0.15);
  });

  it('leaves shares plus the incumbent summing to exactly one', () => {
    const market = 30000;
    const carriers = [attractiveness(18, 'match'), attractiveness(25, 'undercut'), attractiveness(9, 'premium')];
    const total = carriers.reduce((a, b) => a + b, 0);
    const shares = carriers.map((c) => demandShare(c, total - c, market));
    const incumbent = incumbentStrength(market) / (total + incumbentStrength(market));
    expect(shares.reduce((a, b) => a + b, 0) + incumbent).toBeCloseTo(1, 9);
  });

  it('gives the more attractive carrier the bigger share of the same market', () => {
    const strong = attractiveness(30, 'undercut');
    const weak = attractiveness(10, 'premium');
    expect(demandShare(strong, weak, 20000)).toBeGreaterThan(demandShare(weak, strong, 20000));
  });

  it('empties planes on a contested route — overcapacity bites load, not just fare', () => {
    // The fix for "a rival enters my trunk route and I feel nothing": on a market
    // so large the incumbent flies full from spill, an equal rival must still drop
    // the load factor and the profit, not merely shave the fare.
    const state = newGame(1, 'LON');
    const carrier = getCarrier(state, 'player');
    const route: Route = { id: 'r', carrierId: 'player', from: 'LON', to: 'IST', posture: 'match', openedTurn: 0 };
    const tails = [0, 1, 2].map((i) => ({
      id: `t${i}`, typeId: 'AROSN2', ownership: 'owned' as const, acquiredTurn: 0, deliversTurn: 0, bookValue: 0, routeId: 'r',
    }));
    const cond = conditionsFor(state, carrier, route, new Set(['Narrowbody']));
    const mono = computeRouteEconomics(route, tails, 0, cond, 0, 0, 1);
    const rivalAttr = attractiveness(mono.frequencyWeekly, 'match', mono.capacityWeekly / 2 / mono.frequencyWeekly);
    const contested = computeRouteEconomics(route, tails, 0, cond, rivalAttr, mono.capacityWeekly, 1);
    expect(contested.loadFactor).toBeLessThan(mono.loadFactor); // planes fly emptier
    expect(contested.netCash).toBeLessThan(mono.netCash); // and the route earns less
  });
});

describe('fares', () => {
  it('rise with distance but yield per km falls', () => {
    const short = fareOneWay(getCity('LON'), getCity('PAR'), 'match');
    const long = fareOneWay(getCity('LON'), getCity('SIN'), 'match');
    expect(long).toBeGreaterThan(short);

    const shortKm = 340, longKm = 10850;
    expect(long / longKm).toBeLessThan(short / shortKm);
  });
});

describe('the hub-feed bonus', () => {
  it('rewards connecting routes with a saturating, capped lift', () => {
    expect(feedMultiplier(0)).toBe(1);
    expect(feedMultiplier(6)).toBeGreaterThan(feedMultiplier(2));
    // Diminishing: the step from 2 to 4 exceeds the step from 20 to 22.
    expect(feedMultiplier(4) - feedMultiplier(2)).toBeGreaterThan(feedMultiplier(22) - feedMultiplier(20));
    // Never exceeds the ceiling however large the hub.
    expect(feedMultiplier(100_000)).toBeLessThanOrEqual(1 + CONSTANTS.feed.maxBonus);
  });

  it('counts a carrier\'s OTHER routes touching either endpoint, and no one else\'s', () => {
    const r = (id: string, from: string, to: string, carrierId = 'c'): Route =>
      ({ id, carrierId, from, to, posture: 'match', openedTurn: 0 });
    const routes = [
      r('ab', 'A', 'B'), r('ac', 'A', 'C'), r('ad', 'A', 'D'), r('be', 'B', 'E'),
      r('xy', 'A', 'B', 'other'), // a rival's route at the same endpoints does not count
    ];
    // For A–B: two other routes at A (ac, ad) and one at B (be) = 3 connections.
    expect(feedFactor(routes, 'c', 'A', 'B', 'ab')).toBeCloseTo(feedMultiplier(3), 9);
    // Without excluding the sector itself (an unopened probe), A–B counts too: 3 + 2 = 5.
    expect(feedFactor(routes, 'c', 'A', 'B')).toBeCloseTo(feedMultiplier(5), 9);
  });

  it('lifts a hub carrier\'s share on a sector it contests', () => {
    const state = newGame(1, 'LON');
    const carrier = getCarrier(state, 'player');
    const route: Route = { id: 'r', carrierId: 'player', from: 'LON', to: 'NYC', posture: 'match', openedTurn: 0 };
    const tails = [getAircraftType('AROSN3')].map((t) => ({
      id: 't', typeId: t.id, ownership: 'leased' as const, acquiredTurn: 0, deliversTurn: 0, bookValue: 0, routeId: 'r',
    }));
    const cond = conditionsFor(state, carrier, route, new Set(['Narrowbody']));
    // Same sector, same rivals — only the hub feed differs.
    const rival = 5; // a real competitor is present, so the split can move
    const lone = computeRouteEconomics(route, tails, 0, cond, rival, 0, 1);
    const hub = computeRouteEconomics(route, tails, 0, cond, rival, 0, feedMultiplier(8));
    expect(hub.demandShare).toBeGreaterThan(lone.demandShare);
  });
});

describe('market structure moves the fare', () => {
  it('charges the full monopoly premium on a route no rival serves', () => {
    // An uncontested route clears above the competitive fare — pricing power on
    // a captive market, which is what sustains small aircraft on thin routes.
    expect(competitionFareMultiplier(0, 5000)).toBeCloseTo(1 + CONSTANTS.fare.monopolyPremium, 9);
  });

  it('erodes the premium as rivals add capacity, first entrant biting most', () => {
    const monopoly = competitionFareMultiplier(0, 5000);
    const oneRival = competitionFareMultiplier(1500, 5000);
    const crowded = competitionFareMultiplier(6000, 5000);
    expect(oneRival).toBeLessThan(monopoly);
    expect(crowded).toBeLessThan(oneRival);
    // It decays toward the base competitive fare, never below it.
    expect(crowded).toBeGreaterThan(1);
    // Diminishing: the drop from monopoly to one rival exceeds the next equal step.
    const twoRivals = competitionFareMultiplier(3000, 5000);
    expect(monopoly - oneRival).toBeGreaterThan(oneRival - twoRivals);
  });

  it('halves the premium when rivals supply the configured share of the market', () => {
    const half = competitionFareMultiplier(CONSTANTS.fare.competitionHalfShare * 5000, 5000);
    const premium = half - 1;
    expect(premium).toBeCloseTo(CONSTANTS.fare.monopolyPremium / 2, 9);
  });

  it('treats a market with no measurable demand as uncontested rather than dividing by zero', () => {
    expect(competitionFareMultiplier(1000, 0)).toBeCloseTo(1 + CONSTANTS.fare.monopolyPremium, 9);
  });

  it('actually lands in the revenue: a monopoly sector out-earns a contested one', () => {
    const state = newGame(1, 'LON');
    const carrier = getCarrier(state, 'player');
    const route = { id: 'r', carrierId: 'player', from: 'LON', to: 'NYC', posture: 'match' as const, openedTurn: 0 };
    const tails = [getAircraftType('AROSN3')].map((t) => ({
      id: 't', typeId: t.id, ownership: 'leased' as const, acquiredTurn: 0, deliversTurn: 0, bookValue: 0, routeId: 'r',
    }));
    const cond = conditionsFor(state, carrier, route, new Set(['Narrowbody']));
    const monopoly = computeRouteEconomics(route, tails, 0, cond, 0, 0);
    const contested = computeRouteEconomics(route, tails, 0, cond, 0, 8000);
    expect(monopoly.competitionMultiplier).toBeGreaterThan(contested.competitionMultiplier);
    expect(monopoly.fareOneWay).toBeGreaterThan(contested.fareOneWay);
    expect(monopoly.revenue).toBeGreaterThan(contested.revenue);
  });
});

describe('route economics', () => {
  it('reports nothing flown with no aircraft', () => {
    const e = econ(route('LON', 'NYC'), []);
    expect(e.frequencyWeekly).toBe(0);
    expect(e.capacityWeekly).toBe(0);
    expect(e.revenue).toBe(0);
    expect(e.loadFactor).toBe(0);
    expect(e.fixed).toBe(0); // a dormant sector pays no station cost
    expect(e.netCash).toBe(0);
  });

  it('has components that sum to the net', () => {
    const e = econ(route('LON', 'FRA'), tails('AROSN2', 2));
    expect(e.netCash).toBeCloseTo(
      e.revenue - e.fuel - e.crew - e.maintenance - e.handling - e.lease - e.standing -
        e.fixed - e.overhead, 6);
  });

  it('never exceeds capacity or reports a load factor above 1', () => {
    for (const [a, b] of [['LON', 'FRA'], ['ZRH', 'PRG'], ['NYC', 'LON'], ['POM', 'CNS']] as const) {
      for (const t of ['TARN42', 'AROSN2', 'VANTA8']) {
        const type = getAircraftType(t);
        const r = route(a, b);
        const e = econ(r, tails(t, 2));
        if (e.capacityWeekly === 0) continue;
        expect(e.loadFactor, `${a}-${b} ${type.name}`).toBeLessThanOrEqual(1 + 1e-9);
        expect(e.paxCarriedWeekly).toBeLessThanOrEqual(e.capacityWeekly + 1e-6);
      }
    }
  });

  it('reports traffic and capacity in one consistent unit', () => {
    // The struct used to mix conventions: capacity and market were one-way while
    // passengers were both directions. The dossier showed them side by side, so
    // a sector read as carrying more passengers than it had seats, and spill was
    // understated twofold. These two invariants are what stop that recurring.
    for (const [a, b] of [
      ['LON', 'FRA'], ['ZRH', 'PRG'], ['NYC', 'LON'], ['SIN', 'SYD'], ['LON', 'NYC'],
    ] as const) {
      for (const t of ['TARN42', 'AROSN2', 'AROSN3', 'VANTA8']) {
        for (const p of ['premium', 'match', 'undercut'] as const) {
          const e = econ(route(a, b, p), tails(t, 2));
          if (e.capacityWeekly === 0) continue;
          const label = `${a}-${b} ${t} ${p}`;
          // Everyone who chose this carrier either flew or was turned away. The
          // traffic won is the market share, stimulated by the carrier's own
          // posture (cheaper fares create trips — see priceStimulation).
          const stim = priceStimulation(getCity(a), getCity(b), p);
          expect(e.paxCarriedWeekly + e.spilledWeekly, label).toBeCloseTo(
            e.marketDemandWeekly * e.demandShare * stim, 4);
          // And nobody flew in a seat that was not offered.
          expect(e.paxCarriedWeekly, label).toBeLessThanOrEqual(
            e.capacityWeekly * e.loadCeiling + 1e-6);
        }
      }
    }
  });

  it('keeps an ordered aircraft off the market until it is delivered', () => {
    // An earmarked tail flies nothing and costs the route nothing until it
    // arrives — the settlement has always known that. The market index did not,
    // so a carrier took share, and eroded everyone's fare premium, with metal
    // that did not exist yet: order two, and the market read twice the seats.
    let state = newGame(3, 'LON');
    state = applyAction(state, {
      type: 'OPEN_ROUTE', carrierId: 'player', from: 'LON', to: 'NYC',
    }).state;
    const opened = state.routes[0]!;
    state = applyAction(state, {
      type: 'ACQUIRE_AIRCRAFT', carrierId: 'player', typeId: 'VANTA8', ownership: 'leased',
    }).state;
    const tail = getCarrier(state, 'player').fleet[0]!;
    expect(tail.deliversTurn).toBeGreaterThan(state.turn); // else this proves nothing
    state = applyAction(state, {
      type: 'ASSIGN_AIRCRAFT', carrierId: 'player', tailId: tail.id, routeId: opened.id,
    }).state;

    const key = marketKey(opened.from, opened.to);
    expect(buildMarketIndex(state).get(key) ?? []).toEqual([]);

    // ...and it joins the market on the quarter it arrives, not before.
    const arrived = buildMarketIndex({ ...state, turn: tail.deliversTurn }).get(key) ?? [];
    expect(arrived.map((p) => p.carrierId)).toEqual(['player']);
    expect(arrived[0]!.capacityWeekly).toBeGreaterThan(0);
  });

  it('reports each carrier\'s equipment on a shared market', () => {
    // The board is how a player reads a rival's gauge. Counts alone cannot
    // explain why two carriers flying "1 aircraft" offer different seats.
    let state = newGame(3, 'LON');
    state = applyAction(state, {
      type: 'OPEN_ROUTE', carrierId: 'player', from: 'LON', to: 'NYC',
    }).state;
    // Leased, not bought: a widebody costs more outright than the starting cash,
    // and an ACQUIRE that quietly fails would leave this testing nothing.
    const bought = applyAction(state, {
      type: 'ACQUIRE_AIRCRAFT', carrierId: 'player', typeId: 'VANTA8', ownership: 'leased',
    });
    expect(bought.ok, bought.error).toBe(true);
    state = bought.state;
    const tailId = getCarrier(state, 'player').fleet[0]!.id;
    const assigned = applyAction(state, {
      type: 'ASSIGN_AIRCRAFT', carrierId: 'player', tailId, routeId: state.routes[0]!.id,
    });
    expect(assigned.ok, assigned.error).toBe(true);
    state = assigned.state;
    // Take delivery: an ordered tail is earmarked, not in service, so it is not on
    // the market board until it arrives. This test is about what the board reports
    // for equipment that is flying.
    state = { ...state, carriers: state.carriers.map((c) => c.id === 'player' ? { ...c, fleet: c.fleet.map((t) => ({ ...t, deliversTurn: 0 })) } : c) };

    const board = marketBoard(state, buildMarketIndex(state), state.routes[0]!);
    const mine = board.find((b) => b.carrierId === 'player')!;
    expect(mine.typeIds).toEqual(['VANTA8']);
    expect(mine.typeIds.length).toBe(mine.econ.aircraftCount);
    expect(mine.owned + mine.leased).toBe(mine.typeIds.length);

    // With no programs delivered, the counterfactual must be the actual.
    expect(getCarrier(state, 'player').tech).toEqual([]);
    expect(mine.netWithoutTech).toBeCloseTo(mine.econ.netCash, 6);
  });

  it('values a carrier\'s technology against the same sector without it', () => {
    let state = newGame(3, 'LON');
    state = applyAction(state, {
      type: 'OPEN_ROUTE', carrierId: 'player', from: 'LON', to: 'NYC',
    }).state;
    const bought = applyAction(state, {
      type: 'ACQUIRE_AIRCRAFT', carrierId: 'player', typeId: 'VANTA8', ownership: 'leased',
    });
    state = bought.state;
    const tailId = getCarrier(state, 'player').fleet[0]!.id;
    state = applyAction(state, {
      type: 'ASSIGN_AIRCRAFT', carrierId: 'player', tailId, routeId: state.routes[0]!.id,
    }).state;
    state = { ...state, carriers: state.carriers.map((c) => c.id === 'player' ? { ...c, fleet: c.fleet.map((t) => ({ ...t, deliversTurn: 0 })) } : c) };

    // Deliver the revenue-side programs outright rather than waiting on them.
    const teched = {
      ...state,
      carriers: state.carriers.map((c) =>
        c.id === 'player' ? { ...c, tech: ['revenue-management', 'direct-booking'] } : c,
      ),
    };
    const before = marketBoard(state, buildMarketIndex(state), state.routes[0]!)
      .find((b) => b.carrierId === 'player')!;
    const after = marketBoard(teched, buildMarketIndex(teched), teched.routes[0]!)
      .find((b) => b.carrierId === 'player')!;

    // Their technology is worth the gap between the two, and it is real money.
    expect(after.econ.netCash - after.netWithoutTech).toBeGreaterThan(0);
    // Stripping the tech back out reproduces the unteched sector exactly.
    expect(after.netWithoutTech).toBeCloseTo(before.econ.netCash, 6);
  });

  it('values technology across a whole network, not just one sector', () => {
    let state = newGame(5, 'LON');
    for (const to of ['NYC', 'PAR', 'ROM'] as const) {
      state = applyAction(state, {
        type: 'OPEN_ROUTE', carrierId: 'player', from: 'LON', to,
      }).state;
    }
    for (const route of [...state.routes]) {
      const got = applyAction(state, {
        type: 'ACQUIRE_AIRCRAFT', carrierId: 'player', typeId: 'AROSN3', ownership: 'leased',
      });
      expect(got.ok, got.error).toBe(true);
      state = got.state;
      const tail = getCarrier(state, 'player').fleet.at(-1)!.id;
      state = applyAction(state, {
        type: 'ASSIGN_AIRCRAFT', carrierId: 'player', tailId: tail, routeId: route.id,
      }).state;
    }
    state = { ...state, carriers: state.carriers.map((c) => c.id === 'player' ? { ...c, fleet: c.fleet.map((t) => ({ ...t, deliversTurn: 0 })) } : c) };

    const bare = getCarrier(state, 'player');
    expect(technologyValue(state, buildMarketIndex(state), bare)).toBe(0);

    const teched = {
      ...state,
      carriers: state.carriers.map((c) =>
        c.id === 'player' ? { ...c, tech: ['revenue-management', 'direct-booking'] } : c,
      ),
    };
    const carrier = getCarrier(teched, 'player');
    const index = buildMarketIndex(teched);
    const network = technologyValue(teched, index, carrier);
    expect(network).toBeGreaterThan(0);

    // The network figure is exactly the sum of the per-sector figures the market
    // board reports, so the two views can never tell the player different things.
    let summed = 0;
    for (const route of teched.routes) {
      const standing = marketBoard(teched, index, route).find((b) => b.carrierId === 'player');
      if (standing) summed += standing.econ.netCash - standing.netWithoutTech;
    }
    expect(network).toBeCloseTo(summed, 6);
  });

  it('ignores an out-of-range tail for capacity but still bills it', () => {
    // A turboprop can't cross the Atlantic; assignment blocks this, but a
    // hand-edited save could contain it and must not produce phantom capacity.
    const e = econ(route('NYC', 'LON'), tails('TARN42', 1));
    expect(e.capacityWeekly).toBe(0);
    expect(e.revenue).toBe(0);
    expect(e.lease).toBeGreaterThan(0);
    expect(e.standing).toBeGreaterThan(0);
    expect(e.netCash).toBeLessThan(0);
  });

  it('charges lease only on leased tails', () => {
    expect(econ(route('LON', 'FRA'), tails('AROSN2', 1, 'owned')).lease).toBe(0);
    expect(econ(route('LON', 'FRA'), tails('AROSN2', 1, 'leased')).lease).toBeGreaterThan(0);
  });

  it('scales revenue with the demand multiplier', () => {
    const r = route('ZRH', 'PRG');
    const lean = econ(r, tails('TARN42', 1), 0.8);
    const rich = econ(r, tails('TARN42', 1), 1.2);
    expect(rich.marketDemandWeekly).toBeGreaterThan(lean.marketDemandWeekly);
    expect(rich.revenue).toBeGreaterThanOrEqual(lean.revenue);
  });

  it('makes gauge matter: the right size beats the wrong size on a thin market', () => {
    // The central Phase 1 decision. An oversized jet on a thinner sector flies
    // half-empty and loses to a right-sized one. Pick the pair by measuring
    // rather than naming one, so a demand re-calibration cannot quietly make
    // this test vacuous the way an earlier hard-coded pair did.
    const thin = route('ZRH', 'OSL');
    const small = econ(thin, tails('BOREAL100', 1));
    const large = econ(thin, tails('AROSW3', 1));
    expect(large.loadFactor).toBeLessThan(small.loadFactor);
    expect(small.netCash).toBeGreaterThan(large.netCash);
    // ...and the smaller one is genuinely profitable there, not merely less bad.
    expect(small.netCash).toBeGreaterThan(0);
  });

  it('keeps every aircraft gauge reachable in range terms', () => {
    // Not a claim that every type is economically optimal somewhere — six
    // currently are not, tracked as outstanding balance work — only that the
    // range ladder has no gaps that strand a type with nothing it can fly.
    for (const type of AIRCRAFT_TYPES) {
      expect(type.rangeKm, type.id).toBeGreaterThan(CONSTANTS.routes.minDistanceKm);
    }
  });

  it('rewards a big gauge on a fat market', () => {
    const r = route('LON', 'FRA');
    expect(econ(r, tails('AROSN3', 1)).netCash).toBeGreaterThan(econ(r, tails('CIRRO70', 1)).netCash);
  });

  it('has a profit peak in aircraft count rather than scaling for ever', () => {
    // Guards the "just pile everything onto one trunk route" dominant strategy.
    const r = route('LON', 'FRA');
    const nets = [1, 2, 4, 8, 12].map((n) => econ(r, tails('AROSN2', n)).netCash);
    const peak = nets.indexOf(Math.max(...nets));
    expect(peak).toBeGreaterThan(0);
    expect(nets.at(-1)).toBeLessThan(Math.max(...nets));
  });

  it('leaves at least one profitable opening sector from a major hub', () => {
    // If this fails the economy is unwinnable and nothing else matters.
    for (const home of ['LON', 'NYC', 'TYO', 'SIN']) {
      let best = -Infinity;
      for (const dest of ['NYC', 'LON', 'FRA', 'SIN', 'HKG', 'LAX', 'SFO', 'PAR', 'DXB']) {
        if (dest === home) continue;
        for (const type of AIRCRAFT_TYPES) {
          best = Math.max(best, econ(route(home, dest), tails(type.id, 1)).netCash);
        }
      }
      expect(best, `no profitable sector from ${home}`).toBeGreaterThan(0);
    }
  });
});

describe('carrier quarter', () => {
  /** A game with nothing unusual happening, for settling one quarter by hand. */
  const calmState = () => ({ ...newGame(1, 'LON'), fuelPrice: 0.8 });

  const carrier = (fleet: Aircraft[]): Carrier => ({
    id: 'player', name: 'Test Air', isPlayer: true, color: '#000', archetypeId: null,
    homeCityId: 'LON', cash: 0, fleet, tech: [], techInProgress: [], hedge: null,
    bankruptTurn: null, shares: 100_000_000, debt: 0, holdings: {}, stakeBought: {}, dividend: 0, integrationUntil: null, acquiredBy: null, bailouts: 0,
  });

  it('bills parked tails their lease and standing cost', () => {
    const parked = { ...tails('AROSN2', 1)[0]!, routeId: null };
    const q = computeCarrierQuarter(carrier([parked]), [], calmState(), () => 1);
    expect(q.revenue).toBe(0);
    expect(q.lease).toBeGreaterThan(0);
    expect(q.standing).toBeGreaterThan(0);
    expect(q.netIncome).toBeLessThan(0);
  });

  it('costs an idle tail exactly its lease plus standing', () => {
    const parked = { ...tails('AROSN2', 1)[0]!, routeId: null };
    const type = getAircraftType('AROSN2');
    const cost = idleCost(parked);
    expect(cost.lease).toBeCloseTo(type.leaseMonthly * 3, 6);
    expect(cost.standing).toBe(CONSTANTS.fleet.standingCostPerSeatQuarter * type.seats);
    expect(idleCost({ ...parked, ownership: 'owned' }).lease).toBe(0);
  });

  it('sums components to net income', () => {
    const fleet = tails('AROSN2', 2);
    const r: Route = { ...route('LON', 'FRA'), id: 'r' };
    const q = computeCarrierQuarter(carrier(fleet), [r], calmState(), () => 1);
    expect(q.netIncome).toBeCloseTo(
      q.revenue - q.fuel - q.crew - q.maintenance - q.handling - q.lease - q.standing -
        q.fixed - q.overhead - q.tax, 6);
  });

  it('ignores routes belonging to another carrier', () => {
    const foreign: Route = { ...route('LON', 'FRA'), id: 'r2', carrierId: 'rival' };
    const q = computeCarrierQuarter(carrier([]), [foreign], calmState(), () => 1);
    expect(q.revenue).toBe(0);
    expect(q.netIncome).toBe(0);
  });
});

describe('the demand memoization cache', () => {
  // marketDemandWeekly is memoized per city pair because the AI calls it
  // millions of times a game. That is safe only while the demand constants do
  // not move — anything that sweeps them must clear the cache first, or it will
  // quietly measure the old world.
  it('reflects a change to the demand constants once cleared', () => {
    const before = marketDemandWeekly(getCity('LON'), getCity('NYC'));
    const original = CONSTANTS.demand.k;
    try {
      CONSTANTS.demand.k = original * 2;
      expect(marketDemandWeekly(getCity('LON'), getCity('NYC'))).toBe(before); // stale, by design
      clearDemandCache();
      expect(marketDemandWeekly(getCity('LON'), getCity('NYC'))).toBeCloseTo(before * 2, 6);
    } finally {
      CONSTANTS.demand.k = original;
      clearDemandCache();
    }
    expect(marketDemandWeekly(getCity('LON'), getCity('NYC'))).toBeCloseTo(before, 6);
  });
});

describe('pricing posture is a cabin decision, not just a price one', () => {
  const seatsOn = (p: PricingPosture) =>
    econ(route('SIN', 'HKG', p), tails('AROSN3', 3)).capacityWeekly;

  it('changes how many seats the same aircraft carries', () => {
    // A premium cabin takes space from economy; a high-density fit puts it back.
    expect(seatsOn('premium')).toBeLessThan(seatsOn('match'));
    expect(seatsOn('undercut')).toBeGreaterThan(seatsOn('match'));
  });

  it('makes premium cost more per passenger to serve', () => {
    // Without this, premium raises fares on a sold-out sector for free — the
    // share it sheds was being spilled anyway. It was a cheat code.
    const prem = econ(route('SIN', 'HKG', 'premium'), tails('AROSN3', 3));
    const match = econ(route('SIN', 'HKG', 'match'), tails('AROSN3', 3));
    expect(prem.handling / prem.paxCarriedWeekly).toBeGreaterThan(
      match.handling / match.paxCarriedWeekly,
    );
  });

  it('does not let premium dominate a sold-out sector', () => {
    // The specific failure this guards: on a sector already turning traffic
    // away, premium used to be a free uplift on revenue with no offsetting cost.
    const r = route('SIN', 'HKG', 'match');
    const sold = econ(r, tails('AROSN3', 3));
    // Sold out means spilling, not sitting at the ceiling — see the spill model.
    expect(sold.spilledWeekly).toBeGreaterThan(0);
    expect(sold.loadFactor).toBeGreaterThan(0.75);

    const nets = (['premium', 'match', 'undercut'] as const).map(
      (p) => econ(route('SIN', 'HKG', p), tails('AROSN3', 3)).netCash,
    );
    const best = Math.max(...nets);
    // Premium may win, but never by a landslide on a sold-out sector.
    expect(nets[0]! / best).toBeLessThan(1.35);
  });

  it('favors dense low-fare cabins on short sectors and premium on long ones', () => {
    // The pattern the real industry shows: low-cost carriers own short-haul with
    // high-density fits; long-haul is where a premium cabin pays.
    const bestOn = (from: string, to: string, type: string, n: number) =>
      (['premium', 'match', 'undercut'] as const)
        .map((p) => ({ p, net: econ(route(from, to, p), tails(type, n)).netCash }))
        .sort((a, b) => b.net - a.net)[0]!.p;

    expect(bestOn('LON', 'FRA', 'AROSN2', 4)).toBe('undercut');
    expect(bestOn('NYC', 'LON', 'VANTA8', 2)).toBe('premium');
  });
});

describe('the S-curve: gauge feeds share', () => {
  it('gives a bigger aircraft more share at the same frequency', () => {
    // Real airlines gain share from capacity per flight, not only frequency.
    const narrow = attractiveness(30, 'match', 180);
    const wide = attractiveness(30, 'match', 325);
    expect(wide).toBeGreaterThan(narrow);
    // But sublinear, so upgauging one trunk route cannot run away.
    expect(wide / narrow).toBeLessThan(325 / 180);
  });

  it('leaves identical fleets on identical share, and differs when gauge differs', () => {
    const a = attractiveness(30, 'match', 220);
    const b = attractiveness(30, 'match', 220);
    const c = attractiveness(30, 'match', 325);
    expect(a).toBe(b); // two carriers flying the same thing genuinely tie
    expect(c).not.toBe(a); // a different gauge does not
  });

  it('defaults an unspecified gauge to neutral', () => {
    expect(attractiveness(30, 'match')).toBeCloseTo(
      attractiveness(30, 'match', CONSTANTS.share.refSeatsPerDeparture), 9);
  });
});

describe('price elasticity: cheaper fares fill', () => {
  it('has undercut stimulate demand and premium suppress it', () => {
    const leisure = ['CUN', 'LAS'] as const; // low combined weight
    const under = priceStimulation(getCity(leisure[0]), getCity(leisure[1]), 'undercut');
    const match = priceStimulation(getCity(leisure[0]), getCity(leisure[1]), 'match');
    const prem = priceStimulation(getCity(leisure[0]), getCity(leisure[1]), 'premium');
    expect(match).toBe(1); // match is the reference fare
    expect(under).toBeGreaterThan(1);
    expect(prem).toBeLessThan(1);
  });

  it('stimulates a leisure route far more than a business route', () => {
    // Gillen/InterVISTAS: leisure elasticity ~-1.9, business ~-0.5.
    const leisure = priceStimulation(getCity('CUN'), getCity('LAS'), 'undercut');
    const business = priceStimulation(getCity('ZRH'), getCity('FRA'), 'undercut');
    expect(leisure).toBeGreaterThan(business);
    expect(business).toBeGreaterThan(1); // still some lift, just less
  });

  it('actually raises the load a carrier can fill by undercutting a leisure market', () => {
    const tail = [{
      id: 'AC', typeId: 'AROSN3', ownership: 'leased' as const,
      acquiredTurn: 0, deliversTurn: 0, bookValue: 0, routeId: 'r',
    }];
    const r = (p: PricingPosture): Route => ({
      id: 'r', carrierId: 'player', from: 'CUN', to: 'LAS', posture: p, openedTurn: 0,
    });
    const under = econ(r('undercut'), tail);
    const match = econ(r('match'), tail);
    if (under.capacityWeekly > 0 && under.loadFactor < under.loadCeiling - 0.01) {
      // Where there is slack, cheaper fares pull in more traffic to fill it.
      expect(under.paxCarriedWeekly).toBeGreaterThan(match.paxCarriedWeekly);
    }
  });
});

describe('owned aircraft carry depreciation at the route level', () => {
  const owned = (typeId: string, n: number, book: number): Aircraft[] =>
    Array.from({ length: n }, (_, i) => ({
      id: `AC-${i}`, typeId, ownership: 'owned' as const,
      acquiredTurn: 0, deliversTurn: 0, bookValue: book, routeId: 'r',
    }));

  it('charges owned metal depreciation and leased metal none', () => {
    const own = econ(route('BJS', 'SHA'), owned('AROSN3', 3, 60e6));
    const lease = econ(route('BJS', 'SHA'), tails('AROSN3', 3));
    expect(own.ownership).toBeCloseTo(3 * 60e6 * CONSTANTS.fleet.depreciationPerQuarter, 4);
    expect(own.lease).toBe(0);
    expect(lease.ownership).toBe(0);
    expect(lease.lease).toBeGreaterThan(0);
  });

  it('is the exact write-down the balance sheet takes, so it reconciles', () => {
    // The charge equals bookValue x rate — the same figure engine.ts uses to
    // depreciate the tail — so a route's economic net is its true contribution
    // to net worth (cash earned minus asset value lost).
    const e = econ(route('BJS', 'SHA'), owned('AROSN3', 2, 55e6));
    expect(e.ownership).toBeCloseTo(2 * 55e6 * CONSTANTS.fleet.depreciationPerQuarter, 4);
    expect(e.netEconomic).toBeCloseTo(e.netCash - e.ownership, 6);
  });

  it('falls as an aircraft ages and its book value declines', () => {
    const young = econ(route('BJS', 'SHA'), owned('AROSN3', 2, 60e6));
    const old = econ(route('BJS', 'SHA'), owned('AROSN3', 2, 20e6));
    expect(old.ownership).toBeLessThan(young.ownership);
    // Cash flow is untouched by depreciation; only the economic net moves.
    expect(old.netCash).toBeCloseTo(young.netCash, 6);
    expect(old.netEconomic).toBeGreaterThan(young.netEconomic);
  });

  it('leaves cash flow alone — depreciation is not a cash cost', () => {
    // The purchase was paid up front, so netCash must never carry depreciation;
    // this is what keeps it out of the bankruptcy check.
    const e = econ(route('LON', 'NYC'), owned('AROSN3', 2, 60e6));
    expect(e.netCash).toBeCloseTo(
      e.revenue - e.fuel - e.crew - e.maintenance - e.handling - e.lease - e.standing -
        e.fixed - e.overhead, 6);
  });
});

describe('the spill model', () => {
  // Both of the defects pinned here were silent: the arithmetic ran, produced a
  // plausible number, and nothing failed. They need tests that check the VALUE
  // against something independent, not just that a figure came out.

  it('matches the published spill curve', () => {
    // Boeing/MIT reference points for k = 0.35, verified against 300k Monte Carlo
    // draws of min(max(0, N(mu, k*mu)), C). Demand factor -> load factor.
    const seats = 100;
    const reference: readonly (readonly [number, number])[] = [
      [0.6, 0.598], [0.8, 0.761], [1.0, 0.861], [1.2, 0.914], [1.8, 0.969],
    ];
    for (const [demandFactor, expected] of reference) {
      const load = expectedLoad(demandFactor * seats, seats, 0.35) / seats;
      expect(load).toBeCloseTo(expected, 2);
    }
  });

  it('stays sane when demand dwarfs the seats', () => {
    // The textbook `mu - E[(D-C)+]` form integrates a normal tail that runs to
    // minus infinity. Because sigma is a fixed FRACTION of the mean, that tail
    // never goes away, so the error grew with the mean: it read 4.5 points low at
    // demand factor 200 and returned a flat ZERO by 2000 — a hundred seats facing
    // two hundred thousand passengers, carrying nobody.
    for (const demandFactor of [10, 100, 1_000, 10_000]) {
      const load = expectedLoad(demandFactor * 100, 100, 0.35) / 100;
      expect(load).toBeGreaterThan(0.99);
      expect(load).toBeLessThanOrEqual(1);
    }
  });

  it('never carries more than the seats or less than nobody', () => {
    for (const mu of [0, -5, 0.001, 50, 1e9]) {
      for (const seats of [0, -1, 1, 100, 1e9]) {
        const load = expectedLoad(mu, seats, 0.35);
        expect(Number.isFinite(load)).toBe(true);
        expect(load).toBeGreaterThanOrEqual(0);
        expect(load).toBeLessThanOrEqual(Math.max(0, seats) + 1e-6);
      }
    }
  });

  it('spills more as the seats get scarcer, and fills more as they get plentiful', () => {
    let previous = 0;
    for (const seats of [20, 40, 60, 80, 100, 140, 200]) {
      const load = expectedLoad(100, seats, 0.35);
      expect(load).toBeGreaterThanOrEqual(previous);
      previous = load;
    }
  });
});

describe('one-way and round-trip capacity are not mixed', () => {
  it('gives a mirror-image rival exactly half the market\'s capacity', () => {
    // `capacityWeekly` means ONE-WAY in the market index and ROUND-TRIP in the
    // struct this function returns, so `rivalCapacityWeekly` arrives one-way. It
    // was weighed against `2 * capacity`, the route total, which halved every
    // rival: two identical carriers scored a rival capacity share of 0.333 where
    // 0.500 is right, and competition was felt at half strength in both the load
    // penalty and market saturation.
    //
    // The share is not returned, so it is backed out of the ceiling that IS. On a
    // saturated market the settlement is
    //   ceiling = loadCeiling * (1 - competitionLoadPenalty * rivalCapShare)
    // which inverts exactly.
    const fleet = tails('AROSN4', 30);
    const sector = route('LON', 'PAR');
    const solo = computeRouteEconomics(sector, fleet, 0, CALM);
    const ownOneWay = solo.capacityWeekly / 2;
    // Enough metal that the two carriers together oversupply the market, so
    // saturation clamps to 1 and drops out of the inversion.
    expect(2 * ownOneWay).toBeGreaterThanOrEqual(solo.marketDemandWeekly / 2);

    const mirrored = computeRouteEconomics(sector, fleet, 0, CALM, 0, ownOneWay);
    const impliedRivalCapShare =
      (1 - mirrored.loadCeiling / CALM.loadCeiling) / CALM.competitionLoadPenalty;
    expect(impliedRivalCapShare).toBeCloseTo(0.5, 6);
  });
});

describe('rivals spill on the same curve we do', () => {
  it('re-books traffic from a rival that is not yet full', () => {
    // Own spill became a smooth expectation while the RIVAL's stayed a hard
    // clamp, so a competitor turned nobody away until it was literally sold out.
    // At a demand factor of 1 — the median sector — it should be shedding ~14% of
    // what it wins, and it shed nothing, leaving `share.spillCapture` with almost
    // nothing to act on.
    const fleet = tails('AROSN4', 60);           // ample spare seats, so what we
    const sector = route('LON', 'PAR');          // pick up is not capped by room
    const marketOneWay = computeRouteEconomics(sector, fleet, 0, CALM).marketDemandWeekly / 2;

    // A rival sized so the old clamp saw it as comfortably NOT full.
    const e = computeRouteEconomics(sector, fleet, 0, CALM, 40, marketOneWay * 0.3);
    const wonDirectly = marketOneWay * e.demandShare;   // 'match' posture: no stimulation
    const carried = e.paxCarriedWeekly / 2;

    // Under the clamp this was 0.02% — and that residue is not absorption at all,
    // it is the censoring lift in expectedLoad, since a departure drawn below zero
    // carries nobody and pulls the mean up a hair.
    expect(carried / wonDirectly - 1).toBeGreaterThan(0.005);
  });
});

describe('belly cargo', () => {
  // Freight is the reason a real airline puts a widebody on a long thin route.
  // What makes it work is that it is CAPACITY-driven: the hold fills whether or
  // not the cabin does. A flat percentage of passenger revenue would look similar
  // on a busy sector and be wrong on exactly the sectors this exists to fix.

  it('earns on a widebody and next to nothing on a narrowbody', () => {
    const wide = econ(route('LON', 'NYC'), tails('VANTA9', 1));
    const narrow = econ(route('LON', 'NYC'), tails('AROSN3', 1));
    const share = (e: typeof wide): number => e.cargo / (e.revenue - e.cargo);
    expect(share(wide)).toBeGreaterThan(0.12);
    expect(share(narrow)).toBeLessThan(0.05);
    expect(share(wide)).toBeGreaterThan(share(narrow) * 4);
  });

  it('is a larger share of revenue the longer the sector', () => {
    // Freight revenue is linear in distance while fares are sub-linear, so the
    // cargo share climbs with stage length on its own. That is the real pattern
    // and it falls out rather than being tuned in.
    const share = (from: string, to: string): number => {
      const e = econ(route(from, to), tails('VANTA9', 1));
      return e.cargo / (e.revenue - e.cargo);
    };
    expect(share('TYO', 'NYC')).toBeGreaterThan(share('LON', 'NYC'));
    expect(share('LON', 'NYC')).toBeGreaterThan(share('LON', 'PAR'));
  });

  it('does not depend on how full the cabin is', () => {
    // The whole point. Same metal, same sector, demand collapsed: passenger
    // revenue must fall and freight must not move.
    const busy = econ(route('LON', 'NYC'), tails('VANTA9', 2), 1);
    const thin = econ(route('LON', 'NYC'), tails('VANTA9', 2), 0.25);
    expect(thin.loadFactor).toBeLessThan(busy.loadFactor);
    expect(thin.revenue - thin.cargo).toBeLessThan(busy.revenue - busy.cargo);
    expect(thin.cargo).toBeCloseTo(busy.cargo, 6);
  });

  it('is not moved by pricing posture', () => {
    // Premium takes space out of the CABIN, not out of the hold, so it must be
    // priced off base gauge. Reading posture-adjusted seats would have a premium
    // cabin quietly shrink the freight business.
    const premium = econ(route('LON', 'NYC', 'premium'), tails('VANTA9', 1));
    const undercut = econ(route('LON', 'NYC', 'undercut'), tails('VANTA9', 1));
    expect(premium.cargo).toBeCloseTo(undercut.cargo, 6);
  });

  it('counts inside the revenue every margin is taken against', () => {
    const e = econ(route('LON', 'NYC'), tails('VANTA9', 1));
    expect(e.cargo).toBeGreaterThan(0);
    expect(e.revenue).toBeGreaterThan(e.cargo);
    expect(e.netCash).toBeCloseTo(
      e.revenue - e.fuel - e.crew - e.maintenance - e.handling - e.lease - e.standing -
        e.fixed - e.overhead, 6);
  });

  it('still lets a sector be over-flown into a loss', () => {
    // Freight must not become a reason to pile on metal for ever. Cargo alone
    // cannot cover an aircraft, so the marginal aircraft still has to fill seats.
    const nets = [1, 4, 8, 16, 24].map((n) => econ(route('TYO', 'NYC'), tails('AROSW5', n)).netCash);
    expect(Math.max(...nets)).toBeGreaterThan(0);
    expect(nets[nets.length - 1]!).toBeLessThan(0);
  });
});

describe('a route in the state is not the same thing as a route being flown', () => {
  it('leaves an opened sector out of the market index until metal arrives', () => {
    // The map reads `state.routes` and the market board reads the market index,
    // and the two are NOT the same set. An ordered aircraft is not on the market
    // until it is delivered — the index enforces that, deliberately — so a sector
    // opened this quarter sits in `state.routes` with no presence underneath it.
    // Drawn identically to a served route, that reads as a carrier flying a line
    // with nobody on it. Measured at 6.6% of drawn route-quarters before the map
    // learned to tell them apart, almost all of it undelivered metal.
    let game = newGame(7, 'LON');
    game = applyAction(game, {
      type: 'ACQUIRE_AIRCRAFT', carrierId: 'player', typeId: 'AROSW3', ownership: 'leased',
    }).state;
    game = applyAction(game, {
      type: 'OPEN_ROUTE', carrierId: 'player', from: 'LON', to: 'NYC',
    }).state;
    const me = getCarrier(game, 'player');
    const tail = me.fleet[0]!;
    game = applyAction(game, {
      type: 'ASSIGN_AIRCRAFT', carrierId: 'player', tailId: tail.id, routeId: game.routes[0]!.id,
    }).state;

    // Assigned, but a widebody takes quarters to arrive.
    expect(game.turn).toBeLessThan(getCarrier(game, 'player').fleet[0]!.deliversTurn);
    const before = buildMarketIndex(game);
    expect(game.routes).toHaveLength(1);
    expect(before.get(marketKey('LON', 'NYC')) ?? []).toHaveLength(0);

    // Once it lands, the same route appears — the route did not change, the metal did.
    while (game.turn < getCarrier(game, 'player').fleet[0]!.deliversTurn) game = endTurn(game);
    const after = buildMarketIndex(game);
    expect(after.get(marketKey('LON', 'NYC')) ?? []).toHaveLength(1);
  });
});

describe('the pricing dial', () => {
  const ORDER: readonly PricingPosture[] = ['skim', 'premium', 'match', 'undercut', 'stimulate'];

  it('is monotonic on every axis, dearest to cheapest', () => {
    // A posture is a set of four numbers that only make sense together. If any one
    // of them stops moving in step, a middle notch becomes strictly worse than its
    // neighbours on both sides and quietly turns into dead content.
    const axes = ['fare', 'seats', 'attractiveness', 'paxCost'] as const;
    for (const axis of axes) {
      const table = CONSTANTS.posture[axis] as Record<string, number>;
      const values = ORDER.map((p) => table[p]!);
      const rising = values.every((v, i) => i === 0 || v >= values[i - 1]!);
      const falling = values.every((v, i) => i === 0 || v <= values[i - 1]!);
      expect(rising || falling, `${axis}: ${values.join(' -> ')}`).toBe(true);
    }
  });

  it('prices every notch off the same anchor, contested or not', () => {
    // Posture has never meant "relative to a rival" — it multiplies the fare the
    // sector itself will bear, from distance and the two cities' economic weight.
    // That is why the labels mean the same thing on a monopoly as in a dogfight,
    // and why undercut can never come out above a rival's fare.
    const lon = getCity('LON');
    const nyc = getCity('NYC');
    const fares = ORDER.map((p) => fareOneWay(lon, nyc, p));
    for (let i = 1; i < fares.length; i++) expect(fares[i]!).toBeLessThan(fares[i - 1]!);
    // And the ratios are exactly the posture table — nothing about rivals leaks in.
    const table = CONSTANTS.posture.fare as Record<string, number>;
    for (const p of ORDER) {
      expect(fareOneWay(lon, nyc, p) / fareOneWay(lon, nyc, 'match'))
        .toBeCloseTo(table[p]! / table['match']!, 9);
    }
  });

  it('gives a spilling monopoly somewhere above Premium to go', () => {
    // The exhibit: a sector turning away more than it carries at the old ceiling.
    // With three notches there was no answer to that at all — Premium WAS the top,
    // so the dial had nothing to say to the most obvious situation in the game.
    const sector = route('NYC', 'BJS');
    const fleet = tails('VANTA8', 3);
    const atPremium = econ({ ...sector, posture: 'premium' }, fleet);
    expect(atPremium.spilledWeekly).toBeGreaterThan(0);
    const atSkim = econ({ ...sector, posture: 'skim' }, fleet);
    expect(atSkim.fareOneWay).toBeGreaterThan(atPremium.fareOneWay);
    expect(atSkim.spilledWeekly).toBeLessThan(atPremium.spilledWeekly);
    expect(atSkim.netCash).toBeGreaterThan(atPremium.netCash);
  });
});

describe('an entrant is invisible to the share table, and must not be invisible to the player', () => {
  it('leaves a rival with undelivered metal off the market board', () => {
    // This is correct: a carrier takes no traffic until it flies, so it cannot be
    // in a share split. But the sector panel read that as "you have it to
    // yourself" while the map drew their announced sector as a dashed line —
    // measured at 3.5% of route-quarters. The panel now names them separately.
    let game = newGame(3, 'LON');
    const rivalId = 'R';
    const me = getCarrier(game, 'player');
    const rival: Carrier = {
      ...me, id: rivalId, name: 'Meridian Airways', isPlayer: false, archetypeId: 'legacy',
      holdings: {}, fleet: [{
        id: 'RT1', typeId: 'AROSW3', ownership: 'leased',
        acquiredTurn: 0, deliversTurn: 4, bookValue: 0, routeId: 'rr',
      }],
    };
    game = {
      ...game,
      carriers: [...game.carriers, rival],
      routes: [
        { id: 'mine', carrierId: 'player', from: 'LON', to: 'NYC', posture: 'match', openedTurn: 0 },
        { id: 'rr', carrierId: rivalId, from: 'LON', to: 'NYC', posture: 'match', openedTurn: 0 },
      ],
    };
    const index = buildMarketIndex(game);
    const present = index.get(marketKey('LON', 'NYC')) ?? [];
    expect(present.some((p) => p.carrierId === rivalId), 'undelivered metal takes no share')
      .toBe(false);
    // ...but the route is unmistakably there in the state, which is what the
    // panel now reads to name them.
    expect(game.routes.some((r) => r.carrierId === rivalId && marketKey(r.from, r.to) === marketKey('LON', 'NYC')))
      .toBe(true);
  });
});

/**
 * Station overhead is an ALLOCATION, not a new charge invented per sector. The
 * whole mechanic rests on that: if the split quietly created or destroyed money
 * depending on network shape, then "putting more sectors through one station is
 * cheaper" would be an artefact of the accounting rather than a real economy of
 * density, and the P&L would stop tying out.
 */
describe('station overhead allocates exactly', () => {
  const cost = CONSTANTS.routes.stationQuarterlyCost;
  const route = (id: string, from: string, to: string) =>
    ({ id, carrierId: 'c', from, to, posture: 'match' as const, openedTurn: 0 });

  /** Sum of what every sector is charged, against cost x stations operated. */
  const totalCharged = (routes: ReturnType<typeof route>[]): number =>
    routes.reduce((sum, r) => sum + stationOverheadFor(routes, 'c', r.from, r.to, true), 0);

  const stations = (routes: ReturnType<typeof route>[]): number =>
    new Set(routes.flatMap((r) => [r.from, r.to])).size;

  it('charges the network exactly once per station, whatever the shape', () => {
    const shapes = {
      'single sector': [route('a', 'LON', 'NYC')],
      'hub and spoke': [route('a', 'LON', 'NYC'), route('b', 'LON', 'PAR'), route('c', 'LON', 'MAD')],
      'a line': [route('a', 'LON', 'NYC'), route('b', 'NYC', 'LAX'), route('c', 'LAX', 'SYD')],
      'scattered': [route('a', 'LON', 'NYC'), route('b', 'PAR', 'MAD'), route('c', 'TYO', 'SYD')],
      'a triangle': [route('a', 'LON', 'NYC'), route('b', 'NYC', 'PAR'), route('c', 'PAR', 'LON')],
    };
    for (const [name, routes] of Object.entries(shapes)) {
      expect(totalCharged(routes), `${name} does not tie out`).toBeCloseTo(cost * stations(routes), 6);
    }
  });

  it('makes density cheaper per sector without changing the total', () => {
    const thin = [route('a', 'LON', 'NYC')];
    const dense = [route('a', 'LON', 'NYC'), route('b', 'LON', 'PAR'), route('c', 'LON', 'MAD')];
    const perSectorThin = stationOverheadFor(thin, 'c', 'LON', 'NYC', true);
    const perSectorDense = stationOverheadFor(dense, 'c', 'LON', 'NYC', true);
    // The London end is now split three ways; New York is still carried alone.
    expect(perSectorDense).toBeLessThan(perSectorThin);
    expect(perSectorDense).toBeCloseTo(cost / 3 + cost, 6);
    expect(perSectorThin).toBeCloseTo(cost + cost, 6);
  });

  it('counts a sector that does not exist yet into its own denominator', () => {
    // What `bestNewSector` probes with: the prospective route is not in the list,
    // so it has to count itself, or a virgin station reads as free.
    const existing = [route('a', 'LON', 'NYC')];
    const probed = stationOverheadFor(existing, 'c', 'LON', 'MAD', false);
    // London would then carry two sectors, Madrid one.
    expect(probed).toBeCloseTo(cost / 2 + cost, 6);
    // And it must equal what the sector is charged once it actually exists.
    const after = [...existing, route('b', 'LON', 'MAD')];
    expect(probed).toBeCloseTo(stationOverheadFor(after, 'c', 'LON', 'MAD', true), 6);
  });

  it('ignores other carriers entirely', () => {
    const mine = [route('a', 'LON', 'NYC')];
    const shared = [...mine, { ...route('x', 'LON', 'PAR'), carrierId: 'other' }];
    expect(stationOverheadFor(shared, 'c', 'LON', 'NYC', true))
      .toBeCloseTo(stationOverheadFor(mine, 'c', 'LON', 'NYC', true), 6);
  });
});

/**
 * The two panels that price the same sector must print the same number.
 *
 * The sector dossier computes its own P&L; the "on this market" table beside it
 * gets its figures from `marketBoard`. They are separate call sites assembling the
 * same arguments by hand, and when `stationOverhead` was added only one of them was
 * updated — so the header read $4.1M and the table read $5.0M for the identical
 * route, a difference that was exactly the omitted station line plus the overhead
 * riding on it. Nothing in the types catches that; this does.
 */
describe('the market table and the sector P&L agree', () => {
  it('prices the same sector identically through both paths', () => {
    let state = newGame(31, 'LON', undefined, { difficulty: 'medium', scenario: 'present' });
    let compared = 0;

    for (let turn = 0; turn < 30 && !state.gameOver; turn++) {
      state = endTurn(state);
      const index = buildMarketIndex(state);

      for (const route of state.routes) {
        const carrier = state.carriers.find((c) => c.id === route.carrierId);
        if (!carrier || carrier.bankruptTurn !== null) continue;
        const assigned = assignedTo(carrier, route.id);
        if (assigned.length === 0) continue;

        // What the dossier draws.
        const dossier = computeRouteEconomics(
          route, assigned, state.turn,
          conditionsFor(state, carrier, route, klassesOf(assigned)),
          rivalsOf(index, route), rivalCapacityOf(index, route),
          feedFactor(state.routes, carrier.id, route.from, route.to, route.id),
          stationOverheadFor(state.routes, carrier.id, route.from, route.to, true),
        );

        // What the table beside it draws for the same row.
        const row = marketBoard(state, index, route).find((r) => r.routeId === route.id);
        if (!row) continue;

        expect(row.econ.netCash).toBeCloseTo(dossier.netCash, 6);
        expect(row.econ.fixed).toBeCloseTo(dossier.fixed, 6);
        compared += 1;
      }
    }

    expect(compared).toBeGreaterThan(100);
  });
});
