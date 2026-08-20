/**
 * Route and carrier economics for one quarter. This is where demand, fleet and
 * fares turn into cash.
 *
 * Everything is computed weekly then scaled to the quarter, so the derived
 * frequencies read naturally. Accounting is one-way and symmetric: outbound and
 * inbound are mirror images, so we size one direction and double the passenger
 * and departure counts.
 *
 * Pure and deterministic. Demand noise enters through `demandMultiplier`, which
 * the engine supplies from its seeded RNG (1 = the honest projection the UI shows).
 */
import type {
  Aircraft,
  AircraftType,
  PricingPosture,
  Carrier,
  CarrierId,
  CityId,
  GameState,
  QuarterResult,
  Route,
  RouteEconomics,
  RouteId,
} from './types.ts';
import { getCity } from './world.ts';
import type { Conditions } from './conditions.ts';
import { conditionsFor, klassesOf } from './conditions.ts';
import { CONSTANTS } from './world.ts';
import { distanceKm } from './geo.ts';
import { interestRate } from './market.ts';
import {
  attractiveness, competitionFareMultiplier, expectedLoad, fareOneWay, incumbentStrength,
  marketDemandWeekly, priceStimulation,
} from './demand.ts';
import {
  ageYears,
  canReach,
  getAircraftType,
  legBlockHours,
  maintenancePerBlockHour,
  makerCostMultiplier,
  rotationsPerWeek,
} from './fleet.ts';

const WEEKS_PER_QUARTER = 13;
/**
 * Shared so the tech-effect memo in conditions.ts keeps hitting its cache.
 * Never written to — it is only ever read through `conditionsFor`.
 */
const NO_TECH: string[] = [];
const MONTHS_PER_QUARTER = 3;

/**
 * Seats an aircraft carries under a given posture. A premium cabin takes space
 * away from economy; a high-density fit puts it back. This is what stops premium
 * being free money on a sold-out sector: you are selling dearer seats, but fewer
 * of them.
 */
export function seatsUnder(type: { readonly seats: number }, posture: PricingPosture): number {
  return type.seats * CONSTANTS.posture.seats[posture];
}

/** Round trips per week the given tails can fly on a sector of `dist` km. */
export function frequencyWeekly(assigned: readonly Aircraft[], dist: number): number {
  let frequency = 0;
  for (const tail of assigned) {
    const type = getAircraftType(tail.typeId);
    if (canReach(type, dist)) frequency += rotationsPerWeek(type, dist);
  }
  return frequency;
}

/**
 * Rotation-weighted average seats per departure, under the route's posture. This
 * is the gauge the S-curve share reads; a mixed fleet averages by how often each
 * type flies. Returns 0 when nothing can reach, which scores as no presence.
 */
export function seatsPerDepartureOf(
  assigned: readonly Aircraft[],
  dist: number,
  posture: PricingPosture,
): number {
  let rotations = 0;
  let seatRotations = 0;
  for (const tail of assigned) {
    const type = getAircraftType(tail.typeId);
    if (!canReach(type, dist)) continue;
    const r = rotationsPerWeek(type, dist);
    rotations += r;
    seatRotations += r * seatsUnder(type, posture);
  }
  return rotations > 0 ? seatRotations / rotations : 0;
}

/**
 * What one seat-km of this type's hold earns in freight.
 *
 * Keyed on class rather than per type: hold volume tracks the airframe class
 * closely enough, and a per-aircraft number would be a dozen more figures to
 * justify for no decision the player makes differently.
 */
export function cargoRatePerSeatKm(type: AircraftType): number {
  const rates = CONSTANTS.cargo.revenuePerSeatKm as Record<string, number>;
  return rates[type.klass] ?? 0;
}

/** Unordered key for a city pair — a market is a pair, not a direction. */
export function marketKey(from: string, to: string): string {
  return from < to ? `${from}-${to}` : `${to}-${from}`;
}

/** Every carrier's presence, keyed by city pair. */
export type MarketIndex = Map<string, MarketPresence[]>;

/** One carrier's presence on a market. */
export interface MarketPresence {
  readonly carrierId: CarrierId;
  readonly routeId: RouteId;
  readonly attractiveness: number;
  /** Scheduled one-way seats/week — the supply this carrier puts on the market,
   *  which drives how far it erodes everyone's monopoly fare premium. */
  readonly capacityWeekly: number;
}

/**
 * Who is flying what, keyed by city pair. Built once per settlement so each
 * route can be priced against the rivals actually sharing its market.
 */
export function buildMarketIndex(state: GameState): MarketIndex {
  // Group the whole world's tails by route in one pass. Filtering each carrier's
  // fleet per route instead makes this O(routes x fleet), and it is rebuilt many
  // times a turn.
  const byRoute = new Map<RouteId, Aircraft[]>();
  const solvent = new Map<CarrierId, boolean>();
  // Each carrier's route count by city, so the hub-feed bonus is O(1) per route
  // rather than a scan of the whole world per route.
  const cityCount = new Map<CarrierId, Map<CityId, number>>();
  for (const carrier of state.carriers) {
    solvent.set(carrier.id, carrier.bankruptTurn === null);
    for (const tail of carrier.fleet) {
      if (tail.routeId === null) continue;
      // An ordered tail earmarked for a route is not on the market until it
      // arrives — the same rule the settlement applies (see computeRouteEconomics).
      // Counting it here let a carrier take share, and erode everyone's fare
      // premium, with metal that does not exist yet.
      if (state.turn < tail.deliversTurn) continue;
      const list = byRoute.get(tail.routeId);
      if (list) list.push(tail);
      else byRoute.set(tail.routeId, [tail]);
    }
  }
  for (const route of state.routes) {
    const counts = cityCount.get(route.carrierId) ?? new Map<CityId, number>();
    counts.set(route.from, (counts.get(route.from) ?? 0) + 1);
    counts.set(route.to, (counts.get(route.to) ?? 0) + 1);
    cityCount.set(route.carrierId, counts);
  }

  const index = new Map<string, MarketPresence[]>();
  for (const route of state.routes) {
    if (!solvent.get(route.carrierId)) continue;
    const assigned = byRoute.get(route.id);
    if (!assigned) continue;
    const dist = distanceKm(getCity(route.from), getCity(route.to));
    const owner = state.carriers.find((c) => c.id === route.carrierId);
    if (!owner) continue;
    const completion = conditionsFor(state, owner, route, klassesOf(assigned)).completion;
    // Same S-curve inputs the settlement uses, so a rival is scored on its gauge
    // exactly as it would be if it were the one being priced — and with the same
    // hub-feed bonus, from its OTHER routes touching these two endpoints.
    const freq = frequencyWeekly(assigned, dist);
    const seatsPerDep = seatsPerDepartureOf(assigned, dist, route.posture);
    const counts = cityCount.get(route.carrierId);
    const connections = counts ? (counts.get(route.from) ?? 1) - 1 + ((counts.get(route.to) ?? 1) - 1) : 0;
    const score = attractiveness(freq * completion, route.posture, seatsPerDep) * feedMultiplier(connections);
    if (score <= 0) continue;
    // Scheduled one-way weekly seats: freq round trips, one departure each way.
    const capacityWeekly = freq * seatsPerDep;
    const key = marketKey(route.from, route.to);
    const presence = { carrierId: route.carrierId, routeId: route.id, attractiveness: score, capacityWeekly };
    const list = index.get(key);
    if (list) list.push(presence);
    else index.set(key, [presence]);
  }
  return index;
}

/**
 * Per-carrier city tallies for a whole board, built once and read many times.
 *
 * `feedFactor` and `stationOverheadFor` both answer "how many of this carrier's
 * sectors touch this city", and both did it by scanning every route in the world on
 * every call. That is O(routes) per question inside loops that ask it per route, per
 * posture and per aircraft type — so the cost grows with the SQUARE of the board.
 * Invisible while rivals topped out around 130 sectors; profiled on a field of 1,131
 * they were 26% and 7% of a whole game's runtime, the two largest costs in the sim
 * by a wide margin.
 *
 * The settlement already avoided this — `computeCarrierQuarter` tallies its own
 * carrier's cities once and does O(1) lookups — and this is the same trick made
 * shareable, so the AI's planning path stops paying a scan per question.
 */
export interface NetworkTally {
  /** carrier -> city -> how many of its sectors touch that city. */
  readonly cities: Map<CarrierId, Map<CityId, number>>;
  /** Every route id on the board, so "is this one already counted?" is O(1) too. */
  readonly onBoard: Set<RouteId>;
}

export function buildNetworkTally(routes: readonly Route[]): NetworkTally {
  const cities = new Map<CarrierId, Map<CityId, number>>();
  const onBoard = new Set<RouteId>();
  for (const r of routes) {
    onBoard.add(r.id);
    let mine = cities.get(r.carrierId);
    if (!mine) {
      mine = new Map();
      cities.set(r.carrierId, mine);
    }
    mine.set(r.from, (mine.get(r.from) ?? 0) + 1);
    mine.set(r.to, (mine.get(r.to) ?? 0) + 1);
  }
  return { cities, onBoard };
}

/** Sectors this carrier flies touching `city`, from a prebuilt tally. */
function touching(tally: NetworkTally, carrierId: CarrierId, city: CityId): number {
  return tally.cities.get(carrierId)?.get(city) ?? 0;
}

/**
 * The hub-feed multiplier on a carrier's attractiveness, from how many connecting
 * routes it flies. `connections` is the count of the carrier's OTHER sectors that
 * touch the two endpoints, summed. Saturating, so the first feeders matter most
 * and a giant hub cannot run away.
 */
export function feedMultiplier(connections: number): number {
  const f = CONSTANTS.feed;
  return 1 + (f.maxBonus * connections) / (connections + f.halfRoutes);
}

/**
 * The feed multiplier for `carrierId` on a city pair, scored against every other
 * route it flies touching either endpoint. `selfId` excludes the sector being
 * priced so it never feeds itself; omit it for a route not yet opened (an AI probe
 * feeds off the network it already has).
 */
export function feedFactor(
  routes: readonly Route[],
  carrierId: CarrierId,
  from: CityId,
  to: CityId,
  selfId?: RouteId,
  /** Prebuilt tally; identical answer, without the scan. See `buildNetworkTally`. */
  tally?: NetworkTally,
): number {
  if (tally) {
    // The tally counts every sector including the one being priced, so a route
    // already on the board subtracts its own endpoint contribution — exactly what
    // `selfId` does in the scan, and what the settlement's `- 1` does.
    const own = selfId !== undefined && tally.onBoard.has(selfId) ? 1 : 0;
    const connections =
      Math.max(0, touching(tally, carrierId, from) - own)
      + Math.max(0, touching(tally, carrierId, to) - own);
    return feedMultiplier(connections);
  }
  let connections = 0;
  for (const r of routes) {
    if (r.carrierId !== carrierId || r.id === selfId) continue;
    if (r.from === from || r.to === from) connections += 1;
    if (r.from === to || r.to === to) connections += 1;
  }
  return feedMultiplier(connections);
}

/**
 * What it costs this carrier, one-off, to open a sector between two cities.
 *
 * A sector between two cities it already serves is cheap: the stations are
 * standing, the handling contracts are signed, the staff are on the payroll, and
 * all that is really being bought is a slot pair and some launch marketing. A
 * sector into a city it has never touched carries the whole cost of standing a
 * station up — ground equipment, a station manager and crew, spares, training,
 * and the local sales presence to fill the thing.
 *
 * This asymmetry is the arithmetic that makes a hub worth building, and without
 * it there was no reason to build one: breadth and depth both cost exactly one
 * airframe, so a carrier grew by scattering single aircraft over virgin markets
 * instead of thickening the stations it already ran. The carrier's home base is
 * always counted as served — it is where the airline lives, and charging a
 * carrier to open its own headquarters would make the first sector of a game
 * cost double for no reason a player could follow.
 */
export function openingCostFor(
  routes: readonly Route[],
  carrier: Carrier,
  from: CityId,
  to: CityId,
): number {
  const served = new Set<CityId>([carrier.homeCityId]);
  for (const r of routes) {
    if (r.carrierId !== carrier.id) continue;
    served.add(r.from);
    served.add(r.to);
  }
  const fresh = (served.has(from) ? 0 : 1) + (served.has(to) ? 0 : 1);
  return CONSTANTS.routes.openingCost + fresh * CONSTANTS.routes.newStationCost;
}

/**
 * This sector's share of the quarterly overhead at the two stations it touches.
 *
 * A station is a standing cost, not a per-route one: the manager, the staff, the
 * handling contract and the office are paid for whether one sector uses them or
 * six. So each station's cost is divided among the carrier's sectors that touch
 * it, and a route bears a share at each end. So long as every sector at a station
 * is flying, the total across a carrier's network is exactly `stationQuarterlyCost`
 * per station it operates, however the sectors are arranged — the allocation moves
 * the cost around, it does not invent or lose any.
 *
 * The exception is deliberate and worth stating, because the identity above is
 * otherwise easy to misread: the denominator counts every sector touching the
 * station, but only a sector with an in-range aircraft on it is CHARGED (the same
 * rule the per-sector fixed cost has always followed — an open sector with nothing
 * on it is a line on a map, not an operation). A carrier holding dormant sectors at
 * a station therefore under-pays for it. That is a simplification, not a subsidy
 * worth exploiting: the dormant sector earns nothing either, and the aircraft it
 * would need costs far more than the station share it would dodge.
 *
 * This is what makes density pay ONGOING rather than once. A one-off opening fee
 * is a sunk cost the moment it is paid: it can deter an opening, but it exerts no
 * pressure afterwards, and a carrier holding forty thin stations feels nothing.
 * Carried every quarter, the same sprawl is a permanent drag, and the way out of
 * it is to put more sectors through the stations you already run.
 *
 * `includesSelf` says whether `routes` already contains the sector being priced.
 * It is false only when probing a sector that does not exist yet, where the
 * prospective route still has to count itself into its own denominator — the same
 * distinction `feedFactor` draws with `selfId`, and it must match the settlement
 * or the AI plans against numbers the quarter will not charge it.
 */
export function stationOverheadFor(
  routes: readonly Route[],
  carrierId: CarrierId,
  from: CityId,
  to: CityId,
  includesSelf: boolean,
  /** Prebuilt tally; identical answer, without the scan. See `buildNetworkTally`. */
  tally?: NetworkTally,
): number {
  let atFrom = 0;
  let atTo = 0;
  if (tally) {
    atFrom = touching(tally, carrierId, from);
    atTo = touching(tally, carrierId, to);
  } else {
  for (const r of routes) {
    if (r.carrierId !== carrierId) continue;
    if (r.from === from || r.to === from) atFrom += 1;
    if (r.from === to || r.to === to) atTo += 1;
  }
  }
  if (!includesSelf) {
    atFrom += 1;
    atTo += 1;
  }
  const cost = CONSTANTS.routes.stationQuarterlyCost;
  return cost / Math.max(1, atFrom) + cost / Math.max(1, atTo);
}

/** Everyone on `route`'s market except `route` itself, for display. */
export function competitorsOf(index: MarketIndex, route: Route): MarketPresence[] {
  const list = index.get(marketKey(route.from, route.to));
  return list ? list.filter((p) => p.routeId !== route.id) : [];
}

/** One carrier's position on a shared market, for the competitive table. */
export interface MarketStanding {
  readonly carrierId: CarrierId;
  readonly routeId: RouteId;
  readonly econ: RouteEconomics;
  /** How the aircraft on this sector are held. Owned metal pays no rent, which
   *  is routinely the largest single difference between two carriers here. */
  readonly owned: number;
  readonly leased: number;
  /** Type of every tail assigned, in fleet order — a rival's gauge is readable
   *  off the departure board in reality, and it explains their seat count. */
  readonly typeIds: readonly string[];
  /**
   * What this sector would net for this carrier with none of its technology
   * delivered, everything else held equal. `econ.netCash` minus this is what
   * their programs are worth here in cash — the only honest way to answer
   * "how much is their tech actually earning them?".
   */
  readonly netWithoutTech: number;
}

/**
 * Every carrier's economics on the market `route` belongs to, richest share
 * first. Each is priced against all the others, so the shares are the ones the
 * sim will actually settle.
 */
export function marketBoard(state: GameState, index: MarketIndex, route: Route): MarketStanding[] {
  const present = index.get(marketKey(route.from, route.to)) ?? [];
  const standings: MarketStanding[] = [];

  for (const entry of present) {
    const theirRoute = state.routes.find((r) => r.id === entry.routeId);
    const carrier = state.carriers.find((c) => c.id === entry.carrierId);
    if (!theirRoute || !carrier) continue;
    let others = 0;
    let rivalCap = 0;
    for (const p of present) {
      if (p.routeId === entry.routeId) continue;
      others += p.attractiveness;
      rivalCap += p.capacityWeekly;
    }
    const assigned = assignedTo(carrier, entry.routeId);
    const klasses = klassesOf(assigned);
    const feed = feedFactor(state.routes, carrier.id, theirRoute.from, theirRoute.to, theirRoute.id);
    // This table stands beside the sector's own P&L, so it has to be priced the
    // identical way: same feed, same station share. Omitting the station share here
    // put a different net in the two panels for the same sector, which is exactly
    // how the mismatch was found.
    const station = stationOverheadFor(state.routes, carrier.id, theirRoute.from, theirRoute.to, true);
    // The same sector for the same carrier with its technology taken away. Both
    // are priced against the same `others`, so the difference is the technology
    // and nothing else.
    const bare = computeRouteEconomics(
      theirRoute, assigned, state.turn,
      conditionsFor(state, { ...carrier, tech: NO_TECH }, theirRoute, klasses), others, rivalCap, feed,
      station,
    );
    standings.push({
      carrierId: entry.carrierId,
      routeId: entry.routeId,
      owned: assigned.filter((a) => a.ownership === 'owned').length,
      leased: assigned.filter((a) => a.ownership === 'leased').length,
      typeIds: assigned.map((a) => a.typeId),
      netWithoutTech: bare.netCash,
      econ: computeRouteEconomics(
        theirRoute, assigned, state.turn,
        conditionsFor(state, carrier, theirRoute, klasses), others, rivalCap, feed, station,
      ),
    });
  }
  return standings.sort((a, b) => b.econ.demandShare - a.econ.demandShare);
}

/**
 * What a carrier's technology is worth across its whole network, per quarter.
 *
 * Every sector priced twice — once as it stands, once with the same fleet and
 * the same rivals but no programs delivered — and the difference summed. This is
 * the company-level answer to "what is the investment returning?", and it is the
 * only honest one: the effects are multiplicative across revenue and four cost
 * lines, so no player can compound them by hand.
 */
export function technologyValue(
  state: GameState,
  index: MarketIndex,
  carrier: Carrier,
): number {
  if (carrier.tech.length === 0) return 0;
  const stripped = { ...carrier, tech: NO_TECH };
  let delta = 0;
  for (const route of state.routes) {
    if (route.carrierId !== carrier.id) continue;
    const assigned = assignedTo(carrier, route.id);
    if (assigned.length === 0) continue;
    const klasses = klassesOf(assigned);
    const others = rivalsOf(index, route);
    const rivalCap = rivalCapacityOf(index, route);
    const feed = feedFactor(state.routes, carrier.id, route.from, route.to, route.id);
    // Cancels between the two prices — technology does not move station overhead —
    // so this changes no answer. Passed anyway: an inconsistent call site is how the
    // next person inherits the bug this parameter has already caused once.
    const station = stationOverheadFor(state.routes, carrier.id, route.from, route.to, true);
    const asIs = computeRouteEconomics(
      route, assigned, state.turn, conditionsFor(state, carrier, route, klasses), others, rivalCap, feed,
      station,
    );
    const bare = computeRouteEconomics(
      route, assigned, state.turn, conditionsFor(state, stripped, route, klasses), others, rivalCap, feed,
      station,
    );
    delta += asIs.netCash - bare.netCash;
  }
  return delta;
}

/** Summed attractiveness of everyone on `route`'s market except `route` itself. */
export function rivalsOf(index: MarketIndex, route: Route): number {
  const list = index.get(marketKey(route.from, route.to));
  if (!list) return 0;
  let total = 0;
  for (const p of list) if (p.routeId !== route.id) total += p.attractiveness;
  return total;
}

/** Scheduled one-way seats/week everyone else puts on `route`'s market — the
 *  competitive supply that erodes its monopoly fare premium. */
export function rivalCapacityOf(index: MarketIndex, route: Route): number {
  const list = index.get(marketKey(route.from, route.to));
  if (!list) return 0;
  let total = 0;
  for (const p of list) if (p.routeId !== route.id) total += p.capacityWeekly;
  return total;
}

/**
 * Full economics for one route in one quarter, given the tails assigned to it.
 * Out-of-range tails contribute nothing (the assign action blocks them, but a
 * hand-edited save could still contain one).
 *
 * @param rivalCapacityWeekly ONE-WAY seats/week everyone else schedules on this
 * market, as `rivalCapacityOf` reports it — the same convention as the internal
 * `capacity`, and NOT the round-trip `capacityWeekly` this function returns.
 * Weighing it against a route total silently halves every rival; see the note at
 * `rivalCapShare`.
 */
export function computeRouteEconomics(
  route: Route,
  assigned: readonly Aircraft[],
  turn: number,
  conditions: Conditions,
  rivalAttractiveness = 0,
  rivalCapacityWeekly = 0,
  feedFactor = 1,
  /** This sector's share of its two stations' quarterly overhead. */
  stationOverhead = 0,
): RouteEconomics {
  const { fuelPrice } = conditions;
  const from = getCity(route.from);
  const to = getCity(route.to);
  const dist = distanceKm(from, to);

  let frequency = 0; // round trips/week
  let capacity = 0; // one-way seats/week
  let blockHoursWeekly = 0;
  let kmWeekly = 0;
  let handlingWeekly = 0;
  let cargoWeekly = 0;
  let fuelWeekly = 0;
  let maintWeekly = 0;
  let crewWeekly = 0;
  let leaseQuarter = 0;
  let ownershipQuarter = 0;
  let standingQuarter = 0;
  let activeTails = 0;

  for (const tail of assigned) {
    // An ordered aircraft not yet delivered flies nothing and costs nothing on
    // the route until it arrives — you can earmark it, but it is not in service.
    if (turn < tail.deliversTurn) continue;
    const type = getAircraftType(tail.typeId);

    // Standing, lease and ownership are owed on an assigned tail whether or not
    // it can reach — it is still on the books against this route.
    standingQuarter += CONSTANTS.fleet.standingCostPerSeatQuarter * type.seats;
    if (tail.ownership === 'leased') {
      leaseQuarter += type.leaseMonthly * MONTHS_PER_QUARTER * conditions.leaseCost;
    } else {
      // Owned metal is not free here: it depreciates. Charged on book value, the
      // same figure the balance sheet writes down each quarter — the owned-jet
      // counterpart to the rent a leased one pays, exactly as a real income
      // statement carries a Depreciation line. Non-cash (the purchase was paid up
      // front), so it stays out of netCash and away from bankruptcy.
      ownershipQuarter += tail.bookValue * CONSTANTS.fleet.depreciationPerQuarter;
    }

    if (!canReach(type, dist)) continue;
    activeTails += 1;

    const r = rotationsPerWeek(type, dist);
    const leg = legBlockHours(type, dist);
    // Cancellations take seats out of the schedule. This is the one shock that
    // reaches a sold-out sector: a demand shock on a spilling route just spills
    // less, but a grounded aircraft cannot carry anyone.
    const flown = r * conditions.completion;
    const seats = seatsUnder(type, route.posture);
    frequency += flown;
    capacity += flown * seats;
    blockHoursWeekly += 2 * flown * leg;
    kmWeekly += 2 * flown * dist;
    fuelWeekly += 2 * flown * dist * type.fuelBurnLPerKm * fuelPrice;
    // Belly freight, on the type's BASE gauge: a premium cabin takes space out of
    // the cabin, not out of the hold, so posture must not move this.
    cargoWeekly += 2 * flown * dist * type.seats * cargoRatePerSeatKm(type);
    handlingWeekly +=
      2 * flown * (CONSTANTS.fleet.handlingPerDeparture + CONSTANTS.fleet.handlingPerSeat * seats);
    // Flying outside the carrier's own shop costs more to crew and maintain:
    // a second type rating, a second spares pool, a second set of procedures.
    const shop = makerCostMultiplier(type, conditions.preferredMaker);
    maintWeekly += 2 * flown * leg * maintenancePerBlockHour(type, ageYears(tail, turn)) * shop;
    crewWeekly += 2 * flown * leg * type.crewPerBlockHour * shop;
  }

  // Crew and ground handling are bought locally, so they track the economic
  // weight of the cities served. Fuel and lease rates are world prices.
  const costWeight = (from.weight * to.weight) ** (CONSTANTS.fleet.costWeightExponent / 2);

  const market = marketDemandWeekly(from, to) * conditions.demand;
  // Seats per departure feeds the S-curve share; completion cancels out of the
  // ratio, so this is just the rotation-weighted average gauge on the sector.
  const seatsPerDeparture = frequency > 0 ? capacity / frequency : 0;
  // The carrier's own draw, lifted by whatever hub feed the caller measured from
  // its network. Rivals' feed is already baked into rivalAttractiveness.
  const ownAttractiveness =
    attractiveness(frequency, route.posture, seatsPerDeparture) * feedFactor;
  // Own share and rivals' share come out of the SAME denominator, so the incumbent
  // term — which costs a pow — is computed once and both are read off it. Calling
  // demandShare twice did the pow twice, on the hottest path in the sim.
  const contenders = ownAttractiveness + rivalAttractiveness + incumbentStrength(market);
  const share = contenders > 0 ? ownAttractiveness / contenders : 0;
  const rivalShare = contenders > 0 ? rivalAttractiveness / contenders : 0;
  // Price elasticity: the carrier's own posture stimulates or suppresses the
  // demand it converts, tuned by how leisure the route is. New traffic the
  // discounter captures — it does not come out of rivals' shares.
  const directedOneWay = market * share * priceStimulation(from, to, route.posture);
  // Even a sector turning traffic away cannot sell its last seats. How close a
  // carrier gets is something it can improve — see Conditions.loadCeiling.
  //
  // Clamped here as well as in conditionsFor: this function is called directly
  // by the AI probes and by tests, and a load factor above 1 would mean selling
  // seats that do not exist.
  // Overcapacity bites load, not only fare: the more seats rivals throw at a
  // market, the emptier everyone's planes fly. A monopoly route fills to the
  // ceiling; a contested one cannot, however big the market is — which is what
  // finally makes a competitor's entry felt on a trunk route the incumbent would
  // otherwise fill from spill alone.
  // Both figures ONE-WAY. `rivalCapacityOf` reports one-way seats — the same
  // convention as `capacity` — so it must not be weighed against `2 * capacity`,
  // which is the route total. It was, and it halved every rival: two identical
  // carriers on a sector gave a rival capacity share of 0.333 instead of 0.500.
  // (`capacityWeekly` means one-way in the market index and round-trip in the
  // struct this function returns. That is the trap; hence the spelt-out units.)
  const rivalCapShare =
    rivalCapacityWeekly > 0 ? rivalCapacityWeekly / (capacity + rivalCapacityWeekly) : 0;
  /*
   * ...but it is OVERCAPACITY that empties aeroplanes, not company.
   *
   * Scaling the penalty on rival presence alone made every market a duopoly at
   * best: measured, 97.9% of served markets ended a game with exactly ONE carrier
   * and none ever held three. On a pair like Tokyo–Osaka, with 434,000 passengers
   * a week wanting to travel, carriers were penalised as though they were
   * scrapping over the last few seats — so nobody joined, and the richest markets
   * on the map went unflown.
   *
   * Saturation is how much of the market's demand the industry's seats actually
   * cover. Where it is well under 1 there is unmet demand and another carrier
   * costs the incumbents little; at 1 the market is oversupplied and the full
   * penalty applies, which is the effect this was written for.
   *
   * KNOWN COST, measured and accepted: this flattens load factor further — the
   * p75-p25 spread falls from 2.9 points to about 1.5, because a contested sector
   * on a roomy market now returns to the ceiling. That is the same flatness
   * docs/demand-audit.md is about, and its real fix is P1 (redistributing spill
   * instead of deleting it), which is gated on the owner. A square root was tried
   * to soften it and gave back most of the competition instead — see DECISIONS.md.
   */
  // One-way throughout, for the reason given at `rivalCapShare`: mixing the
  // route total for our seats with the one-way figure for everyone else's made
  // rival capacity count half, so a market looked half as supplied as it was.
  const industryCapacityOneWay = capacity + rivalCapacityWeekly;
  const saturation = market > 0 ? Math.min(1, industryCapacityOneWay / market) : 1;
  const contestedCeiling =
    conditions.loadCeiling * (1 - conditions.competitionLoadPenalty * rivalCapShare * saturation);
  const ceiling = Math.max(0, Math.min(1, contestedCeiling));
  /*
   * P1: a passenger a carrier wins and cannot seat does NOT evaporate.
   *
   * The market used to clear each route in isolation and throw the remainder away:
   * 42% of all won demand was won, turned away, and deleted from the world. That
   * made being under-capacity free — nobody gained from your shortfall and you lost
   * only the fare — so the profit-maximal build always sat under demand and load
   * factor pinned to the ceiling on 88% of sector-quarters.
   *
   * Now the traffic re-books with whoever has room, which is what a passenger
   * actually does. Two consequences, both wanted: a carrier that leaves room on a
   * busy market picks up its rivals' overflow and fills up, and a carrier that
   * under-builds hands its own overflow to the competition. `share.spillCapture`
   * is how much of a turned-away passenger re-books at all rather than not
   * travelling — the rest is genuinely lost demand, as it is in life.
   */
  const rivalWonOneWay = market * rivalShare;
  // Rivals spill on the SAME curve we do. Left as a hard clamp, a rival turned
  // nobody away until it was literally full, so it handed over its overflow only
  // in the rare sold-out case — while we were busy modelling our own spill as
  // continuous. At a demand factor of 1, which is the median sector, the true
  // figure is ~14% of what they win and the clamp said zero, so there was almost
  // nothing to re-book and `share.spillCapture` had little to act on.
  const rivalSeatsOneWay = rivalCapacityWeekly * ceiling;
  const rivalSpillOneWay = Math.max(
    0,
    rivalWonOneWay - expectedLoad(rivalWonOneWay, rivalSeatsOneWay, conditions.kFactor),
  );
  const ownRoomOneWay = Math.max(0, capacity * ceiling - directedOneWay);
  const absorbedOneWay = Math.min(ownRoomOneWay, rivalSpillOneWay * CONSTANTS.share.spillCapture);

  /*
   * Load is what the seats actually carry against an UNCERTAIN demand — the
   * Boeing spill model — not a clamp against a ceiling constant.
   *
   * The ceiling still applies on top, and MEASUREMENT SAYS IT MUST. The research
   * note predicted the spill curve would make `maxLoadFactor` redundant; removing
   * it was tried and gave a median load factor of 96.0% against a published
   * industry 82-84%, because carriers size to demand and land where the spill
   * curve is already flat. The two model different things and both are real:
   * the curve is variance BETWEEN departures, the ceiling is sellability WITHIN
   * one — seat mix, no-shows, the last middle seat nobody wants. Together they
   * give a median of 85.2%, which is the right neighbourhood.
   */
  const wantedOneWay = directedOneWay + absorbedOneWay;
  const paxOneWay = expectedLoad(wantedOneWay, capacity * ceiling, conditions.kFactor);
  const loadFactor = capacity > 0 ? paxOneWay / capacity : 0;
  // Everything the caller is handed is a ROUTE TOTAL — both directions, per
  // week — because that is how route traffic is quoted and because mixing the
  // two conventions in one struct is a trap. The arithmetic above is one-way;
  // these are the only numbers that leave. See RouteEconomics in types.ts.
  const paxCarriedWeekly = 2 * paxOneWay;
  const spilledWeekly = 2 * Math.max(0, wantedOneWay - paxOneWay);
  // (Own spill is what rivals see as THEIR absorbable overflow when they are priced.)
  const capacityWeekly = 2 * capacity;
  const marketWeekly = 2 * market;
  /*
   * Market structure lifts the fare on an uncontested route and erodes it as
   * capacity arrives. Both figures here are one-way, matching the function.
   *
   * Priced off the market's TOTAL scheduled capacity, not off each carrier's view
   * of everyone else. Passing `rivalCapacityWeekly` made the premium a property of
   * the CARRIER: a dominant operator saw little rival capacity, kept most of the
   * premium, and priced ABOVE a small rival on the same route even while posturing
   * undercut — which is exactly what a playtest reported on CAI-IST, and the
   * opposite of the invariant this function's own docstring claimed. A market
   * clears at one fare, so the input has to be something the whole market shares.
   */
  const competitionMultiplier = competitionFareMultiplier(capacity + rivalCapacityWeekly, market);
  const fare = fareOneWay(from, to, route.posture) * conditions.fare * competitionMultiplier;

  const departuresWeekly = 2 * frequency;
  const cargo = cargoWeekly * WEEKS_PER_QUARTER;
  const revenue = paxCarriedWeekly * fare * WEEKS_PER_QUARTER + cargo;
  const fuel = fuelWeekly * WEEKS_PER_QUARTER;
  const maintenance = maintWeekly * conditions.maintenanceCost * WEEKS_PER_QUARTER;
  const crew = crewWeekly * costWeight * conditions.crewCost * WEEKS_PER_QUARTER;
  /*
   * `handling` keeps its original grouping to the letter. Factoring the scale out and
   * adding the two halves instead — (a + b) * S rewritten as a * S + b * S — is the
   * same arithmetic but not the same floating-point result: measured over 200k
   * realistic operand pairs it differs in 35% of them, by about 1 ULP. Tiny, except
   * that this feeds netCash, netCash feeds AI thresholds, and the sim promises the
   * same seed plays the same way. The pax half is therefore computed as its own
   * product beside the original rather than by restructuring it.
   */
  const paxHandlingWeekly =
    paxCarriedWeekly *
    CONSTANTS.fleet.distributionPerPax *
    CONSTANTS.posture.paxCost[route.posture];
  const handling =
    (handlingWeekly + paxHandlingWeekly) *
    costWeight *
    conditions.handlingCost *
    WEEKS_PER_QUARTER;
  const handlingPax =
    paxHandlingWeekly * costWeight * conditions.handlingCost * WEEKS_PER_QUARTER;
  // Only a sector actually being flown carries station cost — an open sector with
  // nothing on it is a line on a map, not an operation. `stationOverhead` is this
  // route's share of the two standing stations; `quarterlyFixedCost` is what the
  // sector itself costs on top of them (its slot pair, its own local selling).
  const fixed = activeTails > 0 ? CONSTANTS.routes.quarterlyFixedCost + stationOverhead : 0;

  // Head office rides on everything the sector spends flying.
  const overhead =
    (fuel + crew + maintenance + handling + leaseQuarter + standingQuarter + fixed) *
    CONSTANTS.fleet.overheadRate;

  // Cash flow: what the route puts in or takes out of the bank. Owned metal
  // charges nothing here — it was paid for up front — so this is unchanged, and
  // it is the figure the company settles on and bankruptcy keys off.
  const netCash =
    revenue - fuel - crew - maintenance - handling - leaseQuarter - standingQuarter - fixed - overhead;
  // Economic contribution: cash flow after the cost of the capital the owned
  // aircraft tie up. This is what the sector is really worth, and it is what the
  // dossier shows, so an owned trunk route stops reading as free money and
  // lease-vs-buy is an even comparison. Never touches cash.
  const netEconomic = netCash - ownershipQuarter;

  return {
    distanceKm: dist,
    aircraftCount: assigned.length,
    marketDemandWeekly: marketWeekly,
    frequencyWeekly: frequency,
    departuresWeekly,
    capacityWeekly,
    demandShare: share,
    paxCarriedWeekly,
    loadFactor,
    loadCeiling: ceiling,
    spilledWeekly,
    fareOneWay: fare,
    competitionMultiplier,
    revenue,
    cargo,
    fuel,
    crew,
    maintenance,
    handling,
    handlingPax,
    lease: leaseQuarter,
    ownership: ownershipQuarter,
    standing: standingQuarter,
    fixed,
    overhead,
    netCash,
    netEconomic,
  };
}

/**
 * The load factor at which a sector's cash flow reaches zero.
 *
 * Read against `loadCeiling`, this is the whole judgement on a sector: below the
 * ceiling it can pay, above it cannot, and how far above says how badly. It is
 * scale-free, so a turboprop on a 300km hop and a widebody on a transatlantic are
 * directly comparable, and it explains itself in a way a dollar forecast does not —
 * "you would need to sell three times your seats" is a verdict with its reasoning
 * attached.
 *
 * Derived entirely from what `computeRouteEconomics` already returned, so it cannot
 * drift from the model it describes. Costs divide in two: the per-passenger half of
 * handling (plus the overhead riding on it) moves with load, and everything else —
 * fuel, crew, maintenance, lease, standing, station — follows capacity and frequency,
 * which load does not move. Cargo is subtracted from what must be covered, because
 * the hold earns whether or not the cabin fills.
 *
 * Returns null when nothing is flying, or when the fare does not cover the cost of
 * carrying one more passenger — at which point no load covers the fixed costs either
 * and the honest answer is "not at any load", not a number above 1.
 *
 * Can also return a *negative* number: when the hold (`cargo`) alone covers the
 * sector's fixed costs, the passenger cabin is profitable before a single seat
 * sells, and the arithmetic that finds "where costs are covered" lands below zero
 * load. That is meaningful, not a bug — callers must treat any result `<= 0` as
 * "pays before a passenger boards" rather than assuming breakeven is unreachable
 * or rendering a nonsensical negative percentage.
 *
 * `posture` (renamed `_posture` below) is not read by the formula — `handlingPax`
 * already carries the posture's pricing multiplier — but it is kept as a required
 * parameter deliberately: it documents that the returned figure is specific to the
 * posture `econ` was priced under, and it forces callers to state that posture
 * explicitly rather than reuse a breakeven number across postures by accident.
 */
export function breakevenLoad(
  econ: RouteEconomics,
  _posture: PricingPosture,
): number | null {
  if (econ.capacityWeekly <= 0 || econ.loadFactor <= 0) return null;

  const overhead = 1 + CONSTANTS.fleet.overheadRate;
  // The pax half, grossed up for the head-office uplift charged on top of it.
  const paxCost = econ.handlingPax * overhead;
  const fares = econ.revenue - econ.cargo;

  // Earned per unit of load, net of what carrying those passengers costs.
  const contributionPerLoad = (fares - paxCost) / econ.loadFactor;
  if (contributionPerLoad <= 0) return null;

  const allCosts = econ.fuel + econ.crew + econ.maintenance + econ.handling
    + econ.lease + econ.standing + econ.fixed + econ.overhead;
  const fixedCosts = allCosts - paxCost;

  return (fixedCosts - econ.cargo) / contributionPerLoad;
}

/** Tails a route is flying, pulled from the carrier's fleet. */
export function assignedTo(carrier: Carrier, routeId: string): Aircraft[] {
  return carrier.fleet.filter((a) => a.routeId === routeId);
}

/** Quarterly lease + standing cost of a parked tail — it earns nothing. */
export function idleCost(tail: Aircraft): { lease: number; standing: number } {
  const type = getAircraftType(tail.typeId);
  const standing = CONSTANTS.fleet.standingCostPerSeatQuarter * type.seats;
  const lease = tail.ownership === 'leased' ? type.leaseMonthly * MONTHS_PER_QUARTER : 0;
  return { lease, standing };
}

/**
 * Settle a full quarter for one carrier: every route plus the idle-fleet drag,
 * summed into a cash P&L. Deterministic given `demandFor`, which the engine uses
 * to inject per-route seeded noise.
 */
export function computeCarrierQuarter(
  carrier: Carrier,
  routes: readonly Route[],
  state: GameState,
  demandShockFor: (route: Route) => number,
  index?: MarketIndex,
): Omit<QuarterResult, 'cashAfter'> {
  const turn = state.turn;
  let revenue = 0;
  let fuel = 0;
  let crew = 0;
  let maintenance = 0;
  let handling = 0;
  let lease = 0;
  let standing = 0;
  let fixed = 0;
  let overhead = 0;

  // This carrier's route count by city, so the hub-feed bonus on each of its
  // sectors is O(1) rather than a scan of its whole network per route.
  const cityCount = new Map<CityId, number>();
  for (const route of routes) {
    if (route.carrierId !== carrier.id) continue;
    cityCount.set(route.from, (cityCount.get(route.from) ?? 0) + 1);
    cityCount.set(route.to, (cityCount.get(route.to) ?? 0) + 1);
  }

  for (const route of routes) {
    if (route.carrierId !== carrier.id) continue;
    const assigned = assignedTo(carrier, route.id);
    const base = conditionsFor(state, carrier, route, klassesOf(assigned));
    const feed = feedMultiplier(((cityCount.get(route.from) ?? 1) - 1) + ((cityCount.get(route.to) ?? 1) - 1));
    // Off the same tally as the feed bonus, so this stays O(1) per sector rather
    // than rescanning the network. Identical to `stationOverheadFor` with the
    // route counted in — pinned by the cross-layer test in appraisal.test.ts.
    const stationCost = CONSTANTS.routes.stationQuarterlyCost;
    const stationOverhead =
      stationCost / Math.max(1, cityCount.get(route.from) ?? 1) +
      stationCost / Math.max(1, cityCount.get(route.to) ?? 1);
    const econ = computeRouteEconomics(
      route,
      assigned,
      turn,
      { ...base, demand: base.demand * demandShockFor(route) },
      index ? rivalsOf(index, route) : 0,
      index ? rivalCapacityOf(index, route) : 0,
      feed,
      stationOverhead,
    );
    revenue += econ.revenue;
    fuel += econ.fuel;
    crew += econ.crew;
    maintenance += econ.maintenance;
    handling += econ.handling;
    lease += econ.lease;
    standing += econ.standing;
    fixed += econ.fixed;
    overhead += econ.overhead;
  }

  // Parked tails still cost lease and standing, and head office still rides on them.
  // An ordered tail not yet delivered costs nothing until it arrives.
  for (const tail of carrier.fleet) {
    if (tail.routeId !== null) continue;
    if (turn < tail.deliversTurn) continue;
    const cost = idleCost(tail);
    lease += cost.lease;
    standing += cost.standing;
    overhead += (cost.lease + cost.standing) * CONSTANTS.fleet.overheadRate;
  }

  // Merging two airlines is messy: for a stretch after an acquisition the
  // combined carrier's running costs are lifted, which is the risk that stops
  // acquisitions being free money.
  if (carrier.integrationUntil !== null && turn < carrier.integrationUntil) {
    const drag = (fuel + crew + maintenance + handling) * CONSTANTS.finance.integrationDrag;
    overhead += drag;
  }

  const operating =
    revenue - fuel - crew - maintenance - handling - lease - standing - fixed - overhead;
  // Debt is serviced below the operating line, and interest shields tax.
  const interest = carrier.debt * interestRate(state, carrier);
  const preTax = operating - interest;
  // Tax only bites a profitable quarter. No loss carry-forward yet.
  const tax = preTax > 0 ? preTax * CONSTANTS.game.corporateTaxRate : 0;

  return {
    turn, carrierId: carrier.id, revenue, fuel, crew, maintenance, handling,
    lease, standing, fixed, overhead, interest, tax, netIncome: preTax - tax,
  };
}
