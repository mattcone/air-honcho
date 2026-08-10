/**
 * The planning horizon: how a rival judges an INVESTMENT as opposed to what it
 * sees this quarter.
 *
 * The point of all of it is that a carrier should not decide a multi-year
 * commitment on the bottom of a cycle — it used to open routes during a fuel glut
 * and abandon them when it passed, churn that read as stupidity. These tests pin
 * the two mechanisms (fuel reverting to its anchor, temporary shocks counting only
 * for the quarters they have left) and the coherence rule that matters most: a
 * carrier must not close a sector on the very numbers it already decided to ride.
 */
import { describe, expect, it } from 'vitest';
import { newGame, getCarrier, endTurn } from '../src/sim/engine.ts';
import {
  assignedTo, buildMarketIndex, computeRouteEconomics, feedMultiplier,
  rivalsOf, rivalCapacityOf, stationOverheadFor,
} from '../src/sim/economics.ts';
import { klassesOf } from '../src/sim/conditions.ts';
import { probe } from '../src/sim/ai/common.ts';
import { appraisalConditionsFor, conditionsFor, expectedFuelPrice } from '../src/sim/conditions.ts';
import { marketIndex, pruneLosers } from '../src/sim/ai/common.ts';
import { CONSTANTS } from '../src/sim/world.ts';
import type { GameState } from '../src/sim/types.ts';

const HORIZON = CONSTANTS.ai.appraisalQuarters;
const ANCHOR = CONSTANTS.game.startingFuelPricePerL;
const ROUTE = { id: 'r', carrierId: 'player', from: 'LON', to: 'IST', posture: 'match' as const, openedTurn: 0 };
const KLASSES = new Set(['Narrowbody']);

describe('fuel is appraised on the cycle, not the spot', () => {
  it('leaves the long-run anchor alone', () => {
    expect(expectedFuelPrice(ANCHOR, HORIZON)).toBeCloseTo(ANCHOR, 9);
  });

  it('discounts a spike and lifts a glut, both toward the anchor', () => {
    const spike = expectedFuelPrice(ANCHOR * 2, HORIZON);
    expect(spike).toBeLessThan(ANCHOR * 2); // a spike is not assumed to last
    expect(spike).toBeGreaterThan(ANCHOR); // but it has not vanished either
    const glut = expectedFuelPrice(ANCHOR / 2, HORIZON);
    expect(glut).toBeGreaterThan(ANCHOR / 2); // cheap fuel is not assumed to last either
    expect(glut).toBeLessThan(ANCHOR);
  });

  it('collapses to the spot price at a one-quarter horizon', () => {
    // Which is what makes `appraisalQuarters=1` a clean control for the A/B.
    expect(expectedFuelPrice(1.7, 1)).toBeCloseTo(1.7, 9);
  });
});

describe('a temporary shock counts only for the quarters it has left', () => {
  const withAsh = (until: number): GameState => ({
    ...newGame(1, 'LON'),
    turn: 0,
    events: [{ source: 'volcanic-ash', kind: 'event', until, effects: { completion: 0.35 } }],
  });

  it('looks through a shock that is nearly over', () => {
    const s = withAsh(2);
    const me = getCarrier(s, 'player');
    const live = conditionsFor(s, me, ROUTE, KLASSES).completion;
    const planned = appraisalConditionsFor(s, me, ROUTE, KLASSES).completion;
    expect(planned).toBeGreaterThan(live * 2); // barely felt
  });

  it('takes a shock that outlasts the horizon at face value', () => {
    const s = withAsh(HORIZON + 4);
    const me = getCarrier(s, 'player');
    expect(appraisalConditionsFor(s, me, ROUTE, KLASSES).completion).toBeCloseTo(
      conditionsFor(s, me, ROUTE, KLASSES).completion,
      9,
    );
  });

  it('never discounts technology, which is permanent', () => {
    const s: GameState = { ...newGame(1, 'LON'), turn: 0, events: [] };
    const teched = { ...getCarrier(s, 'player'), tech: ['revenue-management'] };
    expect(appraisalConditionsFor(s, teched, ROUTE, KLASSES).loadCeiling).toBeCloseTo(
      conditionsFor(s, teched, ROUTE, KLASSES).loadCeiling,
      9,
    );
  });
});

describe('a carrier does not abandon what it just decided to ride out', () => {
  /** One widebody on a thin short market — structurally a loser, shock or no shock. */
  function carrierWithRoute(events: GameState['events']): GameState {
    const base = newGame(1, 'LON');
    const rival = {
      ...base.carriers[0]!, id: 'r1', name: 'Test Air', isPlayer: false, archetypeId: 'legacy',
      cash: 500_000_000,
      fleet: [{
        id: 'T1', typeId: 'AROSW6', ownership: 'leased' as const,
        acquiredTurn: 0, deliversTurn: 0, bookValue: 0, routeId: 'rt',
      }],
    };
    return {
      ...base, turn: 60, events,
      carriers: [base.carriers[0]!, rival],
      // Opened long ago, so the commitment window is not what is doing the work here.
      routes: [{ id: 'rt', carrierId: 'r1', from: 'LAS', to: 'SLC', posture: 'match' as const, openedTurn: 0 }],
    };
  }
  const RESERVE = { reserveCash: 30_000_000 };

  it('closes a sector that fails on both the quarter and the horizon', () => {
    const s = carrierWithRoute([]);
    expect(pruneLosers(s, marketIndex(s), 'r1', RESERVE).routes).toHaveLength(0);
  });

  it('still closes it when the carrier is below its cash reserve, whatever the plan says', () => {
    const s = carrierWithRoute([]);
    const broke: GameState = {
      ...s, carriers: s.carriers.map((c) => (c.id === 'r1' ? { ...c, cash: 1_000_000 } : c)),
    };
    expect(pruneLosers(broke, marketIndex(broke), 'r1', RESERVE).routes).toHaveLength(0);
  });
});

describe('the tuning hook is inert in a real game', () => {
  it('applies no archetype overrides unless a tuning script sets them', async () => {
    // `scripts/tune.ts` can patch archetype knobs in-process. Nothing else may, or
    // the shipped game would stop being pure data plus deterministic code.
    const { getArchetype } = await import('../src/sim/ai/archetype.ts');
    const archetypes = await import('../src/data/archetypes.json', { with: { type: 'json' } });
    for (const raw of archetypes.default.archetypes) {
      expect(getArchetype(raw.id)).toEqual(raw);
    }
  });
});

/**
 * The AI must plan on the numbers the game will actually charge it.
 *
 * `probe` and the quarterly settlement price the same route through two separate
 * call sites, each assembling its own conditions, rival capacity and hub feed —
 * and the feed argument is built two different ways (a per-carrier city tally in
 * the settlement, a scan of the route list in `probe`). Nothing forces those to
 * stay in step. If they drift, every AI decision is made against a phantom P&L
 * and the symptom is not an error but a field of rivals that quietly plays badly.
 */
describe('AI planning and settlement agree', () => {
  it('prices a live route identically through both paths', () => {
    // Deliberately a hard game: the most rivals, the most contested markets, and
    // the most opportunity for the two rival-capacity lookups to disagree.
    let state = newGame(29, 'LON', undefined, { difficulty: 'hard', scenario: 'present' });
    let priced = 0;

    for (let turn = 0; turn < 24 && !state.gameOver; turn++) {
      state = endTurn(state);
      const index = buildMarketIndex(state);

      for (const carrier of state.carriers) {
        if (carrier.bankruptTurn !== null) continue;

        // Rebuilt exactly as `computeCarrierQuarter` does it, so this compares the
        // settlement's real feed arithmetic and not a restatement of `feedFactor`.
        const cityCount = new Map<string, number>();
        for (const r of state.routes) {
          if (r.carrierId !== carrier.id) continue;
          cityCount.set(r.from, (cityCount.get(r.from) ?? 0) + 1);
          cityCount.set(r.to, (cityCount.get(r.to) ?? 0) + 1);
        }

        for (const route of state.routes) {
          if (route.carrierId !== carrier.id) continue;
          const assigned = assignedTo(carrier, route.id);
          const settlementFeed = feedMultiplier(
            ((cityCount.get(route.from) ?? 1) - 1) + ((cityCount.get(route.to) ?? 1) - 1),
          );
          // Station overhead is allocated two different ways as well: the settlement
          // divides its own city tally, `probe` rescans the route list. Same trap as
          // the feed factor, same reason to check it here rather than trust it.
          const stationCost = CONSTANTS.routes.stationQuarterlyCost;
          const settlementStation =
            stationCost / Math.max(1, cityCount.get(route.from) ?? 1) +
            stationCost / Math.max(1, cityCount.get(route.to) ?? 1);
          expect(settlementStation).toBeCloseTo(
            stationOverheadFor(state.routes, carrier.id, route.from, route.to, true), 6,
          );
          const settlementNet = computeRouteEconomics(
            route, assigned, state.turn,
            conditionsFor(state, carrier, route, klassesOf(assigned)),
            rivalsOf(index, route), rivalCapacityOf(index, route), settlementFeed,
            settlementStation,
          ).netCash;

          // The ONLY thing the settlement adds is the season-and-noise shock, which
          // is withheld from planning on purpose (see `endTurn`): a carrier judges a
          // route on annual economics and then lives through the quarter it gets.
          // With that neutral, the two must land on the same cent.
          expect(probe(state, index, route, assigned)).toBeCloseTo(settlementNet, 6);
          priced += 1;
        }
      }
    }

    // Guard the guard: a game that collapsed early would pass this vacuously.
    // Set well under the ~490 this actually prices, so a balance change that
    // moves route counts a little does not fail a test about pricing agreement.
    expect(priced).toBeGreaterThan(300);
  });
});
