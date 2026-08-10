/**
 * Headless game driver. Runs a full game with no UI and reports summary stats.
 *
 * Shared deliberately between `npm run simulate` and the CI regression suite, so
 * the numbers a balance change prints are the same numbers CI asserts on.
 */
import type { Difficulty, GameState, PricingPosture } from './types.ts';
import { endTurn, getCarrier, netWorth, newGame } from './engine.ts';
import {
  assignedTo, buildMarketIndex, computeRouteEconomics, competitorsOf, feedFactor, rivalCapacityOf,
  rivalsOf, stationOverheadFor,
} from './economics.ts';
import { conditionsFor, klassesOf } from './conditions.ts';
import { Rng } from './rng.ts';
import { CITIES } from './world.ts';
import { decide, setup } from './ai/heuristic.ts';

export interface GameSummary {
  readonly seed: number;
  readonly homeCityId: string;
  readonly turnsPlayed: number;
  readonly finalCash: number;
  readonly finalNetWorth: number;
  readonly routes: number;
  readonly fleet: number;
  /** Rivals that have entered and are still solvent. */
  readonly rivals: number;
  /** Rivals that entered at all, solvent or not. */
  readonly rivalsEntered: number;
  /** Rivals that genuinely failed (bankrupt, not bought out). */
  readonly rivalsFailed: number;
  /** Rivals absorbed by another carrier. */
  readonly rivalsAcquired: number;
  readonly rivalRoutes: number;
  /** Player's share of all modeled carriers' route-count, 0..1. */
  readonly playerRouteShare: number;
  readonly bankruptTurn: number | null;
  /** True if the player was bought out rather than going broke. */
  readonly playerAcquired: boolean;
  readonly gameOver: string | null;
  readonly bestQuarter: number;
  readonly worstQuarter: number;
  /** Capacity-weighted mean load factor across active sectors on the final turn. */
  readonly finalLoadFactor: number;
  readonly finalFuelPrice: number;
  /** Every event that ran at some point, for checking games differ. */
  readonly eventsSeen: string[];
  readonly techDelivered: number;
  /** Failures and quarters of exposure per archetype, for survival invariants. */
  readonly rivalHazard: Record<string, { failed: number; exposure: number }>;
}

/**
 * One sector, as it stood at the end of one quarter. The audit substrate: enough
 * to ask why a route landed where it did, not just that it did.
 *
 * Collected only when a caller asks for it (`observe`), so a normal run and the
 * regression suite pay nothing for it.
 */
export interface RouteObservation {
  readonly turn: number;
  readonly seed: number;
  readonly carrierId: string;
  readonly isPlayer: boolean;
  readonly archetypeId: string | null;
  readonly routeId: string;
  readonly from: string;
  readonly to: string;
  readonly distanceKm: number;
  readonly posture: PricingPosture;
  readonly aircraftCount: number;
  readonly typeIds: readonly string[];
  readonly frequencyWeekly: number;
  readonly capacityWeekly: number;
  readonly marketDemandWeekly: number;
  readonly demandShare: number;
  readonly paxCarriedWeekly: number;
  readonly spilledWeekly: number;
  readonly loadFactor: number;
  readonly loadCeiling: number;
  readonly fareOneWay: number;
  readonly competitionMultiplier: number;
  /** Carriers other than this one flying the same city pair. */
  readonly competitors: number;
  readonly revenue: number;
  readonly netCash: number;
  readonly netEconomic: number;
  /** netCash / revenue — the margin the player is judged on. */
  readonly margin: number;
}

/** Every live sector on the board this turn, priced the way the dossier prices it. */
function observeRoutes(state: GameState, seed: number): RouteObservation[] {
  const index = buildMarketIndex(state);
  const rows: RouteObservation[] = [];
  for (const route of state.routes) {
    const carrier = state.carriers.find((c) => c.id === route.carrierId);
    if (!carrier || carrier.bankruptTurn !== null) continue;
    const assigned = assignedTo(carrier, route.id);
    if (assigned.length === 0) continue;
    const econ = computeRouteEconomics(
      route,
      assigned,
      state.turn,
      conditionsFor(state, carrier, route, klassesOf(assigned)),
      rivalsOf(index, route),
      rivalCapacityOf(index, route),
      feedFactor(state.routes, carrier.id, route.from, route.to, route.id),
      stationOverheadFor(state.routes, carrier.id, route.from, route.to, true),
    );
    rows.push({
      turn: state.turn,
      seed,
      carrierId: carrier.id,
      isPlayer: carrier.isPlayer,
      archetypeId: carrier.archetypeId,
      routeId: route.id,
      from: route.from,
      to: route.to,
      distanceKm: econ.distanceKm,
      posture: route.posture,
      aircraftCount: econ.aircraftCount,
      typeIds: assigned.map((a) => a.typeId),
      frequencyWeekly: econ.frequencyWeekly,
      capacityWeekly: econ.capacityWeekly,
      marketDemandWeekly: econ.marketDemandWeekly,
      demandShare: econ.demandShare,
      paxCarriedWeekly: econ.paxCarriedWeekly,
      spilledWeekly: econ.spilledWeekly,
      loadFactor: econ.loadFactor,
      loadCeiling: econ.loadCeiling,
      fareOneWay: econ.fareOneWay,
      competitionMultiplier: econ.competitionMultiplier,
      competitors: competitorsOf(index, route).length,
      revenue: econ.revenue,
      netCash: econ.netCash,
      netEconomic: econ.netEconomic,
      margin: econ.revenue > 0 ? econ.netCash / econ.revenue : 0,
    });
  }
  return rows;
}

/*
 * Priced against the market the player is actually in.
 *
 * This used to omit the rivals, their capacity and the hub feed, which meant every
 * sector was costed as though the player had it to themselves: they won the whole
 * market's demand, filled the aircraft, and the figure reported back was the load
 * factor of a monopolist. It is a reported statistic rather than a gameplay one, so
 * nothing in the sim moved because of it — but it is read straight out of
 * `GameSummary` when balance is being judged, which makes a flattering number worse
 * than a missing one.
 */
function finalLoadFactor(state: GameState): number {
  const player = getCarrier(state, state.playerCarrierId);
  const index = buildMarketIndex(state);
  let pax = 0;
  let seats = 0;
  for (const route of state.routes) {
    if (route.carrierId !== player.id) continue;
    const assigned = assignedTo(player, route.id);
    const econ = computeRouteEconomics(
      route, assigned, state.turn, conditionsFor(state, player, route, klassesOf(assigned)),
      rivalsOf(index, route), rivalCapacityOf(index, route),
      feedFactor(state.routes, player.id, route.from, route.to, route.id),
      stationOverheadFor(state.routes, player.id, route.from, route.to, true),
    );
    pax += econ.paxCarriedWeekly;
    seats += econ.capacityWeekly;
  }
  return seats > 0 ? pax / seats : 0;
}

/** Failures and exposure per archetype — entry timing removed, so it is a rate. */
function hazardByArchetype(state: GameState): Record<string, { failed: number; exposure: number }> {
  const out: Record<string, { failed: number; exposure: number }> = {};
  for (const carrier of state.carriers) {
    if (carrier.isPlayer || !carrier.archetypeId) continue;
    const plan = state.rivalPlan.find((r) => r.id === carrier.id);
    if (!plan) continue;
    const acc = out[carrier.archetypeId] ?? { failed: 0, exposure: 0 };
    acc.exposure += Math.max(0, (carrier.bankruptTurn ?? state.turn) - plan.entryTurn);
    if (carrier.bankruptTurn !== null) acc.failed += 1;
    out[carrier.archetypeId] = acc;
  }
  return out;
}

export function runGame(
  seed: number,
  maxTurns?: number,
  scenario: 'present' | 'history' = 'present',
  difficulty: Difficulty = 'medium',
  /** Called after every settled quarter with every live sector on the board. */
  observe?: (rows: readonly RouteObservation[]) => void,
): GameSummary {
  // A separate stream for AI decisions, so sim determinism does not depend on
  // how many choices the AI happens to make in a given game.
  const aiRng = Rng.fromSeed(seed ^ 0x5f3759df);
  const home = aiRng.pick(CITIES).id;

  let state: GameState = newGame(seed, home, 'Stub Air', { scenario, difficulty });
  state = setup(state, state.playerCarrierId, aiRng);
  const limit = maxTurns ?? state.horizonTurns;

  // Events expire, so watch for them as the game runs rather than reading the
  // final state and seeing only whatever happened to still be running.
  const seenEvents = new Set<string>();
  while (state.turn < limit && !state.gameOver) {
    state = decide(state, state.playerCarrierId, aiRng);
    state = endTurn(state);
    for (const effect of state.events) seenEvents.add(effect.source);
    if (observe) observe(observeRoutes(state, seed));
  }

  const player = getCarrier(state, state.playerCarrierId);
  const quarters = state.history.filter((h) => h.carrierId === player.id).map((h) => h.netIncome);

  const playerRoutes = state.routes.filter((r) => r.carrierId === player.id).length;
  const rivalRoutes = state.routes.length - playerRoutes;
  const liveRivals = state.carriers.filter((c) => !c.isPlayer && c.bankruptTurn === null).length;
  const rivalsFailed = state.carriers.filter((c) => !c.isPlayer && c.bankruptTurn !== null && c.acquiredBy === null).length;
  const rivalsAcquired = state.carriers.filter((c) => !c.isPlayer && c.acquiredBy !== null).length;

  return {
    seed,
    homeCityId: home,
    turnsPlayed: state.turn,
    finalCash: player.cash,
    finalNetWorth: netWorth(player),
    routes: playerRoutes,
    fleet: player.fleet.length,
    rivals: liveRivals,
    rivalsEntered: state.carriers.filter((c) => !c.isPlayer).length,
    rivalsFailed,
    rivalsAcquired,
    rivalRoutes,
    playerRouteShare: state.routes.length > 0 ? playerRoutes / state.routes.length : 0,
    bankruptTurn: player.bankruptTurn,
    playerAcquired: player.acquiredBy !== null,
    gameOver: state.gameOver?.reason ?? null,
    bestQuarter: quarters.length ? Math.max(...quarters) : 0,
    worstQuarter: quarters.length ? Math.min(...quarters) : 0,
    finalLoadFactor: finalLoadFactor(state),
    finalFuelPrice: state.fuelPrice,
    eventsSeen: [...seenEvents],
    techDelivered: player.tech.length,
    rivalHazard: hazardByArchetype(state),
  };
}

export function runGames(
  startSeed: number,
  count: number,
  maxTurns?: number,
  scenario: 'present' | 'history' = 'present',
  difficulty: Difficulty = 'medium',
): GameSummary[] {
  return Array.from({ length: count }, (_, i) => runGame(startSeed + i, maxTurns, scenario, difficulty));
}
