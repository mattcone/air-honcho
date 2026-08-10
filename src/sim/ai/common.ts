/**
 * Shared machinery for every AI carrier, player fixture and rival alike.
 *
 * All of it works by probing the sim's own `computeRouteEconomics` — an AI never
 * gets private information or a private model. What it can see, the player can
 * see in the sector dossier. Crucially the probes include the rivals already on
 * a market, so carriers respond to each other rather than to a static world.
 */
import type { Aircraft, CarrierId, CityId, GameState, PricingPosture, Route } from '../types.ts';
import { applyAction, getCarrier } from '../engine.ts';
import type { Rng } from '../rng.ts';
import { CITIES, CONSTANTS, cityDistanceKm, difficultyMods, getCity } from '../world.ts';
import { AIRCRAFT_TYPES, aircraftAvailable, canReach, preferredMaker, rotationsPerWeek } from '../fleet.ts';
import type { AircraftType } from '../types.ts';
import { marketDemandWeekly } from '../demand.ts';
import { TECH_NODES, techStatus } from '../tech.ts';
import { appraisalConditionsFor, conditionsFor, klassesOf, marketFuelPrice } from '../conditions.ts';
import { borrowingCapacity, dominancePressure, trailingEarnings } from '../market.ts';
import {
  assignedTo,
  buildMarketIndex,
  computeRouteEconomics,
  feedFactor,
  buildNetworkTally,
  marketKey,
  openingCostFor,
  stationOverheadFor,
  type NetworkTally,
  rivalCapacityOf,
  rivalsOf,
  type MarketPresence,
} from '../economics.ts';

/** The knobs every AI brain reads. Both stubAi and the archetypes satisfy this. */
export interface AiConfig {
  readonly minSectorKm: number;
  readonly maxSectorKm: number;
  readonly candidatePool: number;
  readonly minProjectedNetPerQuarter: number;
  readonly reserveCash: number;
  readonly expandAboveCash: number;
  readonly renewAgeYears: number;
  readonly posture?: PricingPosture;
  /** The band this carrier shops within. Absent = just `posture`, or all five. */
  readonly postures?: readonly PricingPosture[];
  readonly fortressHub?: boolean;
  /**
   * Wants its hub to ITSELF, not merely to fly from it. Bends new-sector scoring
   * toward its own cities, drives it to contest anyone else who lands there, and
   * lets it price up once it holds most of the place. `fortressHub` is a network
   * shape; this is an ambition.
   */
  readonly cornerHub?: boolean;
  readonly preferOwn?: boolean;
  readonly avoidArchetypes?: readonly string[];
  readonly incursionAppetite?: number;
  readonly growthDrag?: number;
  readonly playerFocus?: number;
  /** Whether this carrier will build controlling stakes and buy rivals outright. */
  readonly acquisitive?: boolean;
  /**
   * How readily it opens a new acquisition campaign, as a multiplier on the base
   * deal rate. The roll-up (1) hunts constantly; a legacy or flag carrier (~0.4-0.5)
   * buys a weak bolt-on only now and then. Absent = 1.
   */
  readonly acquisitionAppetite?: number;
  /**
   * Quarters this carrier appraises an investment over. Absent = the shared
   * `ai.appraisalQuarters`. Per-archetype so a planning horizon can be given to one
   * carrier and withheld from another — which is how `npm run tune` measures
   * whether looking through the cycle actually wins, rather than assuming it does.
   */
  readonly appraisalQuarters?: number;
  /**
   * Multiplier on the aircraft size this carrier aims for. 1 (or absent) sizes
   * the fleet correctly; away from 1 it flies the wrong-sized aircraft, which is
   * what keeps rivals from all choosing the same optimal type.
   */
  readonly gaugeBias?: number;
  /** Cap on hubs considered when opening. Point-to-point carriers serve dozens
   *  of cities; searching from every one of them costs far more than it buys. */
  readonly maxOrigins: number;
  /** Cap on rival markets examined for an incursion, richest first. */
  readonly incursionShortlist: number;
  /**
   * Which technology this carrier is the sort of airline to buy. Without it
   * every rival funded the cheapest available program every quarter and, over a
   * hundred of them, ended the game holding an identical tree — see DECISIONS.md.
   */
  readonly tech?: TechAppetite;
}

export interface TechAppetite {
  /** Never funded, whatever the cash position. */
  readonly avoid: readonly string[];
  /** Funded first, in this order. */
  readonly prefer: readonly string[];
  /** Share of the nodes it does not avoid that it will ever pursue. */
  readonly appetite: number;
}

export type Index = Map<string, MarketPresence[]>;

/*
 * The board's city tallies, cached on the routes array itself.
 *
 * `feedFactor` and `stationOverheadFor` are asked their question once per route,
 * per posture and per aircraft type inside the planning loops, and each answer used
 * to cost a scan of every route in the world — 26% and 7% of a whole game's runtime
 * when profiled on a large field, the two biggest costs in the sim. The settlement
 * already avoided it by tallying once; this gives the AI the same thing.
 *
 * Keyed on array IDENTITY rather than contents. `clone()` replaces `routes`
 * wholesale whenever anything about them changes, so a stale tally cannot outlive
 * the board it describes — and if that ever stops being true, this cache is the
 * first thing to suspect.
 */
let tallyRoutes: readonly Route[] | null = null;
let tallyCache: NetworkTally | null = null;

function tallyFor(state: GameState): NetworkTally {
  if (tallyRoutes !== state.routes || tallyCache === null) {
    tallyRoutes = state.routes;
    tallyCache = buildNetworkTally(state.routes);
  }
  return tallyCache;
}

export function marketIndex(state: GameState): Index {
  return buildMarketIndex(state);
}

/**
 * The handful of gauges worth pricing on a sector: those whose weekly capacity
 * lands nearest the traffic the carrier could plausibly capture.
 *
 * Pricing all fifteen types on every candidate market is the dominant cost of a
 * turn, and the winner is essentially always one of the nearest few by size —
 * an aircraft twice or half the right gauge never wins on either count.
 */
const TYPE_SHORTLIST = 5;
/**
 * A carrier that plans its fleet poorly does not just aim at the wrong gauge —
 * it considers fewer alternatives, so its wrong target actually sticks. A sharp
 * planner (bias near 1) still weighs the full shortlist and lands on the right
 * aircraft, which keeps the player fixture and good rivals near-optimal.
 */
const BIASED_SHORTLIST = 3;
const SHARP_BIAS_BAND = 0.15;

/**
 * Rough share a carrier assumes it can win when sizing an aircraft. Only used to
 * decide which gauges are worth pricing properly — the real share comes out of
 * the economics.
 */
const ASSUMED_SHARE = 0.3;

/**
 * How much further from the ideal gauge a type from outside the carrier's own
 * manufacturer is treated as being, when the shortlist is drawn up. Only orders
 * the shortlist — the economics downstream still decide the winner.
 */
const OFF_SHOP_GAUGE_BIAS = 1.25;

export function candidateTypes(
  state: GameState,
  dist: number,
  market: number,
  existingCapacity: number,
  gaugeBias = 1,
  /** The manufacturer this carrier is built around, if any. */
  preferred: string | null = null,
): AircraftType[] {
  // A carrier's fleet-planning bias skews the capacity it aims for, so a poor
  // planner shortlists the wrong-sized aircraft and a sharp one the right ones.
  const target = Math.max(1, market * ASSUMED_SHARE * gaugeBias - existingCapacity);
  const reachable: { type: AircraftType; miss: number }[] = [];
  for (const type of AIRCRAFT_TYPES) {
    if (!canReach(type, dist)) continue;
    if (!aircraftAvailable(state, type.id)) continue; // cannot fly a type not yet launched
    const capacity = rotationsPerWeek(type, dist) * type.seats;
    /*
     * A carrier's own manufacturer gets the benefit of the doubt on gauge.
     *
     * Fleet planning starts with what your shop offers, not with a fresh
     * comparison of the whole market — which is why airlines in life are Boeing
     * shops or Airbus shops. Without this the class representative was simply
     * whichever type sat nearest the gauge target, so the shortlist offered
     * exactly ONE narrowbody and a carrier built around the other manufacturer
     * could never buy its own equivalent aeroplane: it was never priced. The
     * handicap is small, so a genuinely wrong-sized aircraft still loses.
     */
    const bias = preferred !== null && type.maker !== preferred ? OFF_SHOP_GAUGE_BIAS : 1;
    reachable.push({ type, miss: Math.abs(capacity - target) * bias });
  }
  const shortlist = Math.abs(gaugeBias - 1) < SHARP_BIAS_BAND ? TYPE_SHORTLIST : BIASED_SHORTLIST;
  if (reachable.length <= shortlist) return reachable.map((r) => r.type);
  reachable.sort((a, b) => a.miss - b.miss);
  /*
   * One representative of every class the sector can take, BEFORE filling the
   * rest by nearest gauge.
   *
   * Ranking purely on |capacity - target| quietly decided the answer instead of
   * shortlisting for it. `target` is the traffic the whole ROUTE might win, but
   * it is compared against what ONE aircraft carries, and on any market above
   * about 20,000 a week the target exceeds every aircraft in the game — so the
   * ordering collapsed to "biggest first" and the shortlist came back all
   * widebodies. Measured: at 20,000/wk and up, five widebodies and nothing else.
   * A narrowbody was never priced on a decent market, by anyone, which is why
   * every archetype — the low-cost carrier included — flew widebodies, and why
   * no turboprop ever left the ground.
   *
   * The shortlist is a budget on how many types get appraised. It must not be
   * the thing that picks the winner; the economics downstream are.
   */
  const picked: AircraftType[] = [];
  const seen = new Set<string>();
  for (const entry of reachable) {
    if (seen.has(entry.type.klass)) continue;
    seen.add(entry.type.klass);
    picked.push(entry.type);
    if (picked.length >= shortlist) break;
  }
  for (const entry of reachable) {
    if (picked.length >= shortlist) break;
    if (!picked.includes(entry.type)) picked.push(entry.type);
  }
  return picked;
}

function probeTail(typeId: string, routeId: string): Aircraft {
  return { id: 'probe', typeId, ownership: 'leased', acquiredTurn: 0, deliversTurn: 0, bookValue: 0, routeId };
}

/**
 * Projected quarterly cash for a route as an INVESTMENT: priced over the planning
 * horizon, so a temporary fuel spike or a running shock does not decide a
 * multi-year commitment. This is what opening, contesting and re-equipping a
 * sector are judged on.
 *
 * The twin of `probe`, which prices the same route at today's actual conditions —
 * the right question when deciding whether to CLOSE something, because that is the
 * cash the bank will see this quarter.
 */
export function appraise(
  state: GameState,
  index: Index,
  route: Route,
  tails: readonly Aircraft[],
  horizon: number = CONSTANTS.ai.appraisalQuarters,
  /*
   * Precomputed station share. It varies only by carrier and city pair, so the
   * search loops hoist it and hand it down rather than paying for a rescan of the
   * whole route list on every posture and every aircraft type they price — at a
   * few hundred routes and a few thousand probes a quarter that was 4.3% of a
   * headless game, measured. Omit it and this works it out itself, which is what
   * every caller outside the hot loops does.
   */
  stationOverhead?: number,
): number {
  const carrier = getCarrier(state, route.carrierId);
  return computeRouteEconomics(
    route,
    tails,
    state.turn,
    appraisalConditionsFor(state, carrier, route, klassesOf(tails), horizon),
    rivalsOf(index, route),
    rivalCapacityOf(index, route),
    feedFactor(state.routes, route.carrierId, route.from, route.to, route.id, tallyFor(state)),
    stationOverhead ?? stationOverheadFor(
      state.routes, route.carrierId, route.from, route.to,
      tallyFor(state).onBoard.has(route.id), tallyFor(state),
    ),
  ).netCash;
}

/** Projected quarterly cash for a route, priced against whoever already flies it. */
export function probe(
  state: GameState,
  index: Index,
  route: Route,
  tails: readonly Aircraft[],
  /** As `appraise` — hoisted by the search loops, worked out here otherwise. */
  stationOverhead?: number,
): number {
  // Priced under the probing carrier's own conditions — its technology and its
  // hedge, not the world's average. The hub-feed bonus counts the carrier's
  // existing network at the endpoints, so opening at an established hub reads as
  // more valuable — no selfId, since this sector is not yet in the world.
  const carrier = getCarrier(state, route.carrierId);
  return computeRouteEconomics(
    route,
    tails,
    state.turn,
    conditionsFor(state, carrier, route, klassesOf(tails)),
    rivalsOf(index, route),
    rivalCapacityOf(index, route),
    // Exclude this sector itself: for a new-route probe its temp id is absent from
    // the world (so nothing is excluded), and for a reinforcement probe of an
    // existing route it drops the route's own endpoints — matching the settlement.
    feedFactor(state.routes, route.carrierId, route.from, route.to, route.id, tallyFor(state)),
    stationOverhead ?? stationOverheadFor(
      state.routes, route.carrierId, route.from, route.to,
      tallyFor(state).onBoard.has(route.id), tallyFor(state),
    ),
  ).netCash;
}

/**
 * How much of a city's traffic this carrier already has to itself: the share of the
 * sectors flown out of it that are its own.
 *
 * The Territorial's whole loop reads this. Below its threshold it is still building
 * the set and will take sectors at margins others walk away from; above it, it has
 * the place and starts charging for it. Counts SECTORS rather than seats because
 * that is what a monopolist in the board-game sense collects — the properties, not
 * the traffic.
 */
export function hubDominance(state: GameState, carrierId: CarrierId, city: CityId): number {
  let mine = 0;
  let all = 0;
  for (const r of state.routes) {
    if (r.from !== city && r.to !== city) continue;
    all += 1;
    if (r.carrierId === carrierId) mine += 1;
  }
  return all > 0 ? mine / all : 0;
}

/**
 * Cities this carrier will open sectors from: its hub, or the handful of places
 * it already has most metal. Capped because a point-to-point carrier ends up
 * serving dozens of cities and searching from every one is the single most
 * expensive thing the AI does.
 */
function origins(state: GameState, carrierId: CarrierId, cfg: AiConfig): string[] {
  const home = getCarrier(state, carrierId).homeCityId;
  if (cfg.fortressHub) return [home];

  const weight = new Map<string, number>();
  for (const route of state.routes) {
    if (route.carrierId !== carrierId) continue;
    weight.set(route.from, (weight.get(route.from) ?? 0) + 1);
    weight.set(route.to, (weight.get(route.to) ?? 0) + 1);
  }
  weight.delete(home);
  const ranked = [...weight.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => id);
  /*
   * A big carrier searches from more of its own network.
   *
   * `maxOrigins` was a flat cap — a carrier flying 122 sectors across ~60 stations
   * still looked for growth from seven of them, so its remaining candidates were
   * whatever was left over near its oldest cities and projected almost nothing.
   * Measured late in the game, the largest rival's best move was "add another
   * aeroplane" in 30 of 32 observations: not because it was full (5.7% of its routes
   * were at the aircraft cap) but because a new sector was worth $1.41M a quarter
   * against $2.12M for more metal on one it already flew. It had stopped expanding
   * the network and started thickening it, and its value plateaued — which is what
   * lets a good player simply out-compound the field after year fifteen.
   *
   * The cap is a COST control, not a design one, and a flat number spends that cost
   * in the wrong place: a three-station carrier does not need seven origins and a
   * sixty-station one is crippled by them. Scaled by the network it actually has,
   * the search stays cheap early — when nobody has stations to spare — and opens up
   * exactly when a carrier has somewhere to grow from. Measured over eight games to
   * the horizon, the biggest rival goes from +15% growth over its last forty turns
   * to +89%, and from $45B to $73B.
   */
  /*
   * The window is FIXED at the top `maxOrigins` cities rather than rotating.
   *
   * Rotating it (offset by turn, so a carrier searches a different slice each
   * quarter) was tried, because this cap is what makes rival growth plateau around
   * turn 60: a large carrier's best new sector is usually outside its top seven
   * origins, so it settles for adding another aeroplane 30 times out of 32. The
   * rotation worked on its own terms — the biggest rival's growth over its last
   * forty turns went 15% -> 128%, its final value $45B -> $100B.
   *
   * It is not in, because growth that size is a runaway rather than a better
   * opponent: the field consolidated to a monopoly on seed 105, breaking the
   * antitrust invariant in CLAUDE.md §9, and no Territorial could hold 55% of a hub
   * any more so the archetype stopped charging rent (its premium share fell to 0.8%
   * against a legacy carrier's 5.7%). It also cost 6x on a late-game turn.
   *
   * The idea is sound and now affordable — the tally above removed the O(n^2) that
   * priced it out. What it still needs is a brake: the merger-review and antitrust
   * pressure are tuned against a field that grows slowly, and have to be re-tuned
   * against one that does not, BEFORE the search opens up.
   */
  return [home, ...ranked].slice(0, cfg.maxOrigins);
}

/** Candidate destinations from one origin, richest market first. */
function destinations(origin: string, cfg: AiConfig): { id: string; km: number; demand: number }[] {
  const from = getCity(origin);
  return CITIES.filter((c) => c.id !== origin)
    .map((c) => ({ id: c.id, km: cityDistanceKm(origin, c.id), demand: marketDemandWeekly(from, c) }))
    .filter((c) => c.km >= cfg.minSectorKm && c.km <= cfg.maxSectorKm)
    .sort((a, b) => b.demand - a.demand)
    .slice(0, cfg.candidatePool);
}

/** Markets this carrier refuses to contest, by the archetype of who is there. */
function blockedPairs(state: GameState, cfg: AiConfig): Set<string> {
  const blocked = new Set<string>();
  if (!cfg.avoidArchetypes?.length) return blocked;
  for (const route of state.routes) {
    const owner = state.carriers.find((c) => c.id === route.carrierId);
    if (owner?.archetypeId && cfg.avoidArchetypes.includes(owner.archetypeId)) {
      blocked.add(marketKey(route.from, route.to));
    }
  }
  return blocked;
}

export interface SectorPick {
  readonly from: string;
  readonly to: string;
  readonly typeId: string;
  readonly posture: PricingPosture;
  /**
   * Ranking score, compared against the archetype's profit bar. For a virgin
   * sector this IS the projected quarterly cash. For an incursion it is that
   * figure weighted by appetite and player focus, so a carrier will take a
   * slightly thinner contested market over a fatter empty one. Weighting a
   * negative projection only makes it more negative, so a loss-making market is
   * never chosen either way.
   */
  readonly score: number;
}

const ALL_POSTURES: readonly PricingPosture[] =
  ['skim', 'premium', 'match', 'undercut', 'stimulate'];

/**
 * Postures worth pricing for this carrier.
 *
 * An archetype expresses its identity as a BAND, not a single fare: a low-cost
 * carrier will never sell a premium seat, but choosing between undercutting and
 * buying the market outright is a real decision and it should get to make it.
 * With one fixed posture each, the rivals could not reach the two notches added
 * on 2026-08-03 at all — skim and stimulate were used on 0.00% of rival
 * route-quarters — so the player held pricing moves the field could not answer.
 *
 * `postures` is the band; `posture` remains the identity and the fallback, and is
 * what a matchOnOverlap carrier reverts to. Anything with neither weighs all five.
 */
export function posturesFor(cfg: AiConfig): readonly PricingPosture[] {
  if (cfg.postures && cfg.postures.length > 0) return cfg.postures;
  return cfg.posture ? [cfg.posture] : ALL_POSTURES;
}

/** Best (sector, gauge, posture) this carrier could add, judged on projected cash. */
export function bestNewSector(
  state: GameState,
  index: Index,
  carrierId: CarrierId,
  cfg: AiConfig,
): SectorPick | null {
  // How far ahead this carrier plans an investment (per-archetype, so it can be A/B'd).
  const horizon = cfg.appraisalQuarters ?? CONSTANTS.ai.appraisalQuarters;
  const carrier = getCarrier(state, carrierId);
  const flown = new Set(
    state.routes.filter((r) => r.carrierId === carrierId).map((r) => marketKey(r.from, r.to)),
  );
  const blocked = blockedPairs(state, cfg);
  let best: SectorPick | null = null;

  // Its own patch, plus the world's trunk routes — the same widening `bestIncursion`
  // gets, so a rich market nobody has opened yet is actually discoverable.
  const candidates: { from: CityId; to: { id: CityId; km: number; demand: number } }[] = [];
  for (const origin of origins(state, carrierId, cfg)) {
    for (const dest of destinations(origin, cfg)) candidates.push({ from: origin, to: dest });
  }
  for (const trunk of globalTrunkMarkets()) {
    candidates.push({ from: trunk.from, to: { id: trunk.to, km: trunk.km, demand: trunk.demand } });
  }

  const tried = new Set<string>();
  for (const { from: origin, to: dest } of candidates) {
    {
      const key = marketKey(origin, dest.id);
      if (flown.has(key) || blocked.has(key) || tried.has(key)) continue;
      if (dest.km < cfg.minSectorKm || dest.km > cfg.maxSectorKm) continue;
      tried.add(key);
      /*
       * The one-off cost of opening, spread across the same horizon the sector is
       * appraised over, so it lands in the SAME UNITS as everything it is ranked
       * against: dollars per quarter.
       *
       * Without this the comparison in `decideRival` was never fair. A new sector
       * was scored on its gross quarterly cash while another aeroplane on an
       * existing sector was scored on its marginal gain — so opening was free and
       * reinforcing was not, and breadth won on an accounting artefact rather than
       * on economics. It is also why raising the opening cost alone did nothing:
       * a number no decision reads cannot change a decision, it can only drain the
       * cash the carrier then fails to spend.
       */
      const openCost = openingCostFor(state.routes, carrier, origin, dest.id) / horizon;
      // Constant across every posture and gauge priced below — see `appraise`.
      const station = stationOverheadFor(state.routes, carrierId, origin, dest.id, false, tallyFor(state));
      /*
       * A Territorial values a sector for being ON ITS PATCH, not only for what it
       * earns. Applied as willingness rather than as a multiplier on the number —
       * the same trap `bestIncursion` documents: a thin sector often appraises
       * negative, and multiplying a negative by a bigger appetite would make the
       * most territorial carrier avoid its own hub hardest.
       */
      const onPatch = cfg.cornerHub === true && (origin === carrier.homeCityId || dest.id === carrier.homeCityId);
      const pull = onPatch ? CONSTANTS.ai.cornerPull : 1;
      for (const stance of posturesFor(cfg)) {
        const route: Route = {
          id: 'probe', carrierId, from: origin, to: dest.id, posture: stance, openedTurn: state.turn,
        };
        for (const type of candidateTypes(state, dest.km, dest.demand, 0, cfg.gaugeBias, preferredMaker(state.seed, carrierId))) {
          const raw = appraise(state, index, route, [probeTail(type.id, 'probe')], horizon, station) - openCost;
          const net = raw > 0 ? raw * pull : raw / pull;
          if (!best || net > best.score) {
            best = { from: origin, to: dest.id, typeId: type.id, posture: stance, score: net };
          }
        }
      }
    }
  }
  return best;
}

/**
 * The best market someone else has already proven, that this carrier could take
 * a share of. Pillar 4: success attracts sharks.
 *
 * This ignores the home-ranked destination list — a carrier finds these by
 * looking at what is already flown profitably, which is how a good route draws
 * entrants in reality. Without it, carriers only ever open virgin sectors and
 * never contest anything.
 *
 * It still has to touch the carrier's own network. Letting a carrier contest any
 * market anywhere makes its home base meaningless and fortress-hub archetypes
 * indistinguishable from point-to-point ones: a Port Moresby operator would
 * happily open London-New York.
 */
/**
 * The richest city pairs in the world, computed once.
 *
 * Every candidate a carrier considered used to have to touch one of its own
 * hubs — `origins()` — for BOTH opening a sector and raiding one. That is a fair
 * model of a hub carrier's day-to-day network planning and a terrible model of
 * how the industry treats a trunk route: in life everyone wants a slice of the
 * biggest markets and will open a base to get one. Measured, the consequence was
 * severe — the richest pairs on the map went unflown in 10 of 10 games, and 97.9%
 * of served markets ended with a single carrier, because the set of carriers that
 * could even SEE a given market was tiny.
 *
 * So every carrier also considers the global trunk routes, whoever it is and
 * wherever it is based. Static data, so this is built once and shared.
 */
let trunkMarkets: { from: CityId; to: CityId; km: number; demand: number }[] | null = null;

function globalTrunkMarkets(): { from: CityId; to: CityId; km: number; demand: number }[] {
  if (trunkMarkets) return trunkMarkets;
  const all: { from: CityId; to: CityId; km: number; demand: number }[] = [];
  for (let i = 0; i < CITIES.length; i++) {
    for (let j = i + 1; j < CITIES.length; j++) {
      const a = CITIES[i]!;
      const b = CITIES[j]!;
      const km = cityDistanceKm(a.id, b.id);
      if (km < CONSTANTS.routes.minDistanceKm) continue;
      all.push({ from: a.id, to: b.id, km, demand: marketDemandWeekly(a, b) });
    }
  }
  all.sort((x, y) => y.demand - x.demand);
  trunkMarkets = all.slice(0, CONSTANTS.ai.trunkMarkets);
  return trunkMarkets;
}

export function bestIncursion(
  state: GameState,
  index: Index,
  carrierId: CarrierId,
  cfg: AiConfig,
): SectorPick | null {
  const appetite = cfg.incursionAppetite ?? 0;
  if (appetite <= 0) return null;
  // How far ahead this carrier plans an investment (per-archetype, so it can be A/B'd).
  const horizon = cfg.appraisalQuarters ?? CONSTANTS.ai.appraisalQuarters;

  const mine = new Set(
    state.routes.filter((r) => r.carrierId === carrierId).map((r) => marketKey(r.from, r.to)),
  );
  const blocked = blockedPairs(state, cfg);
  const reachable = new Set(origins(state, carrierId, cfg));
  // Shortlist the richest contestable markets rather than pricing every route
  // in the world against every aircraft type each quarter.
  const seen = new Set<string>();
  const shortlist: { route: Route; dist: number; demand: number }[] = [];
  const consider = (target: Route): void => {
    if (target.carrierId === carrierId) return;
    const key = marketKey(target.from, target.to);
    if (mine.has(key) || blocked.has(key) || seen.has(key)) return;
    seen.add(key);
    const dist = cityDistanceKm(target.from, target.to);
    if (dist < cfg.minSectorKm || dist > cfg.maxSectorKm) return;
    shortlist.push({
      route: target, dist, demand: marketDemandWeekly(getCity(target.from), getCity(target.to)),
    });
  };

  for (const target of state.routes) {
    // Anything touching one of this carrier's own cities: its natural patch.
    if (!reachable.has(target.from) && !reachable.has(target.to)) continue;
    consider(target);
  }
  // ...and the trunk routes, wherever they are. A carrier that has to open a base
  // to fight for one of the biggest markets on the map is behaving like an airline,
  // not overreaching: it still has to clear the same appraisal as everything else.
  for (const trunk of globalTrunkMarkets()) {
    const held = state.routes.find(
      (r) => r.carrierId !== carrierId && marketKey(r.from, r.to) === marketKey(trunk.from, trunk.to),
    );
    if (!held) continue; // an unflown trunk route is bestNewSector's business
    consider(held);
  }
  shortlist.sort((a, b) => b.demand - a.demand);

  const carrier = getCarrier(state, carrierId);
  let best: SectorPick | null = null;
  for (const { route: target, dist, demand } of shortlist.slice(0, cfg.incursionShortlist)) {
    // Same amortised station cost a virgin sector pays: muscling into someone
    // else's market still means opening the stations to fly it from.
    const openCost = openingCostFor(state.routes, carrier, target.from, target.to) / horizon;
    const station = stationOverheadFor(state.routes, carrierId, target.from, target.to, false, tallyFor(state));
    // Pillar 4: competitors enter in response to visible player profits. The
    // player is the operator everyone reads about, so their markets draw entry
    // harder than an equally good route flown by another AI.
    // Difficulty decides how sharp the teeth are. Without this a bigger, faster
    // field just spreads over virgin markets and leaves the player alone — which
    // is how hard came to have BETTER player survival than medium.
    /*
     * Who is worth fighting: the player, and separately whoever is winning.
     *
     * `playerFocus` is a fixed multiplier on the human's markets — pillar 4's "success
     * attracts sharks" as a constant. It is not adaptive, and a player who ran away
     * with the board met exactly the same appetite at 60% of the map as at 5%, which
     * is how buying the entire industry became the cheapest way to win.
     *
     * `dominancePressure` is the adaptive half and it keys on the TARGET carrier
     * rather than on the human, so a runaway roll-up draws the same crowd. The two
     * multiply: being the player makes you interesting, being ahead makes you a
     * problem, and being both makes you the thing every board in the game is talking
     * about.
     */
    const owner = state.carriers.find((c) => c.id === target.carrierId);
    const focus =
      (target.carrierId === state.playerCarrierId
        ? (cfg.playerFocus ?? 1) * difficultyMods(state.difficulty).playerFocus
        : 1)
      * (owner ? dominancePressure(state, owner) : 1);
    /*
     * ...and a Territorial answers anyone who lands on its city, whoever they are.
     * This is the half that makes the hub feel owned rather than merely busy: a
     * player opening a sector out of its home should expect the operator to turn up
     * on one of theirs, not shrug.
     */
    const trespass =
      cfg.cornerHub === true
      && (target.from === carrier.homeCityId || target.to === carrier.homeCityId)
        ? CONSTANTS.ai.cornerDefence
        : 1;

    for (const stance of posturesFor(cfg)) {
      const route: Route = {
        id: 'probe', carrierId, from: target.from, to: target.to, posture: stance, openedTurn: state.turn,
      };
      for (const type of candidateTypes(state, dist, demand, 0, cfg.gaugeBias, preferredMaker(state.seed, carrierId))) {
        // Appetite and player-focus are WILLINGNESS, so they have to move a
        // candidate TOWARD being taken whatever its sign. Multiplying straight
        // through was the same trap the flag carrier's loss tolerance documents
        // in effectiveConfig: a contested market often appraises negative, and
        // multiplying a negative by a bigger focus made the boldest carriers
        // avoid the player hardest. It is why raising playerFocus from 1.9 to
        // 4.5 changed nothing measurable — the sign was eating the knob.
        // Charged before willingness is applied: the station is a real cost of the
        // investment, not an attitude toward it. Appetite may still talk a carrier
        // into a fight it would lose, but it does so knowing the price of entry.
        const raw = appraise(state, index, route, [probeTail(type.id, 'probe')], horizon, station) - openCost;
        const pull = appetite * focus * trespass;
        const net = raw > 0 ? raw * pull : raw / pull;
        if (!best || net > best.score) {
          best = { from: target.from, to: target.to, typeId: type.id, posture: stance, score: net };
        }
      }
    }
  }
  return best;
}

export interface Reinforcement {
  readonly route: Route;
  readonly typeId: string;
  readonly gain: number;
}

/** Best extra aircraft to add to a sector already flown, by the gain it buys. */
export function bestReinforcement(
  state: GameState,
  index: Index,
  carrierId: CarrierId,
  cfg: AiConfig,
): Reinforcement | null {
  // How far ahead this carrier plans an investment (per-archetype, so it can be A/B'd).
  const horizon = cfg.appraisalQuarters ?? CONSTANTS.ai.appraisalQuarters;
  const carrier = getCarrier(state, carrierId);
  let best: Reinforcement | null = null;

  for (const route of state.routes) {
    if (route.carrierId !== carrierId) continue;
    const current = assignedTo(carrier, route.id);
    if (current.length >= CONSTANTS.routes.maxAircraftPerRoute) continue;
    const station = stationOverheadFor(state.routes, carrierId, route.from, route.to, true, tallyFor(state));
    const baseline = appraise(state, index, route, current, horizon, station);
    const dist = cityDistanceKm(route.from, route.to);

    const demand = marketDemandWeekly(getCity(route.from), getCity(route.to));
    let capacity = 0;
    for (const tail of current) {
      const t = AIRCRAFT_TYPES.find((x) => x.id === tail.typeId);
      if (t && canReach(t, dist)) capacity += rotationsPerWeek(t, dist) * t.seats;
    }
    for (const type of candidateTypes(state, dist, demand, capacity, cfg.gaugeBias, preferredMaker(state.seed, carrierId))) {
      const gain = appraise(state, index, route, [...current, probeTail(type.id, route.id)], horizon, station) - baseline;
      if (!best || gain > best.gain) best = { route, typeId: type.id, gain };
    }
  }
  return best;
}

/** Acquire a tail and put it on a route. Never strands one with nowhere to fly. */
export function equip(
  state: GameState,
  carrierId: CarrierId,
  typeId: string,
  routeId: string,
  cfg: AiConfig,
): GameState {
  const carrier = getCarrier(state, carrierId);
  const before = carrier.fleet.length;
  const wantsOwned = cfg.preferOwn === true;

  let acquired = applyAction(state, {
    type: 'ACQUIRE_AIRCRAFT', carrierId, typeId, ownership: wantsOwned ? 'owned' : 'leased',
  });
  // Fall back to leasing when the balance sheet cannot take the purchase.
  if (!acquired.ok && wantsOwned) {
    acquired = applyAction(state, { type: 'ACQUIRE_AIRCRAFT', carrierId, typeId, ownership: 'leased' });
  }
  if (!acquired.ok) return state;

  const tail = getCarrier(acquired.state, carrierId).fleet[before];
  if (!tail) return state;

  const assigned = applyAction(acquired.state, {
    type: 'ASSIGN_AIRCRAFT', carrierId, tailId: tail.id, routeId,
  });
  return assigned.ok ? assigned.state : state;
}

export function openSector(state: GameState, carrierId: CarrierId, pick: SectorPick, cfg: AiConfig): GameState {
  const opened = applyAction(state, {
    type: 'OPEN_ROUTE', carrierId, from: pick.from, to: pick.to,
  });
  if (!opened.ok) return state;

  const routeId = `${carrierId}:${marketKey(pick.from, pick.to)}`;
  let s = equip(opened.state, carrierId, pick.typeId, routeId, cfg);
  if (pick.posture !== 'match') {
    const posed = applyAction(s, { type: 'SET_POSTURE', routeId, posture: pick.posture });
    if (posed.ok) s = posed.state;
  }
  return s;
}

/**
 * Hand back airframes past the renewal age and re-equip. Maintenance rises with
 * age, so a carrier that never renews eventually dies of it however well its
 * network is run.
 */
export function renewFleet(state: GameState, carrierId: CarrierId, cfg: AiConfig): GameState {
  const limit = cfg.renewAgeYears * CONSTANTS.game.quartersPerYear;
  let s = state;
  for (const tail of getCarrier(s, carrierId).fleet) {
    const age = s.turn - (tail.overhauledTurn ?? tail.acquiredTurn);
    if (age < limit) continue;
    const routeId = tail.routeId;
    const dropped = applyAction(s, { type: 'DISPOSE_AIRCRAFT', carrierId, tailId: tail.id });
    if (!dropped.ok) continue;
    s = routeId ? equip(dropped.state, carrierId, tail.typeId, routeId, cfg) : dropped.state;
  }
  return s;
}

/** Parked aircraft earn nothing and still owe lease and standing costs. */
export function releaseIdle(state: GameState, carrierId: CarrierId): GameState {
  let s = state;
  for (const tail of getCarrier(s, carrierId).fleet) {
    if (tail.routeId !== null) continue;
    const dropped = applyAction(s, { type: 'DISPOSE_AIRCRAFT', carrierId, tailId: tail.id });
    if (dropped.ok) s = dropped.state;
  }
  return s;
}

/**
 * Lock fuel forward when it is cheap.
 *
 * A hedge is insurance: it costs a small premium over spot, so writing one when
 * fuel is already dear just books the loss. The competent move is to lock in
 * while the price is below its long-run level, which is what this does.
 */
export function maybeHedge(state: GameState, carrierId: CarrierId): GameState {
  const carrier = getCarrier(state, carrierId);
  if (carrier.hedge && state.turn < carrier.hedge.untilTurn) return state;
  const baseline = CONSTANTS.game.startingFuelPricePerL;
  // The market price, not the bare walk — that is what it would be locking in.
  if (marketFuelPrice(state) > baseline * CONSTANTS.events.hedgeWhenBelow) return state;

  const result = applyAction(state, {
    type: 'HEDGE_FUEL', carrierId, fraction: CONSTANTS.events.hedgeMaxFraction,
  });
  return result.ok ? result.state : state;
}

/**
 * Close sectors that have stopped paying.
 *
 * Conditions move under a network: fuel spikes, a rival arrives, an airworthiness
 * directive lands. A carrier that only reacts once it is nearly out of cash has
 * left it far too late — real operators cut capacity when a route turns, not
 * when the bank calls.
 */
export function pruneLosers(
  state: GameState,
  index: Index,
  carrierId: CarrierId,
  cfg?: { readonly reserveCash: number; readonly appraisalQuarters?: number },
): GameState {
  const carrier = getCarrier(state, carrierId);
  // A sector this carrier opened recently is still in its ramp-up: it will eat
  // the losses rather than walk away, the way a real airline gives a new route
  // 18-24 months to build. This is what makes a rival's entry into the player's
  // market STICK — without it the incumbent squeezes an entrant out in a quarter
  // and never feels the fight. A carrier that has fallen below its own cash
  // reserve stops being brave and cuts anyway.
  const canAffordFight = cfg === undefined || carrier.cash > cfg.reserveCash;
  const commitment = Math.round(
    CONSTANTS.routes.commitmentQuarters * difficultyMods(state.difficulty).contestPressure,
  );

  let worst: { id: string; net: number } | null = null;
  for (const route of state.routes) {
    if (route.carrierId !== carrierId) continue;
    if (canAffordFight && state.turn - route.openedTurn < commitment) continue;
    const tails = assignedTo(carrier, route.id);
    const net = probe(state, index, route, tails);
    if (net >= 0) continue; // paying its way today
    // Losing today is not enough. A sector is only cut if it also fails to justify
    // itself over the planning horizon — otherwise a carrier opens a route looking
    // through a shock (see `appraise`) and then closes it two quarters later on the
    // very numbers it had already decided to ride out, which is the churn this
    // whole horizon exists to stop. Structurally bad routes appraise badly too, so
    // the ones that actually deserve cutting still go.
    const horizon = cfg?.appraisalQuarters ?? CONSTANTS.ai.appraisalQuarters;
    if (canAffordFight && appraise(state, index, route, tails, horizon) >= 0) continue;
    if (!worst || net < worst.net) worst = { id: route.id, net };
  }
  // One a quarter: shedding the whole network at the first bad print would be
  // its own kind of panic, and reopening costs money.
  if (!worst) return state;
  return applyAction(state, { type: 'CLOSE_ROUTE', routeId: worst.id }).state;
}

/**
 * Fund a technology program when the balance sheet can carry it.
 *
 * Nodes are ordered cheapest-first: the money is gone for several quarters
 * before anything lands, so a carrier works up the tree rather than betting the
 * balance sheet on the biggest node it can nominally afford.
 */
export function maybeInvestInTech(
  state: GameState,
  carrierId: CarrierId,
  cfg?: AiConfig,
): GameState {
  const carrier = getCarrier(state, carrierId);
  if (carrier.cash < CONSTANTS.stubAi.techAboveCash) return state;

  const appetite = cfg?.tech;
  const avoid = new Set(appetite?.avoid ?? []);
  // A real airline is not the sort of company that buys everything. A ULCC runs
  // no alliance and no loyalty program; a roll-up will not tie cash up in a
  // five-quarter systems project. What it will not buy is as characterful as
  // what it will.
  const eligible = TECH_NODES.filter((n) => !avoid.has(n.id));

  if (appetite) {
    // Bound how much of the tree it ever pursues, so funding one program really
    // does forgo another. Without a ceiling, a hundred quarters of compounding
    // cash buys the whole board regardless of who you are.
    const cap = Math.max(1, Math.round(eligible.length * appetite.appetite));
    if (carrier.tech.length + carrier.techInProgress.length >= cap) return state;
  }

  const prefer = appetite?.prefer ?? [];
  const rank = (id: string): number => {
    const at = prefer.indexOf(id);
    return at === -1 ? prefer.length : at;
  };
  const affordable = eligible
    .filter((n) => techStatus(carrier, n) === 'available' && n.cost <= carrier.cash)
    .sort((a, b) => rank(a.id) - rank(b.id) || a.cost - b.cost);
  const pick = affordable[0];
  if (!pick) return state;

  const result = applyAction(state, { type: 'START_TECH', carrierId, nodeId: pick.id });
  return result.ok ? result.state : state;
}

/** Shed the worst-performing sector when cash runs short. */
export function retreat(state: GameState, index: Index, carrierId: CarrierId): GameState {
  const carrier = getCarrier(state, carrierId);
  let worst: { id: string; net: number; route: Route } | null = null;
  for (const route of state.routes) {
    if (route.carrierId !== carrierId) continue;
    const net = probe(state, index, route, assignedTo(carrier, route.id));
    if (!worst || net < worst.net) worst = { id: route.id, net, route };
  }
  if (!worst || worst.net >= 0) return state;

  /*
   * Cutting on TODAY'S cash alone is what a panicking operator does, and it was
   * killing the field. `retreat` fires whenever cash dips below the carrier's
   * comfort buffer — a positive number, well above insolvency — so through a
   * recession (demand 0.8, fare 0.9, up to twelve quarters) a rival shed one
   * sector a quarter while still solvent, lost that revenue too, and shed the
   * next. Measured across 14 hard games: 835 sectors dropped during events, and
   * ~96% of all rival failures happened inside one. The retreat spiral was doing
   * the killing, not the downturn.
   *
   * So a sector is only abandoned when it fails BOTH tests — this quarter's cash
   * AND the planning horizon — which is the rule `pruneLosers` already applies.
   * The horizon discounts a temporary shock to the quarters it has left to run,
   * so a carrier now rides out a downturn on a network that is sound underneath
   * and still walks away from one that is genuinely broken.
   */
  const horizon = CONSTANTS.ai.appraisalQuarters;
  const tails = assignedTo(carrier, worst.route.id);
  if (appraise(state, index, worst.route, tails, horizon) >= 0) return state;

  return applyAction(state, { type: 'CLOSE_ROUTE', routeId: worst.id }).state;
}

/**
 * Cash a carrier must hold before it will add another sector. Rises with the
 * network it already runs, so growth decelerates instead of compounding.
 */
export function expansionBar(state: GameState, carrierId: CarrierId, cfg: AiConfig): number {
  const sectors = state.routes.filter((r) => r.carrierId === carrierId).length;
  return cfg.expandAboveCash * (1 + sectors * (cfg.growthDrag ?? 0));
}

/**
 * A profitable carrier borrows to fund growth, exactly as the player can — this
 * is what makes rivals expand like real competitors rather than only spending
 * cash they already have. It never borrows into losses (the road to ruin) and
 * only draws part of its capacity, leaving headroom so a bad quarter does not
 * tip it straight into a rating spiral.
 */
export function maybeBorrow(state: GameState, carrierId: CarrierId, cfg: AiConfig): GameState {
  const carrier = getCarrier(state, carrierId);

  /*
   * There are two reasons to borrow and they are not the same reason.
   *
   * Borrowing to GROW is only for a carrier that is already earning — levering
   * into losses is the road to ruin, and that is the rule below.
   *
   * Borrowing to SURVIVE is the opposite: an airline draws on its credit lines
   * precisely BECAUSE it is losing money, which is what a downturn is. Gating
   * both behind "only the profitable lever up" meant a rival in a recession could
   * not raise a cent, fell under its reserve, shed its worst sector, lost that
   * revenue too, and shed the next one. Measured, 100% of rival failures on hard
   * happened during an event, and rivals dropped 503 sectors across 14 games
   * while doing it — the retreat spiral, not the recession, was killing them.
   *
   * A liquidity draw is capped at the reserve it is trying to restore, so this
   * cannot become a way to fund growth through a slump.
   */
  const reserve = cfg.reserveCash;
  if (carrier.cash < reserve) {
    const capacity = borrowingCapacity(state, carrier);
    const need = Math.min(reserve - carrier.cash, capacity);
    if (need >= CONSTANTS.ai.borrowMin) {
      const drawn = applyAction(state, { type: 'BORROW', carrierId, amount: need });
      if (drawn.ok) return drawn.state;
    }
    // No capacity left to draw on: the balance sheet really is finished, and the
    // retreat that follows is the correct outcome rather than a panic.
    return state;
  }

  if (trailingEarnings(state, carrierId) <= 0) return state; // only the profitable lever up
  const bar = expansionBar(state, carrierId, cfg);
  if (carrier.cash >= bar) return state; // already flush enough to grow from cash
  const capacity = borrowingCapacity(state, carrier);
  const amount = Math.min(bar - carrier.cash, capacity * CONSTANTS.ai.borrowFraction);
  if (amount < CONSTANTS.ai.borrowMin) return state;
  const result = applyAction(state, { type: 'BORROW', carrierId, amount });
  return result.ok ? result.state : state;
}

/** Pick a home city matching an archetype's taste, seeded. */
/**
 * How much air traffic a region is worth, as a share of the world. Static data,
 * so computed once. Population times economic weight is the same product the
 * gravity model uses, which keeps "where airlines form" consistent with "where
 * the passengers are".
 */
let regionStrengthCache: Map<string, number> | null = null;

function regionStrength(): Map<string, number> {
  if (regionStrengthCache) return regionStrengthCache;
  const out = new Map<string, number>();
  let total = 0;
  for (const c of CITIES) {
    const v = c.pop * c.weight;
    out.set(c.region, (out.get(c.region) ?? 0) + v);
    total += v;
  }
  for (const [k, v] of out) out.set(k, v / total);
  regionStrengthCache = out;
  return out;
}

export function chooseHome(
  rng: Rng,
  taken: ReadonlySet<string>,
  weightMin: number,
  weightMax: number,
  popMin: number,
  /**
   * How many carriers are already based in each region. Homes were picked
   * uniformly from whatever matched the archetype's taste, with no sense of the
   * map — so with nine regions and a cast of eight to twelve it was perfectly
   * possible, and not even rare, to deal a field with nobody in North America at
   * all. A player based there then flew for years without ever meeting a rival,
   * which is the complaint this addresses.
   *
   * Airlines exist everywhere, so the field spreads: a region already carrying
   * carriers is proportionally less likely to attract the next one. A bias, not a
   * quota — a lopsided world is still possible, an empty continent is not.
   */
  regionLoad: ReadonlyMap<string, number> = new Map(),
): string {
  const candidates = CITIES.filter(
    (c) => !taken.has(c.id) && c.weight >= weightMin && c.weight <= weightMax && c.pop >= popMin,
  );
  const pool = candidates.length > 0 ? candidates : CITIES.filter((c) => !taken.has(c.id));
  const finalPool = pool.length > 0 ? pool : CITIES;

  /*
   * Weighted by OPPORTUNITY over crowding, not by emptiness alone.
   *
   * Weighting purely on "how few carriers are here" was tried and was worse than
   * doing nothing: the regions with no carriers are mostly the economically thin
   * ones, so it seeded airlines into markets that could not support them and the
   * live field collapsed from ten carriers to two. A region earns a carrier by
   * having traffic worth flying, and then gets proportionally less attractive as
   * carriers pile in. The crowding term is raised to 0.7 rather than 1: a straight 1/(1+n) is
   * too strong for a big field, and on hard — which deals 1.25x the rivals — it
   * pushed them out of the rich regions and into thin ones fast enough to cut the
   * sectors they opened by a third.
   *
   * Deterministic, and it consumes exactly one float whatever the pool looks like.
   */
  const strength = regionStrength();
  const weightFor = (region: string): number =>
    (strength.get(region) ?? 0.1) / Math.pow(1 + (regionLoad.get(region) ?? 0), 0.7);
  let total = 0;
  for (const c of finalPool) total += weightFor(c.region);
  if (total <= 0) return rng.pick(finalPool).id;
  let roll = rng.float(0, total);
  for (const c of finalPool) {
    roll -= weightFor(c.region);
    if (roll <= 0) return c.id;
  }
  return finalPool[finalPool.length - 1]!.id;
}
