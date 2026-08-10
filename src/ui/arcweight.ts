/**
 * How heavily each of the player's sectors draws on the map.
 *
 * Pure over sim types — no DOM — so the rule can be tested. It was a private
 * method on the app class, where a defect in it was invisible to the suite: a
 * dormant sector scored zero revenue, sorted below every flying one, and was
 * handed the thinnest weight. Combined with the dashed dormant style that made a
 * route the player had just opened almost impossible to see, which is exactly the
 * kind of thing a screenshot catches and a test never does — unless the rule is
 * reachable from a test, which is what this file is for.
 */
import type { GameState, RouteId } from '../sim/types.ts';
import { getCarrier } from '../sim/engine.ts';
import {
  assignedTo, computeRouteEconomics, feedFactor, rivalCapacityOf, rivalsOf, stationOverheadFor,
  type MarketIndex,
} from '../sim/economics.ts';
import { conditionsFor, klassesOf } from '../sim/conditions.ts';

/** The middle tier: what a sector gets when there is no shape to show yet. */
export const NEUTRAL_WEIGHT = 1;

/**
 * Sort the player's sectors into three weight tiers by quarterly revenue.
 *
 * Ranked against the player's OWN network rather than a fixed dollar figure: the
 * map has to answer "where am I strong" in year 2 and year 25 alike, and any
 * absolute threshold answers it for one of them.
 *
 * Sectors with nothing assigned are ranked OUT rather than ranked last. The tier
 * means "how much of your network this sector carries", and a sector that is not
 * flying has no answer to that — the middle weight is the honest one.
 */
export function routeWeights(game: GameState, index: MarketIndex): Map<RouteId, number> {
  const me = getCarrier(game, game.playerCarrierId);
  const mine = game.routes.filter((r) => r.carrierId === me.id);
  const weights = new Map<RouteId, number>();

  const flying = mine.filter((route) => assignedTo(me, route.id).length > 0);
  for (const route of mine) {
    if (!flying.includes(route)) weights.set(route.id, NEUTRAL_WEIGHT);
  }
  // Fewer than three flying sectors is not a network yet; there is no shape to
  // rank, so everything sits in the middle.
  if (flying.length < 3) {
    for (const route of flying) weights.set(route.id, NEUTRAL_WEIGHT);
    return weights;
  }

  const revenue = flying.map((route) => {
    const assigned = assignedTo(me, route.id);
    const econ = computeRouteEconomics(
      route, assigned, game.turn,
      conditionsFor(game, me, route, klassesOf(assigned)),
      rivalsOf(index, route), rivalCapacityOf(index, route),
      feedFactor(game.routes, me.id, route.from, route.to, route.id),
      stationOverheadFor(game.routes, me.id, route.from, route.to, true),
    );
    return { id: route.id, value: econ.revenue };
  });
  const sorted = [...revenue].sort((a, b) => a.value - b.value);
  const third = Math.floor(sorted.length / 3);
  sorted.forEach((row, i) => {
    weights.set(row.id, i < third ? 0 : i < sorted.length - third ? 1 : 2);
  });
  return weights;
}
