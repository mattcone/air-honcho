/**
 * Events, the fuel walk, hedging and the technology tree.
 *
 * The point of Phase 3 is variance that a competent operator cannot simply
 * sidestep, so the tests that matter are the ones about whether a shock reaches
 * a sold-out sector at all.
 */
import { describe, expect, it } from 'vitest';
import { applyAction, endTurn, getCarrier, newGame } from '../src/sim/engine.ts';
import { Rng } from '../src/sim/rng.ts';
import { CONSTANTS, getCity } from '../src/sim/world.ts';
import { seasonalDemandFactor } from '../src/sim/demand.ts';
import { EVENTS, drawEvent, eventGroup, getEvent, pruneEffects, rollCompletion, rollEffectsForTest, walkFuelPrice } from '../src/sim/events.ts';
import { TECH_NODES, delivered, getTechNode, landDeliveries, techStatus } from '../src/sim/tech.ts';
import {
  NEUTRAL, conditionsFor, effectiveFuelPrice, fuelSurcharge, marketFuelPrice,
} from '../src/sim/conditions.ts';
import type { Carrier, City } from '../src/sim/types.ts';
import { computeRouteEconomics } from '../src/sim/economics.ts';
import type { Aircraft, GameState, Route } from '../src/sim/types.ts';

const route: Route = { id: 'r', carrierId: 'player', from: 'SIN', to: 'HKG', posture: 'match', openedTurn: 0 };
const tails = (n: number): Aircraft[] =>
  Array.from({ length: n }, (_, i) => ({
    id: `AC-${i}`, typeId: 'AROSN3', ownership: 'leased' as const,
    acquiredTurn: 0, deliversTurn: 0, bookValue: 0, routeId: 'r',
  }));

describe('the fuel walk', () => {
  it('stays inside its bounds however long it runs', () => {
    const rng = Rng.fromSeed(3);
    let price = CONSTANTS.game.startingFuelPricePerL;
    for (let i = 0; i < 5000; i++) {
      price = walkFuelPrice(price, rng);
      expect(Number.isFinite(price)).toBe(true);
      expect(price).toBeGreaterThanOrEqual(CONSTANTS.events.fuelPriceMin);
      expect(price).toBeLessThanOrEqual(CONSTANTS.events.fuelPriceMax);
    }
  });

  it('reverts toward its long-run level rather than wandering off', () => {
    // A plain random walk would eventually sit at one of the bounds. Over a long
    // run the average has to stay near where it started.
    const rng = Rng.fromSeed(11);
    let price = CONSTANTS.game.startingFuelPricePerL;
    let sum = 0;
    const n = 4000;
    for (let i = 0; i < n; i++) {
      price = walkFuelPrice(price, rng);
      sum += price;
    }
    const mean = sum / n;
    const target = CONSTANTS.game.startingFuelPricePerL;
    expect(mean).toBeGreaterThan(target * 0.75);
    expect(mean).toBeLessThan(target * 1.25);
  });

  it('actually moves — it is the main source of variance', () => {
    const rng = Rng.fromSeed(5);
    let price = CONSTANTS.game.startingFuelPricePerL;
    const seen: number[] = [];
    for (let i = 0; i < 400; i++) { price = walkFuelPrice(price, rng); seen.push(price); }
    expect(Math.max(...seen) / Math.min(...seen)).toBeGreaterThan(2);
  });
});

describe('fuel surcharges', () => {
  it('lets fares recover part of a fuel move, never all of it', () => {
    const base = CONSTANTS.game.startingFuelPricePerL;
    expect(fuelSurcharge(base)).toBeCloseTo(1, 9);
    const doubled = fuelSurcharge(base * 2);
    expect(doubled).toBeGreaterThan(1);
    expect(doubled).toBeLessThan(2); // a spike still hurts
  });

  it('falls when fuel is cheap, so a glut is not pure profit', () => {
    expect(fuelSurcharge(CONSTANTS.game.startingFuelPricePerL * 0.5)).toBeLessThan(1);
  });
});

describe('hedging', () => {
  const hedged = (state: GameState, fraction: number) =>
    applyAction(state, { type: 'HEDGE_FUEL', carrierId: 'player', fraction });

  it('blends the locked price with spot', () => {
    const state = newGame(1, 'LON');
    const after = hedged(state, 0.5);
    expect(after.ok).toBe(true);
    const s = after.state;
    const me = getCarrier(s, 'player');
    expect(effectiveFuelPrice(s, me)).toBeCloseTo(0.5 * me.hedge!.pricePerL + 0.5 * s.fuelPrice, 6);
  });

  it('shelters its share from an oil spike, not just from the walk', () => {
    // The event multiplier has to be applied to the market price BEFORE the
    // hedge is blended in. Applying it afterwards multiplies the locked share
    // too, which quietly makes a hedge useless against exactly the shock it is
    // bought for.
    const base = hedged(newGame(7, 'LON'), 0.8).state;
    const spiked: GameState = {
      ...base,
      events: [{ source: 'oil-spike', kind: 'event', until: 99, effects: { fuelPrice: 1.55 } }],
    };
    const unhedged: GameState = {
      ...spiked,
      carriers: spiked.carriers.map((c) => ({ ...c, hedge: null })),
    };
    expect(effectiveFuelPrice(spiked, getCarrier(spiked, 'player'))).toBeLessThan(
      effectiveFuelPrice(unhedged, getCarrier(unhedged, 'player')) * 0.95,
    );
  });

  it('quotes a market price that includes any fuel event', () => {
    const state: GameState = {
      ...newGame(1, 'LON'),
      events: [{ source: 'oil-spike', kind: 'event', until: 99, effects: { fuelPrice: 1.55 } }],
    };
    expect(marketFuelPrice(state)).toBeCloseTo(state.fuelPrice * 1.55, 9);
  });

  it('costs a premium over spot, so it is insurance and not a free bet', () => {
    const s = hedged(newGame(1, 'LON'), 0.5).state;
    expect(getCarrier(s, 'player').hedge!.pricePerL).toBeGreaterThan(s.fuelPrice);
  });

  it('refuses a second hedge while one is running, and silly fractions', () => {
    const s = hedged(newGame(1, 'LON'), 0.5).state;
    expect(hedged(s, 0.5).ok).toBe(false);
    expect(hedged(newGame(1, 'LON'), 0).ok).toBe(false);
    expect(hedged(newGame(1, 'LON'), 1).ok).toBe(false);
  });

  it('lapses when its term is up', () => {
    let s = hedged(newGame(1, 'LON'), 0.5).state;
    for (let i = 0; i < CONSTANTS.events.hedgeQuarters; i++) s = endTurn(s);
    // Compared against the market price, not the bare walk: an oil event may be
    // running by now and that is part of what the market charges.
    expect(effectiveFuelPrice(s, getCarrier(s, 'player'))).toBeCloseTo(marketFuelPrice(s), 9);
  });
});

describe('the event deck', () => {
  it('is data, with every card well formed', () => {
    expect(EVENTS.length).toBeGreaterThanOrEqual(12);
    for (const card of EVENTS) {
      // A weight-0 card is scripted-only (it fires on the historical schedule,
      // never the random deck); everything else must have a real weight.
      expect(card.weight, card.id).toBeGreaterThanOrEqual(0);
      if (card.weight === 0) expect(card.crisis ?? false, `${card.id} weight 0 but not scripted`).toBe(true);
      expect(card.maxDuration, card.id).toBeGreaterThanOrEqual(card.minDuration);
      // A card has to DO something, but it may declare its effects as fixed values,
      // as rolled ranges, or a mix — a chaos card keeps its whole bite in the range.
      const fixed = Object.entries(card.effects);
      const ranged = Object.entries(card.effectRange ?? {});
      expect(fixed.length + ranged.length, `${card.id} has no effects at all`).toBeGreaterThan(0);
      for (const [key, value] of fixed) {
        expect(key in NEUTRAL, `${card.id}: unknown effect ${key}`).toBe(true);
        expect(value, `${card.id}.${key}`).toBeGreaterThan(0);
      }
      for (const [key, span] of ranged) {
        expect(key in NEUTRAL, `${card.id}: unknown ranged effect ${key}`).toBe(true);
        expect(span.length, `${card.id}.${key} is not a [min, max]`).toBe(2);
        expect(span[0], `${card.id}.${key} min`).toBeGreaterThan(0);
        // A range that is not a range is a fixed effect wearing a costume, and the
        // whole point of these cards is that the same headline bites differently.
        expect(span[1], `${card.id}.${key} does not actually vary`).toBeGreaterThan(span[0]!);
        expect(card.effects[key], `${card.id}.${key} is both fixed and ranged`).toBeUndefined();
      }
    }
  });

  it('is not a systematic tax dressed up as variance', () => {
    // An 80/20 bad deck is a permanent drag, not a source of uncertainty.
    const bad = EVENTS.filter((e) => e.tone === 'bad').reduce((s, e) => s + e.weight, 0);
    const good = EVENTS.filter((e) => e.tone === 'good').reduce((s, e) => s + e.weight, 0);
    expect(good / (good + bad)).toBeGreaterThan(0.3);
    expect(good / (good + bad)).toBeLessThan(0.7);
  });

  it('never runs the same card twice at once', () => {
    let state: GameState = { ...newGame(2, 'LON'), turn: 40 };
    const rng = Rng.fromSeed(9);
    for (let i = 0; i < 300; i++) {
      const drawn = drawEvent(state, rng);
      if (drawn) state = { ...state, events: [...state.events, drawn] };
      const ids = state.events.map((e) => e.source);
      expect(new Set(ids).size).toBe(ids.length);
      state = { ...state, turn: state.turn + 1, events: pruneEffects(state.events, state.turn + 1) };
    }
  });

  // The mutually-exclusive poles of one market condition each.
  const CONTRADICTORY_PAIRS: ReadonlyArray<readonly [string, string]> = [
    ['oil-spike', 'oil-glut'],
    ['boom', 'recession'],
    ['capacity-discipline', 'fare-war'],
  ];

  it('groups every contradictory pair on a shared axis', () => {
    for (const [a, b] of CONTRADICTORY_PAIRS) {
      expect(eventGroup(a), a).toBeDefined();
      expect(eventGroup(a), `${a}/${b}`).toBe(eventGroup(b));
    }
  });

  it('does not open a card whose axis is already live — no oil glut during a spike', () => {
    for (const [live, forbidden] of CONTRADICTORY_PAIRS) {
      const state: GameState = {
        ...newGame(3, 'LON'),
        turn: 40,
        events: [{ source: live, kind: 'event', until: 100, effects: getEvent(live).effects }],
      };
      let drewSomethingElse = false;
      for (let s = 0; s < 500; s++) {
        const drawn = drawEvent(state, Rng.fromSeed(s));
        if (!drawn) continue;
        expect(drawn.source, `${forbidden} opened during ${live}`).not.toBe(forbidden);
        if (drawn.source !== live) drewSomethingElse = true;
      }
      // The axis is closed, but the rest of the deck is not — this isn't a dead board.
      expect(drewSomethingElse, `no non-conflicting card ever drew while ${live} ran`).toBe(true);
    }
  });

  it('lets a scripted historical beat clear a lingering random event on its axis', () => {
    // 2008 Q2 scripts an oil spike; a random glut still running must yield to it.
    // The turn is DERIVED: hardcoding it pinned the arithmetic of a 2000 start, and
    // the same number became 2003 — a different beat entirely — when the start moved.
    const qpy = CONSTANTS.game.quartersPerYear;
    const spike = (2008 - CONSTANTS.scenarios.history.startYear) * qpy + (2 - 1);
    const hist = newGame(5, 'LON', undefined, { scenario: 'history' });
    const glut = {
      source: 'oil-glut', kind: 'event' as const, until: spike + 7,
      effects: getEvent('oil-glut').effects,
    };
    const after = endTurn({ ...hist, turn: spike - 1, events: [glut] });
    expect(after.turn).toBe(spike);
    const sources = after.events.map((e) => e.source);
    expect(sources).toContain('oil-spike'); // the scripted beat fired
    expect(sources).not.toContain('oil-glut'); // and cleared the contradiction
  });

  it('expires effects when their run ends', () => {
    const effects = [
      { source: 'a', kind: 'event' as const, until: 5, effects: {} },
      { source: 'b', kind: 'event' as const, until: 9, effects: {} },
    ];
    expect(pruneEffects(effects, 4).map((e) => e.source)).toEqual(['a', 'b']);
    expect(pruneEffects(effects, 5).map((e) => e.source)).toEqual(['b']);
  });
});

describe('shocks reach a sold-out sector', () => {
  /** The sector is capacity-constrained: it turns traffic away every quarter. */
  const soldOut = () => computeRouteEconomics(route, tails(3), 0, { ...NEUTRAL, fuelPrice: 0.8 });

  it('confirms the sector really is spilling', () => {
    // Spill is the thing being asserted, so assert spill. Under the Boeing spill
    // model a sector turning traffic away does NOT read at the ceiling — variance
    // between departures means some go out with rows empty even when the average
    // demand exceeds the aeroplane. Load lands in the low 80s, spill is positive.
    const e = soldOut();
    expect(e.spilledWeekly).toBeGreaterThan(0);
    expect(e.loadFactor).toBeGreaterThan(0.75);
  });

  it('now feels a demand shock slightly, because spill re-books instead of vanishing', () => {
    /*
     * This used to assert the revenue was IDENTICAL under a 10% demand shock: a
     * sold-out sector simply spilled less, and the deck was designed around that
     * trap (DECISIONS.md). Redistributing spill (P1) changes it — a shock thins
     * the overflow a carrier can pick up from its rivals, so a little of it now
     * reaches even a full sector.
     *
     * Still small, and the point the original test defends still stands: a demand
     * shock is a weak instrument against a sold-out route compared with one that
     * removes seats or adds cost. Pinned as a band so it cannot silently go back
     * to exactly zero, or grow into the dominant effect.
     */
    const base = soldOut().revenue;
    const shocked = computeRouteEconomics(
      route, tails(3), 0, { ...NEUTRAL, fuelPrice: 0.8, demand: 0.9 },
    );
    expect(shocked.revenue).toBeLessThan(base);
    expect(shocked.revenue).toBeGreaterThan(base * 0.97);
  });

  it('feels a cancellation immediately, because that removes seats', () => {
    const grounded = computeRouteEconomics(
      route, tails(3), 0, { ...NEUTRAL, fuelPrice: 0.8, completion: 0.8 },
    );
    expect(grounded.capacityWeekly).toBeLessThan(soldOut().capacityWeekly);
    expect(grounded.revenue).toBeLessThan(soldOut().revenue * 0.95);
  });

  it('feels a fuel spike immediately, because that is a cost', () => {
    const spiked = computeRouteEconomics(route, tails(3), 0, { ...NEUTRAL, fuelPrice: 1.6 });
    expect(spiked.fuel).toBeGreaterThan(soldOut().fuel * 1.5);
    expect(spiked.netCash).toBeLessThan(soldOut().netCash);
  });
});

describe('completion', () => {
  it('stays a sane fraction', () => {
    const rng = Rng.fromSeed(7);
    for (let i = 0; i < 3000; i++) {
      const c = rollCompletion(rng);
      expect(c).toBeGreaterThanOrEqual(CONSTANTS.events.completionFloor);
      expect(c).toBeLessThanOrEqual(1);
    }
  });

  it('varies quarter to quarter', () => {
    const rng = Rng.fromSeed(8);
    const seen = new Set(Array.from({ length: 50 }, () => rollCompletion(rng).toFixed(4)));
    expect(seen.size).toBeGreaterThan(20);
  });
});

describe('the technology tree', () => {
  it('is a tree, not a shopping list', () => {
    expect(TECH_NODES.length).toBeGreaterThanOrEqual(10);
    const gated = TECH_NODES.filter((n) => n.requires !== null);
    expect(gated.length).toBeGreaterThan(0);
    for (const node of TECH_NODES) {
      expect(node.cost, node.id).toBeGreaterThan(0);
      expect(node.quarters, node.id).toBeGreaterThan(0);
      for (const key of Object.keys(node.effects)) {
        expect(key in NEUTRAL, `${node.id}: unknown effect ${key}`).toBe(true);
      }
    }
  });

  it('is worth a real margin improvement without being a different game', () => {
    // At double these values a fully-teched carrier could not lose.
    const total: Record<string, number> = {};
    for (const node of TECH_NODES) {
      for (const [k, v] of Object.entries(node.effects)) total[k] = (total[k] ?? 1) * v;
    }
    expect(total['fare']!).toBeGreaterThan(1.03);
    expect(total['fare']!).toBeLessThan(1.25);
    expect(total['fuelPrice']!).toBeGreaterThan(0.8);
  });

  it('will not fund a locked node, or one already bought', () => {
    const state = newGame(1, 'LON');
    const gated = TECH_NODES.find((n) => n.requires !== null)!;
    expect(applyAction(state, { type: 'START_TECH', carrierId: 'player', nodeId: gated.id }).ok).toBe(false);

    const open = TECH_NODES.find((n) => n.requires === null)!;
    const funded = applyAction(state, { type: 'START_TECH', carrierId: 'player', nodeId: open.id });
    expect(funded.ok).toBe(true);
    expect(applyAction(funded.state, { type: 'START_TECH', carrierId: 'player', nodeId: open.id }).ok).toBe(false);
  });

  it('charges up front and delivers later, permanently', () => {
    const state = newGame(1, 'LON');
    const node = getTechNode('direct-booking');
    const cashBefore = getCarrier(state, 'player').cash;
    let s = applyAction(state, { type: 'START_TECH', carrierId: 'player', nodeId: node.id }).state;
    expect(getCarrier(s, 'player').cash).toBe(cashBefore - node.cost);
    expect(techStatus(getCarrier(s, 'player'), node)).toBe('in-progress');

    for (let i = 0; i < node.quarters; i++) s = endTurn(s);
    expect(techStatus(getCarrier(s, 'player'), node)).toBe('delivered');
    expect(delivered(getCarrier(s, 'player')).has(node.id)).toBe(true);

    // Permanent: still in force a long time later.
    for (let i = 0; i < 40; i++) s = endTurn(s);
    expect(delivered(getCarrier(s, 'player')).has(node.id)).toBe(true);
  });

  it('lands only what is due', () => {
    const carrier = {
      ...getCarrier(newGame(1, 'LON'), 'player'),
      techInProgress: [
        { nodeId: 'direct-booking', completesTurn: 5 },
        { nodeId: 'fuel-efficiency', completesTurn: 9 },
      ],
    } as Carrier;
    const after = landDeliveries(carrier, 5);
    expect(after.tech).toEqual(['direct-booking']);
    expect(after.techInProgress.map((t) => t.nodeId)).toEqual(['fuel-efficiency']);
  });

  it('belongs to the carrier that paid for it, not to the world', () => {
    // A rival funding a program must not deliver it to the player, and the
    // player paying for one must not hand it to every rival.
    const state = newGame(1, 'LON');
    const node = getTechNode('direct-booking');
    let s = applyAction(state, { type: 'START_TECH', carrierId: 'player', nodeId: node.id }).state;
    for (let i = 0; i < node.quarters + 1; i++) s = endTurn(s);

    expect(getCarrier(s, 'player').tech).toContain(node.id);
    for (const rival of s.carriers.filter((c) => !c.isPlayer)) {
      expect(rival.tech, `${rival.name} got the player's technology`).not.toContain(node.id);
    }
  });
});

describe('effect scoping', () => {
  const withEffect = (effects: Record<string, number>, scope?: object): GameState => ({
    ...newGame(1, 'LON'),
    events: [{ source: 'x', kind: 'event', until: 99, effects, ...(scope ? { scope } : {}) }],
  });
  const me = (s: GameState) => getCarrier(s, s.playerCarrierId);

  it('applies a region-scoped event only to sectors touching it', () => {
    const state = withEffect({ completion: 0.5 }, { regions: ['EU'] });
    const euRoute: Route = { ...route, from: 'LON', to: 'FRA' };
    const asiaRoute: Route = { ...route, from: 'SIN', to: 'HKG' };
    expect(conditionsFor(state, me(state), euRoute, new Set()).completion).toBeLessThan(
      conditionsFor(state, me(state), asiaRoute, new Set()).completion,
    );
  });

  it('applies a type grounding only to sectors flown by that class', () => {
    const state = withEffect({ completion: 0.2 }, { aircraftKlass: 'Widebody' });
    expect(conditionsFor(state, me(state), route, new Set(['Widebody'])).completion).toBeLessThan(
      conditionsFor(state, me(state), route, new Set(['Narrowbody'])).completion,
    );
  });

  it('compounds two effects multiplicatively', () => {
    const state: GameState = {
      ...newGame(1, 'LON'),
      baseCompletion: 1,
      events: [
        { source: 'a', kind: 'event', until: 99, effects: { completion: 0.5 } },
        { source: 'b', kind: 'event', until: 99, effects: { completion: 0.5 } },
      ],
    };
    expect(conditionsFor(state, me(state), route, new Set()).completion).toBeCloseTo(0.25, 9);
  });
});

describe('how full a carrier can fly is not a constant', () => {
  const route: Route = { id: 'r', carrierId: 'player', from: 'NYC', to: 'LON', posture: 'match', openedTurn: 0 };
  const wide = (n: number): Aircraft[] =>
    Array.from({ length: n }, (_, i) => ({
      id: `AC-${i}`, typeId: 'VANTA8', ownership: 'leased' as const,
      acquiredTurn: 0, deliversTurn: 0, bookValue: 0, routeId: 'r',
    }));
  const at = (ceiling: number) =>
    computeRouteEconomics(route, wide(1), 0, { ...NEUTRAL, fuelPrice: 0.8, loadCeiling: ceiling });

  it('keeps a sold-out sector well short of 100%, and short of the ceiling too', () => {
    /*
     * Was `toBeCloseTo(0.88)` — load pinned exactly to the ceiling constant, which
     * is the behaviour docs/demand-audit.md identified as the reason load factor
     * carried no information. Under the spill model the ceiling is an upper bound
     * that demand variance keeps you off: a sold-out sector settles a few points
     * below it, which is why a real network averages 82-84% rather than its
     * ceiling. Both bounds are asserted so this cannot drift back to a clamp.
     */
    const e = at(0.88);
    expect(e.loadFactor).toBeLessThan(0.88);
    expect(e.loadFactor).toBeGreaterThan(0.75);
    expect(e.spilledWeekly).toBeGreaterThan(0);
  });

  it('lets a better-run carrier fill more of the same aircraft', () => {
    const plain = at(0.88);
    const sharp = at(0.93);
    expect(sharp.loadFactor).toBeGreaterThan(plain.loadFactor);
    expect(sharp.revenue).toBeGreaterThan(plain.revenue);
    expect(sharp.spilledWeekly).toBeLessThan(plain.spilledWeekly);
  });

  it('is raised by the technology that plausibly raises it', () => {
    const raisers = TECH_NODES.filter((n) => n.effects['loadCeiling'] !== undefined);
    expect(raisers.length).toBeGreaterThan(0);
    for (const node of raisers) expect(node.effects['loadCeiling']!).toBeGreaterThan(1);
    // Revenue management is the canonical one; it should be in there.
    expect(raisers.map((n) => n.id)).toContain('revenue-management');
  });

  it('never lets anyone sell the last seat on every departure', () => {
    const absurd = at(5);
    expect(absurd.loadFactor).toBeLessThanOrEqual(1);
  });

  it('is clamped to the hard cap however much is stacked on it', () => {
    const state: GameState = {
      ...newGame(1, 'LON'),
      events: [{ source: 'x', kind: 'event', until: 99, effects: { loadCeiling: 3 } }],
    };
    const c = conditionsFor(state, getCarrier(state, 'player'), route, new Set());
    expect(c.loadCeiling).toBeLessThanOrEqual(CONSTANTS.demand.loadCeilingMax);
  });

  it('reports what it had to turn away', () => {
    const e = at(0.88);
    const won = e.marketDemandWeekly * e.demandShare;
    expect(e.spilledWeekly).toBeCloseTo(won - e.paxCarriedWeekly, 4);
  });
});

describe('demand has a season', () => {
  const CONSTANTS_SEASON = CONSTANTS.demand.seasonality;
  const city = (lat: number): City => ({
    id: 'X',
    name: 'X',
    country: 'X',
    region: 'EU',
    lat,
    lon: 0,
    pop: 5,
    weight: 1,
  });

  it('averages to exactly 1 over the year, so the world is not quietly richer', () => {
    // If the index does not average to 1 it changes the LEVEL of demand as well
    // as its shape, and every calibration anchored to real unit economics moves.
    const sum = CONSTANTS_SEASON.index.reduce((a, b) => a + b, 0);
    expect(sum / CONSTANTS_SEASON.index.length).toBeCloseTo(1, 10);
  });

  it('is flat at the equator and pronounced at high latitude', () => {
    const tropical = [0, 1, 2, 3].map((t) => seasonalDemandFactor(city(1), city(1), t));
    for (const f of tropical) expect(f).toBeCloseTo(1, 10);

    const northern = [0, 1, 2, 3].map((t) => seasonalDemandFactor(city(55), city(55), t));
    expect(Math.max(...northern) / Math.min(...northern)).toBeGreaterThan(1.3);
  });

  it('puts the two hemispheres out of phase', () => {
    // Q3 is northern summer and southern winter. A carrier flying Oslo should be
    // having its best quarter exactly when one flying Auckland has its worst.
    const north = seasonalDemandFactor(city(60), city(60), 2);
    const south = seasonalDemandFactor(city(-60), city(-60), 2);
    expect(north).toBeGreaterThan(1);
    expect(south).toBeLessThan(1);
  });

  it('flattens a sector that spans the equator, because the seasons cancel', () => {
    const swing = (a: number, b: number): number => {
      const year = [0, 1, 2, 3].map((t) => seasonalDemandFactor(city(a), city(b), t));
      return Math.max(...year) - Math.min(...year);
    };
    expect(swing(55, -35)).toBeLessThan(swing(55, 55));
  });

  it('reaches settlement but not route appraisal', () => {
    // Carriers must plan on annual economics and then live through the actual
    // season. If seasonality leaked into conditionsFor, every AI would expand
    // each summer and prune the same routes each winter.
    let state = newGame(9, 'LON');
    state = applyAction(state, {
      type: 'OPEN_ROUTE', carrierId: 'player', from: 'LON', to: 'NYC',
    }).state;
    const carrier = getCarrier(state, 'player');
    const route = state.routes[0]!;
    const q1 = conditionsFor(state, carrier, route, new Set());
    const summer = { ...state, turn: state.turn + 2 };
    const q3 = conditionsFor(summer, carrier, route, new Set());
    expect(q3.demand).toBeCloseTo(q1.demand, 10);
    expect(seasonalDemandFactor(getCity('LON'), getCity('NYC'), 2)).toBeGreaterThan(1.05);
  });

  it('actually moves a settled quarter', () => {
    // Same seed, same route, same fleet — only the quarter of the year differs.
    // A sector with spare seats, so the season is not hidden by the ceiling.
    const run = (start: number): number => {
      let s = newGame(4, 'LON');
      s = applyAction(s, {
        type: 'OPEN_ROUTE', carrierId: 'player', from: 'LON', to: 'YYZ',
      }).state;
      s = applyAction(s, {
        type: 'ACQUIRE_AIRCRAFT', carrierId: 'player', typeId: 'AROSW5', ownership: 'leased',
      }).state;
      const tailId = getCarrier(s, 'player').fleet[0]!.id;
      s = applyAction(s, {
        type: 'ASSIGN_AIRCRAFT', carrierId: 'player', tailId, routeId: s.routes[0]!.id,
      }).state;
      s = { ...s, carriers: s.carriers.map((c) => c.id === 'player'
        ? { ...c, fleet: c.fleet.map((t) => ({ ...t, deliversTurn: 0 })) } : c) };
      // endTurn settles turn+1, so start at 1 to settle Q3 and 3 to settle Q1.
      return endTurn({ ...s, turn: start }).history.at(-1)!.revenue;
    };
    expect(run(1)).toBeGreaterThan(run(3));
  });
});

describe('a hedge is priced against the market it is written in', () => {
  const withEvent = (state: GameState, id: string): GameState => {
    const card = getEvent(id);
    return {
      ...state,
      events: [{ source: card.id, kind: 'event', until: state.turn + 6, effects: card.effects }],
    };
  };
  const lock = (state: GameState): number => {
    const result = applyAction(state, { type: 'HEDGE_FUEL', carrierId: 'player', fraction: 0.8 });
    expect(result.ok).toBe(true);
    return getCarrier(result.state, 'player').hedge!.pricePerL;
  };

  it('always costs the same premium over the prevailing price', () => {
    // The counterparty can see a running fuel event as well as you can. Pricing
    // off the bare walk instead let a carrier wait for an oil spike and only
    // then lock fuel a third BELOW the market — a risk-free arbitrage that
    // inverts the mechanic, since a hedge is a bet made before you know.
    const base = newGame(5, 'LON');
    for (const event of [null, 'oil-spike', 'oil-glut']) {
      const state = event ? withEvent(base, event) : base;
      const market = marketFuelPrice(state);
      expect(lock(state) / market, event ?? 'calm').toBeCloseTo(
        CONSTANTS.events.hedgePremium, 9);
    }
  });

  it('never locks below the price it is written at', () => {
    const state = withEvent(newGame(5, 'LON'), 'oil-spike');
    expect(lock(state)).toBeGreaterThan(marketFuelPrice(state));
  });

  it('quotes the same market price the rest of the screen shows', () => {
    // The dialog used to say "spot is $0.81" while the masthead said $0.59.
    const state = withEvent(newGame(5, 'LON'), 'oil-glut');
    expect(marketFuelPrice(state)).not.toBeCloseTo(state.fuelPrice, 2);
    expect(effectiveFuelPrice(state, getCarrier(state, 'player'))).toBeCloseTo(
      marketFuelPrice(state), 9);
  });
});

/**
 * A ranged card bites differently every time it appears.
 *
 * Duration was always rolled and the SIZE never was, so a card played the same way
 * every time and a player who had met it once knew exactly what it cost. The chaos
 * cards keep their whole effect in `effectRange`, so the headline is constant and
 * the damage is not. It stays inside the no-bespoke-code-per-event rule: a card
 * declares which effects vary and between what, and nothing else changes.
 */
describe('ranged event effects', () => {
  it('rolls a different draw each time, inside the declared band', () => {
    const ranged = EVENTS.filter((c) => c.effectRange);
    expect(ranged.length, 'no card declares a range — nothing to test').toBeGreaterThan(0);

    for (const card of ranged) {
      const seenPerKey = new Map<string, Set<number>>();
      for (let seed = 0; seed < 60; seed += 1) {
        const rolled = rollEffectsForTest(card, new Rng(seed));
        for (const [key, span] of Object.entries(card.effectRange!)) {
          const value = rolled[key]!;
          expect(value, `${card.id}.${key} below its band`).toBeGreaterThanOrEqual(span[0]);
          expect(value, `${card.id}.${key} above its band`).toBeLessThanOrEqual(span[1]);
          const bag = seenPerKey.get(key) ?? new Set<number>();
          bag.add(Math.round(value * 1000));
          seenPerKey.set(key, bag);
        }
      }
      // The whole point is variety: a "range" that always lands on one value is a
      // fixed effect in a costume.
      for (const [key, bag] of seenPerKey) {
        expect(bag.size, `${card.id}.${key} never varied across 60 draws`).toBeGreaterThan(10);
      }
    }
  });

  it('leaves an ordinary card exactly as it was', () => {
    // Additive to the deck, not a change to it.
    const plain = EVENTS.find((c) => !c.effectRange && Object.keys(c.effects).length > 0)!;
    for (const seed of [1, 2, 3]) {
      expect(rollEffectsForTest(plain, new Rng(seed))).toEqual(plain.effects);
    }
  });
});
