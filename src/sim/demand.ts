/**
 * The demand model: how big a market is, and how much of it the player wins.
 *
 * Gravity for market size, a logit-style attractiveness split for share.
 *
 * Every carrier flying a city pair contributes an attractiveness score, and the
 * market splits between them in proportion. The incumbent term is the
 * unmodeled rest of the industry, so even all named carriers together never
 * take 100% of a market.
 *
 * Pure and deterministic; the only randomness (quarterly demand noise) is applied
 * by the engine, which owns the seeded RNG.
 */
import type { City, PricingPosture } from './types.ts';
import { distanceKm } from './geo.ts';
import { CONSTANTS } from './world.ts';

/**
 * One-way passengers per week the whole market wants on a city pair, before any
 * carrier's share. Gravity in the population*weight product, damped by distance,
 * with an extra exponential decay on ultra-long sectors so they stay thin.
 *
 * Both population and weight carry sub-1 exponents. Real route traffic is far
 * flatter than a raw population product implies — across a reference set of 26
 * busy pairs, traffic spans ~34x while the population product spans ~210x,
 * because the things that actually decide a corridor (competing rail, island
 * geography, hub structure) are not modeled here. Linear population made
 * big-city pairs like London-Paris come out ~7x too large.
 */
const demandCache = new Map<string, number>();

export function marketDemandWeekly(a: City, b: City): number {
  const key = a.id < b.id ? `${a.id}\u0000${b.id}` : `${b.id}\u0000${a.id}`;
  const hit = demandCache.get(key);
  if (hit !== undefined) return hit;
  const value = computeMarketDemandWeekly(a, b);
  demandCache.set(key, value);
  return value;
}

/**
 * Cleared only by tests that sweep the demand constants. Nothing in a running
 * game changes them, so the cache is safe for the whole session.
 */
export function clearDemandCache(): void {
  demandCache.clear();
}

function computeMarketDemandWeekly(a: City, b: City): number {
  const d = CONSTANTS.demand;
  const dist = distanceKm(a, b);
  const w = d.weightExponent;
  const p = d.populationExponent;
  const gravity = a.pop ** p * a.weight ** w * (b.pop ** p * b.weight ** w);
  let demand = (d.k * gravity) / dist ** d.distanceExponent;

  if (dist > d.longHaulDecayStartKm) {
    demand *= Math.exp(-(dist - d.longHaulDecayStartKm) / d.longHaulDecayScaleKm);
  }
  return demand;
}

// Validated once at load, the way tech.json is. Both of these would otherwise
// fail silently: a short table would read as `?? 1` for the missing quarters,
// and a table that does not average to 1 would move the LEVEL of world demand
// as well as its shape, quietly invalidating every figure calibrated against
// published unit economics.
{
  const s = CONSTANTS.demand.seasonality;
  if (s.index.length !== CONSTANTS.game.quartersPerYear) {
    throw new Error(
      `constants.json: demand.seasonality.index has ${s.index.length} entries but ` +
        `there are ${CONSTANTS.game.quartersPerYear} quarters in a year`,
    );
  }
  const mean = s.index.reduce((sum, v) => sum + v, 0) / s.index.length;
  if (Math.abs(mean - 1) > 1e-9) {
    throw new Error(`constants.json: demand.seasonality.index must average 1, got ${mean}`);
  }
}

/**
 * How seasonal one city is, from 0 (none) at the tropics to 1 at high latitude.
 *
 * Tropical markets barely have a season; northern Europe and Canada have a very
 * pronounced one. Linear in between, which is cruder than reality but has the
 * right shape and only needs a latitude.
 */
function seasonalAmplitude(lat: number): number {
  const s = CONSTANTS.demand.seasonality;
  const span = s.fullEffectLatitudeDeg - s.tropicLatitudeDeg;
  // A zero span would divide to Infinity or NaN and poison every downstream
  // figure silently, which is exactly how the Phase 0 map NaN got in.
  if (span <= 0) return Math.abs(lat) > s.tropicLatitudeDeg ? 1 : 0;
  return Math.max(0, Math.min(1, (Math.abs(lat) - s.tropicLatitudeDeg) / span));
}

/** This city's demand multiplier for the quarter — 1 on the annual mean. */
function citySeason(city: City, quarterIndex: number): number {
  const s = CONSTANTS.demand.seasonality;
  const periods = s.index.length;
  // Half a year out of phase below the equator: July is Sydney's winter.
  const q = city.lat < 0 ? (quarterIndex + Math.floor(periods / 2)) % periods : quarterIndex;
  const peak = s.index[q] ?? 1;
  return 1 + seasonalAmplitude(city.lat) * (peak - 1);
}

/**
 * The seasonal demand multiplier on a city pair for a given turn.
 *
 * Applied when a quarter is settled, not when a route is being appraised, so
 * carriers plan on annual economics and then live through the actual season —
 * which is what airlines do. A sector sized to be full on the annual average
 * spills in the summer and flies half empty in the winter, and that spread is
 * what makes published load factor sit below the ceiling any single route can
 * reach. See DECISIONS.md.
 *
 * The two endpoints are averaged, so a pair spanning the equator is naturally
 * flatter than one inside a single hemisphere — the two seasons partly cancel.
 */
export function seasonalDemandFactor(a: City, b: City, turn: number): number {
  const periods = CONSTANTS.demand.seasonality.index.length;
  // Floored modulo: a negative turn must not index off the front of the table.
  const q = ((turn % periods) + periods) % periods;
  return (citySeason(a, q) + citySeason(b, q)) / 2;
}

/**
 * How appealing one carrier's service on a sector is: frequency with diminishing
 * returns, scaled by what its pricing posture does to demand. This is the only
 * quantity that competes — carriers are compared on it and nothing else.
 */
export function attractiveness(
  frequencyWeekly: number,
  posture: PricingPosture,
  seatsPerDeparture: number = CONSTANTS.share.refSeatsPerDeparture,
): number {
  if (frequencyWeekly <= 0) return 0;
  const s = CONSTANTS.share;
  // The S-curve: share tracks CAPACITY share, so seats per departure count on
  // top of frequency. Normalised to a reference narrowbody, so a widebody wins
  // more share at the same frequency and a turboprop wins less. Both exponents
  // stay below 1 — neither piling frequency nor upgauging one trunk route may
  // run away (DECISIONS.md).
  const gauge = (Math.max(1, seatsPerDeparture) / s.refSeatsPerDeparture) ** s.gaugeElasticity;
  return (
    frequencyWeekly ** s.frequencyElasticity * gauge * CONSTANTS.posture.attractiveness[posture]
  );
}

/**
 * How much a carrier's own pricing posture stimulates or suppresses the demand
 * it captures on a market — price elasticity, tuned by how leisure the route is.
 *
 * Cheap fares create trips that would not otherwise happen (elasticity near -1.9
 * on a holiday route, InterVISTAS/Gillen), and that new traffic accrues to the
 * discounter, not to its rivals. A business route barely moves (near -0.5): the
 * fare is a small part of the trip. The route's elasticity interpolates on its
 * combined city weight, weight being business-travel intensity.
 *
 * Returns a multiplier on captured demand: >1 for undercut, <1 for premium, and
 * exactly 1 for match (which is the reference fare the whole curve keys off).
 */
export function priceStimulation(a: City, b: City, posture: PricingPosture): number {
  const fareRatio = CONSTANTS.posture.fare[posture];
  if (fareRatio === 1) return 1;
  const d = CONSTANTS.demand;
  const routeWeight = Math.sqrt(a.weight * b.weight);
  const span = d.businessWeightAbove - d.leisureWeightBelow;
  const businessness =
    span <= 0 ? 1 : Math.max(0, Math.min(1, (routeWeight - d.leisureWeightBelow) / span));
  const elasticity = d.elasticityLeisure + businessness * (d.elasticityBusiness - d.elasticityLeisure);
  // Q/Q0 = (P/P0)^elasticity, with elasticity negative — cheaper fares (ratio<1)
  // raise demand, dearer fares suppress it.
  return fareRatio ** -elasticity;
}

/**
 * The unmodeled rest of the industry on a market. Keeps any single carrier —
 * or all of them together — from taking the whole thing.
 */
export function incumbentStrength(market: number): number {
  const s = CONSTANTS.share;
  return s.incumbentBase * market ** s.incumbentDemandExponent;
}

/**
 * One carrier's share of a market, against every rival flying the same pair plus
 * the ambient incumbent. Returns 0..1, and all carriers' shares plus the
 * incumbent's always sum to exactly 1.
 *
 * Takes the rivals' summed attractiveness rather than a list: the AI probes this
 * millions of times per game and an array per call is pure garbage pressure.
 */
export function demandShare(own: number, rivalTotal: number, market: number): number {
  if (own <= 0) return 0;
  return own / (own + rivalTotal + incumbentStrength(market));
}

/**
 * Expected passengers carried when demand for a departure is UNCERTAIN.
 *
 * This is the Boeing spill model, which the industry has used since the mid-1970s.
 * Demand for a departure is not a number, it is a random variable: normally
 * distributed about a mean with a coefficient of variation — the K-factor — of
 * roughly 0.35. Passengers who cannot be seated are "spill".
 *
 * Load factor is therefore not a rule and not a constant. It is
 * `E[min(D, seats)] / seats`, and it falls out of how well capacity matches an
 * uncertain demand:
 *
 *     demand/seats   0.6    0.8    1.0    1.2    1.8
 *     load factor   59.8%  76.1%  86.0%  91.4%  96.9%
 *
 * That curve is why the published industry average is 82-84% rather than the
 * high 90s: a network sized near a demand factor of 1 fills some departures and
 * flies others half empty. The sim used to clamp `min(demand, seats x ceiling)`
 * with a constant ceiling, which made load factor an input read back rather than
 * an outcome — see docs/supply-model-research.md and docs/demand-audit.md.
 *
 * Closed form for the normal case: with z = (mean - seats) / sigma,
 *   E[(D - seats)+] = (mean - seats) x Phi(z) + sigma x phi(z)
 *   E[min(D, seats)] = mean - E[(D - seats)+]
 */
export function expectedLoad(meanDemand: number, seats: number, kFactor: number): number {
  if (seats <= 0 || meanDemand <= 0) return 0;
  const sigma = kFactor * meanDemand;
  // No variance to speak of: degenerates to the old hard clamp, which is correct.
  if (sigma <= 0) return Math.min(meanDemand, seats);
  /*
   * Demand is CENSORED AT ZERO, and it has to be: sigma is a fixed fraction of
   * the mean, so the normal always keeps Phi(-1/k) = 0.2% of its mass below
   * zero, and that tail runs to minus infinity. The textbook `mu - E[(D-C)+]`
   * form integrates it, so its error grows with the mean while the true answer
   * is capped at the seat count — measured against 200k Monte Carlo draws it
   * drifts 0.3 points low at demand factor 10, 4.5 at 200, and returns a
   * nonsensical ZERO by 2000. Live games top out near 19, so that form was
   * never wrong on the board; it was a landmine for a scarcer map.
   *
   *   E[min(max(0,D), C)] = mu(Phi(a) - Phi(b)) - sigma(phi(a) - phi(b))
   *                         + C(1 - Phi(a))
   *
   * with a = (C - mu)/sigma and b = -mu/sigma, which is just -1/k. Exact for
   * every demand factor, and it costs one extra pdf/cdf pair at a constant
   * argument. A departure drawn below zero simply carries nobody, which is why
   * load tops out at 99.8% of the seats rather than 100%.
   */
  const a = (seats - meanDemand) / sigma;
  const b = -1 / kFactor;
  const load =
    meanDemand * (normalCdf(a) - normalCdf(b)) -
    sigma * (normalPdf(a) - normalPdf(b)) +
    seats * (1 - normalCdf(a));
  return Math.max(0, Math.min(seats, load));
}

/** Standard normal density. */
function normalPdf(z: number): number {
  return Math.exp(-0.5 * z * z) / Math.sqrt(2 * Math.PI);
}

/**
 * Standard normal CDF — Abramowitz & Stegun 26.2.17, |error| < 7.5e-8.
 * Pure arithmetic, so it costs the sim nothing in determinism.
 */
function normalCdf(z: number): number {
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const poly =
    t * (0.319381530 +
    t * (-0.356563782 +
    t * (1.781477937 +
    t * (-1.821255978 +
    t * 1.330274429))));
  const tail = normalPdf(z) * poly;
  return z >= 0 ? 1 - tail : tail;
}

/** One-way fare, from a sub-linear distance curve, city weight and posture. */
export function fareOneWay(a: City, b: City, posture: PricingPosture): number {
  const f = CONSTANTS.fare;
  const dist = distanceKm(a, b);
  const weightFactor = (a.weight * b.weight) ** (f.weightExponent / 2);
  return (f.base + f.perKm * dist ** f.distanceExponent) * weightFactor * CONSTANTS.posture.fare[posture];
}

/**
 * How much a route's market structure lifts its fare. A route no rival serves
 * clears above the competitive fare — pricing power on a captive market — and
 * that premium decays toward 1 as rivals add capacity. This is what real airline
 * yields do: DOT data show the least-contested routes carry the highest fares,
 * and each low-cost entrant compresses yield (the "Southwest effect"), the first
 * one most. It applies to every carrier on the market equally (the market clears
 * at one fare), so it does not distort share; and it is a level, not a posture
 * deviation, so it does not suppress demand through elasticity — a monopoly route
 * is captive, which is exactly why the premium can be charged.
 *
 * Both arguments are one-way weekly figures, as sized inside `computeRouteEconomics`.
 */
export function competitionFareMultiplier(capacityWeekly: number, marketWeekly: number): number {
  const f = CONSTANTS.fare;
  // No market to speak of: treat as uncontested rather than dividing by zero.
  const rivalShare = marketWeekly > 0 ? Math.max(0, capacityWeekly) / marketWeekly : 0;
  const premium = f.monopolyPremium / (1 + rivalShare / f.competitionHalfShare);
  return 1 + premium;
}
