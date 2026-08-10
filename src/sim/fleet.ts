/**
 * Fleet mechanics: aircraft-type lookups, and the derivation of weekly frequency
 * from an aircraft's speed, range and turnaround. Per pillar 1, the player never
 * sets frequency — it falls out of the fleet and the sector length.
 *
 * Pure functions over static type data; no game state, no DOM.
 */
import aircraftData from '../data/aircraft.json' with { type: 'json' };
import type { Aircraft, AircraftType, AircraftTypeId, GameState } from './types.ts';
import { CONSTANTS } from './world.ts';
import { Rng } from './rng.ts';

/**
 * Physically plausible band for each field. Not balance limits — an aircraft
 * outside these is not a tuning choice, it is a typo.
 *
 * This file is declared balance surface in its own `_meta`, and "is it a finite
 * number" was the only thing ever checked. That is how a fleet-wide efficiency
 * error survived: every value was a number, every value was wrong together, and
 * nothing compared them to anything. Ranges are wide on purpose — they exist to
 * catch a misplaced decimal point or a swapped column, not to police balance.
 */
const PLAUSIBLE: Record<string, readonly [number, number]> = {
  seats: [10, 900],
  rangeKm: [200, 20_000],
  cruiseKmh: [250, 1_000],
  turnaroundMin: [10, 240],
  price: [1e6, 6e8],
  leaseMonthly: [1e4, 5e6],
  fuelBurnLPerKm: [0.3, 25],
  maintPerBlockHour: [50, 10_000],
  maintAgeSlope: [0, 2_000],
  crewPerBlockHour: [100, 20_000],
};

/**
 * Fuel burn per 100 available seat-km, the number that actually compares two
 * aircraft. Published figures run from about 2.0 (A321neo) to 3.4 (747-400);
 * the band below is deliberately wider so a next-generation fictional type has
 * room, while still catching an aircraft that is off by a factor.
 */
const SEAT_EFFICIENCY_BAND: readonly [number, number] = [1.0, 6.0];

const KLASSES = new Set(['Turboprop', 'Regional jet', 'Narrowbody', 'Widebody']);

/** Exported so the roster-coherence tests can feed it aircraft that must be refused. */
export function validateAircraftType(raw: unknown, index: number): AircraftType {
  const t = raw as Record<string, unknown>;
  const numbers: readonly (keyof AircraftType)[] = [
    'seats', 'rangeKm', 'cruiseKmh', 'turnaroundMin', 'price',
    'leaseMonthly', 'fuelBurnLPerKm', 'maintPerBlockHour', 'maintAgeSlope', 'crewPerBlockHour',
  ];
  if (typeof t['id'] !== 'string') throw new Error(`aircraft.json[${index}]: missing id`);
  const where = `aircraft.json[${index}] (${String(t['id'])})`;
  for (const key of numbers) {
    const value = t[key];
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      throw new Error(`${where}: ${key} must be a number`);
    }
    const band = PLAUSIBLE[key];
    if (band && (value < band[0] || value > band[1])) {
      throw new Error(`${where}: ${key} is ${value}, outside the plausible range ${band[0]}-${band[1]}`);
    }
  }
  if (typeof t['klass'] !== 'string' || !KLASSES.has(t['klass'])) {
    throw new Error(`${where}: klass must be one of ${[...KLASSES].join(', ')}`);
  }
  // The cross-field check. Any single field can look sensible while the aircraft
  // it describes cannot exist — a 480-seat jet burning what a regional jet burns
  // reads fine field by field.
  const perSeat = (100 * (t['fuelBurnLPerKm'] as number)) / (t['seats'] as number);
  const [lo, hi] = SEAT_EFFICIENCY_BAND;
  if (perSeat < lo || perSeat > hi) {
    throw new Error(
      `${where}: ${perSeat.toFixed(2)} L per 100 seat-km is outside the plausible ${lo}-${hi}. ` +
        'Either fuelBurnLPerKm or seats is wrong — the two are only meaningful together.',
    );
  }
  return Object.freeze(t as unknown as AircraftType);
}

export const AIRCRAFT_TYPES: readonly AircraftType[] = Object.freeze(
  (aircraftData.aircraft as unknown[]).map(validateAircraftType),
);

const TYPE_BY_ID = new Map<AircraftTypeId, AircraftType>(AIRCRAFT_TYPES.map((t) => [t.id, t]));

if (TYPE_BY_ID.size !== AIRCRAFT_TYPES.length) {
  throw new Error('aircraft.json: duplicate type ids');
}

export function getAircraftType(id: AircraftTypeId): AircraftType {
  const type = TYPE_BY_ID.get(id);
  if (!type) throw new Error(`Unknown aircraft type: ${id}`);
  return type;
}

export function hasAircraftType(id: AircraftTypeId): boolean {
  return TYPE_BY_ID.has(id);
}

/** Quarters an ordered aircraft of this class takes to enter service. */
export function deliveryQuarters(type: AircraftType): number {
  const map = CONSTANTS.fleet.deliveryQuartersByKlass as Record<string, number>;
  return map[type.klass] ?? 2;
}

/**
 * The two manufacturers that build a full line — narrowbody and widebody both.
 * A carrier is built around one of them; the niche builders are bought for jobs
 * neither covers, so they carry no commonality penalty either way.
 */
const FULL_LINE_MAKERS = ['Aros', 'Vanta'] as const;

/**
 * Which manufacturer this carrier is built around.
 *
 * Derived from the seed and the carrier id rather than stored, so it needs no
 * save migration and cannot drift out of step with the game it belongs to. Real
 * airlines are Boeing shops or Airbus shops — a relationship, a spares pool and a
 * set of type ratings, not a fresh comparison every time an aircraft is ordered.
 * Modelling it is what stops every carrier's appraisal reaching the same answer.
 */
export function preferredMaker(seed: number, carrierId: string): string {
  /*
   * A murmur3 finalizer, not a seeded PRNG's first draw.
   *
   * Carrier ids differ by a character or two, and seeding a PRNG with a weak mix
   * of two near-identical inputs and taking ONE draw does not decorrelate them:
   * the first attempt handed every rival in the field the same manufacturer.
   * This avalanches properly, so one differing character flips the result half
   * the time, which is the whole point.
   */
  let h = seed | 0;
  for (let i = 0; i < carrierId.length; i++) {
    h = Math.imul(h ^ carrierId.charCodeAt(i), 2654435761);
  }
  h ^= h >>> 15;
  h = Math.imul(h, 2246822507);
  h ^= h >>> 13;
  h = Math.imul(h, 3266489909);
  h ^= h >>> 16;
  return FULL_LINE_MAKERS[(h >>> 0) % FULL_LINE_MAKERS.length] ?? FULL_LINE_MAKERS[0];
}

/** Cost multiplier on crew and maintenance for flying outside the carrier's shop. */
export function makerCostMultiplier(type: AircraftType, preferred: string | null): number {
  if (preferred === null) return 1;
  if (!(FULL_LINE_MAKERS as readonly string[]).includes(type.maker)) return 1;
  return type.maker === preferred ? 1 : 1 + CONSTANTS.fleet.offMakerCostPenalty;
}

/** Whether a type can legally fly a sector of the given length. */
export function canReach(type: AircraftType, distanceKm: number): boolean {
  return distanceKm <= type.rangeKm;
}

/**
 * Roll each aircraft type's entry-into-service turn for one game. Historical
 * types land on their real launch turn (clamped to the start, so anything older
 * than the start year is available from turn 0). A future type's arrival is
 * drawn from the seed within its variability window and may fall past the
 * horizon — in which case it never ships, and the adoption race for it is moot.
 */
export function rollAircraftIntro(seed: number, startYear: number): Record<string, number> {
  const rng = Rng.fromSeed(seed ^ 0x0a1c1a5f);
  const qpy = CONSTANTS.game.quartersPerYear;
  const intro: Record<string, number> = {};
  for (const type of AIRCRAFT_TYPES) {
    const slip = type.introVariabilityYears > 0
      ? rng.float(-type.introVariabilityYears, type.introVariabilityYears)
      : 0;
    const year = type.introYear + slip;
    intro[type.id] = Math.max(0, Math.round((year - startYear) * qpy));
  }
  return intro;
}

/** Has this aircraft type entered service by the current turn? */
export function aircraftAvailable(state: GameState, typeId: string): boolean {
  return state.turn >= (state.aircraftIntro[typeId] ?? 0);
}

/**
 * Effective airframe age in years. Counts from the last overhaul if there has
 * been one, otherwise from acquisition — a heavy maintenance visit resets the
 * clock, which is the whole point of buying one.
 */
export function ageYears(aircraft: Aircraft, turn: number): number {
  const from = aircraft.overhauledTurn ?? aircraft.acquiredTurn;
  return Math.max(0, (turn - from) / CONSTANTS.game.quartersPerYear);
}

/** One-way block hours: cruise time plus fixed taxi/climb/descent overhead. */
export function legBlockHours(type: AircraftType, distanceKm: number): number {
  return distanceKm / type.cruiseKmh + CONSTANTS.fleet.blockPadHoursPerLeg;
}

/** Hours for a full round trip, including turnaround at each end. */
export function roundTripHours(type: AircraftType, distanceKm: number): number {
  return 2 * legBlockHours(type, distanceKm) + 2 * (type.turnaroundMin / 60);
}

/**
 * Round trips per week one tail of this type can fly on a sector, from the
 * utilization budget. Zero if the sector is out of range.
 */
export function rotationsPerWeek(type: AircraftType, distanceKm: number): number {
  if (!canReach(type, distanceKm)) return 0;
  const weeklyHours = CONSTANTS.fleet.utilizationHoursPerDay * 7;
  return weeklyHours / roundTripHours(type, distanceKm);
}

/**
 * Maintenance $/block-hour, rising with age along a saturating curve.
 *
 * Approaches `maintPerBlockHour + maintAgeSlope * saturationYears` rather than
 * climbing for ever. Real airframes get dearer to keep flying and then level
 * off; an unbounded line means every long-held fleet eventually bankrupts its
 * owner no matter how well the network is run.
 */
export function maintenancePerBlockHour(type: AircraftType, ageInYears: number): number {
  const tau = CONSTANTS.fleet.maintAgeSaturationYears;
  return type.maintPerBlockHour + type.maintAgeSlope * tau * (1 - Math.exp(-ageInYears / tau));
}

/** Cash owed for handing a leased aircraft back before its term is up. */
export function leaseBreakFee(type: AircraftType, acquiredTurn: number, turn: number): number {
  const perYear = CONSTANTS.game.quartersPerYear;
  const termQuarters = CONSTANTS.fleet.leaseTermYears * perYear;
  const remaining = Math.max(0, acquiredTurn + termQuarters - turn);
  const monthsPerQuarter = 12 / perYear;
  return remaining * monthsPerQuarter * type.leaseMonthly * CONSTANTS.fleet.leaseBreakFraction;
}

/** Cash cost of a heavy maintenance visit that resets an owned airframe's age. */
export function overhaulCost(type: AircraftType): number {
  return type.price * CONSTANTS.fleet.overhaulCostFraction;
}
