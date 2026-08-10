/**
 * Operating conditions: the world's current multipliers on the things a sector's
 * economics depend on.
 *
 * Events and technology both work by moving these numbers — an event for a few
 * quarters, a tech node permanently — so there is one mechanism rather than two.
 * Nothing else in the sim knows what an event or a tech node *is*; it only sees
 * the resolved conditions for a route.
 *
 * Effects are multiplicative and compose: two events that each halve completion
 * leave a quarter of the schedule flying.
 */
import type { ActiveEffect, Carrier, GameState, Region, Route } from './types.ts';
import { CONSTANTS, difficultyMods, getCity } from './world.ts';
import { getAircraftType } from './fleet.ts';
import { getTechNode } from './tech.ts';
import { archetypeCostAdvantage } from './costbase.ts';
import { preferredMaker } from './fleet.ts';
import { creditRating } from './market.ts';

/**
 * Every knob the world can turn. Each is a multiplier on the baseline, so 1
 * means "nothing unusual is happening".
 */
export interface Conditions {
  /** USD per liter, absolute rather than a multiplier — it is a market price. */
  readonly fuelPrice: number;
  readonly demand: number;
  readonly fare: number;
  readonly maintenanceCost: number;
  readonly crewCost: number;
  readonly handlingCost: number;
  /**
   * The share of offered seats a carrier can actually sell on a sector that is
   * turning traffic away. Not a constant: revenue management, capacity planning
   * and repeat custom all let a carrier fill more of what it flies, so this is
   * one of the things technology buys.
   */
  readonly loadCeiling: number;
  /**
   * Coefficient of variation of demand for one departure. Lower means a carrier
   * can predict its loads better and therefore size closer to the mean — which is
   * what revenue management actually buys.
   */
  readonly kFactor: number;
  /**
   * The manufacturer this carrier is built around, or null for no preference.
   * Aircraft from the other full-line maker cost more to crew and maintain —
   * fleet commonality is real money, and it is what stops every carrier's
   * appraisal reaching the same answer about the same aeroplane.
   */
  readonly preferredMaker: string | null;
  /**
   * Share of the schedule that actually operates. Weather, air traffic control,
   * technical faults and groundings all land here. Crucially this bites
   * capacity, not demand — a sector already turning traffic away does not
   * notice a demand shock, but it very much notices losing a fifth of its
   * departures.
   */
  readonly completion: number;
  /** Multiplier on lease rates, from the carrier's credit rating. Weak balance
   *  sheets pay a lessor's risk premium. */
  readonly leaseCost: number;
  /** How hard rival capacity drags the load ceiling down on a contested market —
   *  the base penalty scaled by the game's difficulty. See economics.ts. */
  readonly competitionLoadPenalty: number;
}

/**
 * Nothing unusual happening. Note `fuelPrice` here is a placeholder: unlike the
 * rest, it is an absolute market price rather than a multiplier, so a caller
 * spreading NEUTRAL must supply a real one.
 */
export const NEUTRAL: Conditions = {
  fuelPrice: 1,
  demand: 1,
  fare: 1,
  maintenanceCost: 1,
  crewCost: 1,
  handlingCost: 1,
  completion: 1,
  leaseCost: 1,
  loadCeiling: CONSTANTS.demand.maxLoadFactor,
  kFactor: CONSTANTS.demand.departureKFactor,
  preferredMaker: null,
  competitionLoadPenalty: CONSTANTS.share.competitionLoadPenalty,
};

/**
 * A carrier's technology, resolved once into a single set of multipliers.
 *
 * Keyed on the tech array's identity, which is safe because `clone()` replaces
 * that array wholesale rather than editing it (see engine.ts) — so a given array
 * always means the same set of nodes. The AI resolves conditions millions of
 * times a game and walking every delivered node each time was the largest single
 * cost in a turn.
 */
const techCache = new WeakMap<readonly string[], Readonly<Record<string, number>>>();

export function techEffects(tech: readonly string[]): Readonly<Record<string, number>> {
  const hit = techCache.get(tech);
  if (hit) return hit;

  const combined: Record<string, number> = {};
  for (const nodeId of tech) {
    for (const [key, value] of Object.entries(getTechNode(nodeId).effects)) {
      combined[key] = (combined[key] ?? 1) * value;
    }
  }
  techCache.set(tech, combined);
  return combined;
}

/** Does this effect apply to this route at all? */
function applies(effect: ActiveEffect, route: Route, typeKlasses: ReadonlySet<string>): boolean {
  const scope = effect.scope;
  if (!scope) return true;

  if (scope.regions && scope.regions.length > 0) {
    const from = getCity(route.from).region as Region;
    const to = getCity(route.to).region as Region;
    if (!scope.regions.includes(from) && !scope.regions.includes(to)) return false;
  }
  if (scope.aircraftKlass && !typeKlasses.has(scope.aircraftKlass)) return false;
  return true;
}

/**
 * Conditions for one sector, given everything currently in force.
 *
 * `flownKlasses` is the set of aircraft classes assigned to the route — a
 * grounding of one class only touches sectors flown by it.
 */
export function conditionsFor(
  state: GameState,
  carrier: Carrier,
  route: Route,
  flownKlasses: ReadonlySet<string>,
): Conditions {
  return resolveConditions(state, carrier, route, flownKlasses, null);
}

/**
 * Conditions for APPRAISING a multi-year commitment rather than settling this
 * quarter — what a network planner uses, and the difference between an airline
 * that plans and one that day-trades.
 *
 * Two departures from the live conditions, both because a planner looks through
 * the cycle rather than at the bottom of it:
 *
 *  - **Fuel is pulled toward its long-run level.** The walk reverts toward
 *    `startingFuelPricePerL`, so the expected average over the horizon is a known
 *    blend of today's spot and that anchor. Judging a fifteen-year aircraft on
 *    today's spike (or today's glut) is what had rivals piling into markets when
 *    fuel was cheap and abandoning them when it was not.
 *  - **A temporary shock counts only for the slice of the horizon it still has to
 *    run.** An ash cloud with two quarters left should not veto a decade-long
 *    commitment. Technology, being permanent, still counts in full.
 *
 * A hedge is deliberately ignored: it is a four-quarter financial position, not a
 * property of the sector, and pricing a decade of flying off it would have a
 * carrier open routes it cannot afford once the hedge rolls off.
 */
export function appraisalConditionsFor(
  state: GameState,
  carrier: Carrier,
  route: Route,
  flownKlasses: ReadonlySet<string>,
  horizon: number = CONSTANTS.ai.appraisalQuarters,
): Conditions {
  return resolveConditions(state, carrier, route, flownKlasses, Math.max(1, horizon));
}

/**
 * The fuel price a planner should assume on average over `horizon` quarters, given
 * that the walk reverts toward its anchor at a known rate. Closed form: the mean of
 * the expected log-price path, so a spike is discounted by exactly as much as the
 * model says it will decay.
 */
export function expectedFuelPrice(spot: number, horizon: number): number {
  const r = CONSTANTS.events.fuelReversion;
  const anchor = CONSTANTS.game.startingFuelPricePerL;
  if (horizon <= 1 || r <= 0 || spot <= 0) return spot;
  const weight = (1 - (1 - r) ** horizon) / (r * horizon);
  return Math.exp(Math.log(anchor) + weight * (Math.log(spot) - Math.log(anchor)));
}

/**
 * Shared by both: `horizon` null settles this quarter, a number appraises across
 * that many quarters.
 */
function resolveConditions(
  state: GameState,
  carrier: Carrier,
  route: Route,
  flownKlasses: ReadonlySet<string>,
  horizon: number | null,
): Conditions {
  // Difficulty seeds world demand: a roomier world on easy, a thinner one on hard.
  // Events and tech then compose onto it multiplicatively.
  let demand = difficultyMods(state.difficulty).demand;
  // ...and seeds the fare every carrier clears. Thinning traffic alone barely
  // moved margins, because most sectors are capacity-constrained rather than
  // demand-constrained: less demand mostly means less spill. Yield is the lever
  // that reaches the money. See docs/demand-audit.md.
  let fare = difficultyMods(state.difficulty).yield;
  let maintenanceCost = 1;
  let crewCost = 1;
  let handlingCost = 1;
  let completion = state.baseCompletion;
  let loadCeiling = CONSTANTS.demand.maxLoadFactor;
  /*
   * Revenue management does not raise the physical ceiling on an aeroplane — it
   * narrows the uncertainty a carrier has to hold capacity against, so it can size
   * closer to the mean and fill more of the seats it flies. Under the spill model
   * that is a K-factor effect, and the same programs that used to multiply
   * loadCeiling now divide this. Same buttons, same tree, true for the right
   * reason. See docs/supply-model-research.md.
   */
  let kFactor = CONSTANTS.demand.departureKFactor;
  let marketFuelMultiplier = 1;
  let ownFuelMultiplier = 1;

  // How much of a temporary effect an appraisal should feel: all of it while
  // settling, and only its remaining share of the horizon while planning. Blended
  // toward 1 (no effect) rather than scaled, so a multiplier stays a multiplier.
  const weigh = (value: number, until: number | null): number => {
    if (horizon === null || until === null) return value;
    const left = Math.max(0, until - state.turn);
    return 1 + (value - 1) * Math.min(1, left / horizon);
  };

  const apply = (e: Readonly<Record<string, number>>, isWorldEvent: boolean, until: number | null): void => {
    const w = (v: number): number => (isWorldEvent ? weigh(v, until) : v);
    if (e['demand'] !== undefined) demand *= w(e['demand']);
    if (e['fare'] !== undefined) fare *= w(e['fare']);
    if (e['maintenanceCost'] !== undefined) maintenanceCost *= w(e['maintenanceCost']);
    if (e['crewCost'] !== undefined) crewCost *= w(e['crewCost']);
    if (e['handlingCost'] !== undefined) handlingCost *= w(e['handlingCost']);
    if (e['completion'] !== undefined) completion *= w(e['completion']);
    if (e['loadCeiling'] !== undefined) {
      // A multiplier ABOVE 1 was "fills more of the aeroplane". That is now a
      // proportional reduction in demand uncertainty; a multiplier below 1 (a
      // recession dragging loads down) still lands on the ceiling, where it belongs.
      const m = w(e['loadCeiling']);
      if (m > 1) kFactor /= m;
      else loadCeiling *= m;
    }
    if (e['fuelPrice'] !== undefined) {
      // A world event moves the market price, which a hedge can protect against.
      // A carrier's own efficiency program cuts what it burns, which applies
      // whatever it paid for the fuel.
      if (isWorldEvent) marketFuelMultiplier *= w(e['fuelPrice']);
      else ownFuelMultiplier *= e['fuelPrice'];
    }
  };

  for (const effect of state.events) {
    if (!applies(effect, route, flownKlasses)) continue;
    apply(effect.effects, true, effect.until);
  }
  // The carrier's own technology. Never scoped, never shared with rivals, and
  // permanent — so an appraisal counts it in full.
  if (carrier.tech.length > 0) apply(techEffects(carrier.tech), false, null);

  // A carrier's structural cost position: one fleet type and secondary airports
  // against a legacy carrier's hubs and mixed fleet. Fuel is a world price and
  // is deliberately excluded.
  /*
   * A carrier that has been through Chapter 11 runs permanently cheaper.
   *
   * Renegotiated contracts, shed obligations, a fleet it chose rather than
   * inherited. This is the whole point of the mechanic and the perverse dynamic
   * it models: killing a rival with a fare war hands it back to you leaner. It
   * compounds with the archetype's own position, which is right — a low-cost
   * carrier that restructures is a genuinely frightening thing.
   */
  const restructured = (carrier.reorganisations ?? 0) > 0
    ? CONSTANTS.finance.reorgCostAdvantage
    : 1;
  const structural = archetypeCostAdvantage(carrier.archetypeId, flownKlasses) * restructured;

  const market = horizon === null ? state.fuelPrice : expectedFuelPrice(state.fuelPrice, horizon);
  const spot = market * marketFuelMultiplier;
  return {
    // Appraisal prices off the market rather than this carrier's hedge book.
    fuelPrice: (horizon === null ? blendedFuelPrice(spot, carrier.hedge, state.turn) : spot) * ownFuelMultiplier,
    demand,
    fare: fare * fuelSurcharge(spot),
    maintenanceCost: maintenanceCost * structural,
    crewCost: crewCost * structural,
    handlingCost: handlingCost * structural,
    // A weak or over-leveraged balance sheet pays more to lease — the lessor's
    // risk premium, from the carrier's credit rating.
    leaseCost: CONSTANTS.finance.leaseByRating[creditRating(state, carrier)],
    completion: Math.max(0, Math.min(1, completion)),
    loadCeiling: Math.max(0, Math.min(CONSTANTS.demand.loadCeilingMax, loadCeiling)),
    kFactor: Math.max(0, kFactor),
    /*
     * RIVALS ONLY. The player has no shop and pays no off-shop penalty.
     *
     * This exists to stop every carrier's appraisal reaching the same answer
     * about the same aeroplane, which is a problem the AI has and the player does
     * not — a player differentiates their fleet by choosing it. Applied to the
     * player it was an 8% surcharge on crew and maintenance for half the market,
     * invisible in the interface, unchosen, and impossible to find out about. The
     * unit test for it passed throughout, because it checked the helper with a
     * null preference instead of checking what this function actually hands it.
     */
    preferredMaker: carrier.isPlayer ? null : preferredMaker(state.seed, carrier.id),
    // Difficulty decides how hard being contested bites: gentle on medium, fierce
    // on hard, near-nothing on easy.
    competitionLoadPenalty:
      CONSTANTS.share.competitionLoadPenalty * difficultyMods(state.difficulty).contestPressure,
  };
}

/**
 * The fare effect of the prevailing fuel price — the surcharge.
 *
 * Deliberately keyed to the SPOT price rather than what this carrier pays. Every
 * airline faces the same fuel market, so they all reprice together; a carrier
 * that hedged still gets the higher fare while paying the lower cost. That is
 * the whole point of hedging and it falls out of doing this correctly.
 */
export function fuelSurcharge(spotPrice: number): number {
  const baseline = CONSTANTS.game.startingFuelPricePerL;
  return (spotPrice / baseline) ** CONSTANTS.fare.fuelPassThrough;
}

/**
 * What the carrier actually pays for fuel: the spot price, blended with whatever
 * share of it was hedged forward at an agreed price.
 */
export function blendedFuelPrice(
  spot: number,
  hedge: { fraction: number; pricePerL: number; untilTurn: number } | null,
  turn: number,
): number {
  if (!hedge || turn >= hedge.untilTurn) return spot;
  // The event multiplier is already inside `spot`, so a hedge genuinely shelters
  // its share from an oil spike rather than being multiplied along with it.
  return hedge.fraction * hedge.pricePerL + (1 - hedge.fraction) * spot;
}

/**
 * The fuel price the market is actually trading at: the spot walk with any
 * unscoped fuel event applied on top.
 *
 * A scoped fuel event would only touch some sectors and so has no single
 * headline number; none of the deck currently scopes one, and this ignores any
 * that did rather than quoting a figure that is wrong everywhere.
 */
export function marketFuelPrice(state: GameState): number {
  let price = state.fuelPrice;
  for (const effect of state.events) {
    if (effect.scope) continue;
    const multiplier = effect.effects['fuelPrice'];
    if (multiplier !== undefined) price *= multiplier;
  }
  return price;
}

/**
 * What a carrier is actually paying for fuel: the market price, with its hedge
 * sheltering whatever share it locked.
 */
export function effectiveFuelPrice(state: GameState, carrier: Carrier): number {
  return blendedFuelPrice(marketFuelPrice(state), carrier.hedge, state.turn);
}

/** Aircraft classes flown on a route — for scoping a type grounding. */
export function klassesOf(assigned: readonly { typeId: string }[]): Set<string> {
  const klasses = new Set<string>();
  for (const tail of assigned) klasses.add(getAircraftType(tail.typeId).klass);
  return klasses;
}
