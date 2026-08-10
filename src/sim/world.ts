/**
 * Static world data: the city list and the balance constants.
 *
 * Loaded once and frozen. Nothing here changes during a game, so it is *not*
 * part of GameState and never goes into a save file — saves reference cities by
 * id, which keeps them small and lets us re-balance without invalidating them.
 */
import citiesData from '../data/cities.json' with { type: 'json' };
import constantsData from '../data/constants.json' with { type: 'json' };
import type { City, CityId, Difficulty, Region } from './types.ts';
import { distanceKm } from './geo.ts';

const REGIONS: readonly Region[] = ['NA', 'LATAM', 'EU', 'MEA', 'AFR', 'SAS', 'SEA', 'EAS', 'OCE'];

function validateCity(raw: unknown, index: number): City {
  const c = raw as Record<string, unknown>;
  const fail = (why: string): never => {
    throw new Error(`cities.json[${index}] (${String(c['id'])}): ${why}`);
  };

  if (typeof c['id'] !== 'string' || c['id'].length === 0) fail('missing id');
  if (typeof c['name'] !== 'string') fail('missing name');
  if (typeof c['country'] !== 'string') fail('missing country');
  if (!REGIONS.includes(c['region'] as Region)) fail(`unknown region ${String(c['region'])}`);
  if (typeof c['lat'] !== 'number' || c['lat'] < -90 || c['lat'] > 90) fail('lat out of range');
  if (typeof c['lon'] !== 'number' || c['lon'] < -180 || c['lon'] > 180) fail('lon out of range');
  if (typeof c['pop'] !== 'number' || c['pop'] <= 0) fail('pop must be positive');
  if (typeof c['weight'] !== 'number' || c['weight'] <= 0) fail('weight must be positive');

  return Object.freeze(c as unknown as City);
}

export const CITIES: readonly City[] = Object.freeze(
  (citiesData.cities as unknown[]).map(validateCity),
);

const CITY_BY_ID = new Map<CityId, City>(CITIES.map((c) => [c.id, c]));

{
  // Duplicate ids would silently shadow each other in the map above.
  if (CITY_BY_ID.size !== CITIES.length) {
    const seen = new Set<string>();
    const dupes = CITIES.filter((c) => (seen.has(c.id) ? true : (seen.add(c.id), false)));
    throw new Error(`cities.json: duplicate ids: ${dupes.map((c) => c.id).join(', ')}`);
  }
}

export function getCity(id: CityId): City {
  const city = CITY_BY_ID.get(id);
  if (!city) throw new Error(`Unknown city id: ${id}`);
  return city;
}

export function hasCity(id: CityId): boolean {
  return CITY_BY_ID.has(id);
}

const distanceCache = new Map<string, number>();

/**
 * Great-circle distance between two cities, km.
 *
 * Memoized: the AI probes this thousands of times per turn and the answer can
 * never change — cities are static, frozen data.
 */
export function cityDistanceKm(a: CityId, b: CityId): number {
  const key = a < b ? `${a}\u0000${b}` : `${b}\u0000${a}`;
  const hit = distanceCache.get(key);
  if (hit !== undefined) return hit;
  const value = distanceKm(getCity(a), getCity(b));
  distanceCache.set(key, value);
  return value;
}

export const CONSTANTS = constantsData;

/**
 * The multipliers for a difficulty level. Every consumption point (demand, the
 * disaster deck, the rival field) reads these rather than branching on the level,
 * so adding a lever is a data change and choosing a level is one lookup.
 */
export function difficultyMods(difficulty: Difficulty): (typeof CONSTANTS.difficulty)['medium'] {
  return CONSTANTS.difficulty[difficulty];
}

// Aircraft type data lives in fleet.ts (which reads CONSTANTS from here); import
// it from there directly to avoid a re-export cycle.
