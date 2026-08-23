import { describe, expect, it } from 'vitest';
import { CITIES, CONSTANTS, cityDistanceKm, getCity, hasCity } from '../src/sim/world.ts';
import { distanceKm } from '../src/sim/geo.ts';
import { EVENTS, HISTORICAL } from '../src/sim/events.ts';
import { TECH_NODES } from '../src/sim/tech.ts';

describe('cities.json', () => {
  it('covers the world at the density the sim model calls for', () => {
    expect(CITIES.length).toBeGreaterThanOrEqual(180);
  });

  it('has a unique id per city', () => {
    expect(new Set(CITIES.map((c) => c.id)).size).toBe(CITIES.length);
  });

  it('reaches every region', () => {
    const regions = new Set(CITIES.map((c) => c.region));
    expect([...regions].sort()).toEqual(
      ['AFR', 'EAS', 'EU', 'LATAM', 'MEA', 'NA', 'OCE', 'SAS', 'SEA'].sort(),
    );
  });

  it('places no two cities on the same coordinates', () => {
    const seen = new Map<string, string>();
    for (const city of CITIES) {
      const key = `${city.lat},${city.lon}`;
      expect(seen.get(key), `${city.id} collides with ${seen.get(key)}`).toBeUndefined();
      seen.set(key, city.id);
    }
  });

  it('puts every city somewhere plausible', () => {
    for (const city of CITIES) {
      expect(Math.abs(city.lat), city.id).toBeLessThanOrEqual(90);
      expect(Math.abs(city.lon), city.id).toBeLessThanOrEqual(180);
      // Outside the map's clip window a city would be unclickable.
      expect(city.lat, `${city.id} is off the top of the map`).toBeLessThan(84);
      expect(city.lat, `${city.id} is off the bottom of the map`).toBeGreaterThan(-58);
    }
  });

  it('keeps population and weight inside the designed ranges', () => {
    for (const city of CITIES) {
      expect(city.pop, city.id).toBeGreaterThan(0);
      expect(city.pop, city.id).toBeLessThan(45);
      expect(city.weight, city.id).toBeGreaterThanOrEqual(0.3);
      expect(city.weight, city.id).toBeLessThanOrEqual(1.9);
    }
  });

  it('gives most cities at least one legal sector from home', () => {
    // A city with nothing in range would be a dead end on the map.
    for (const city of CITIES) {
      const reachable = CITIES.some(
        (other) => other.id !== city.id && distanceKm(city, other) >= CONSTANTS.routes.minDistanceKm,
      );
      expect(reachable, `${city.id} has no legal sector`).toBe(true);
    }
  });
});

describe('world lookups', () => {
  it('finds a known city and rejects an unknown one', () => {
    expect(getCity('LON').name).toBe('London');
    expect(hasCity('LON')).toBe(true);
    expect(hasCity('ZZZ')).toBe(false);
    expect(() => getCity('ZZZ')).toThrow(/Unknown city/);
  });

  it('measures sectors symmetrically', () => {
    expect(cityDistanceKm('LON', 'TYO')).toBeCloseTo(cityDistanceKm('TYO', 'LON'), 9);
  });
});

describe('constants.json', () => {
  it('documents every tunable', () => {
    // Recurses, so burying a constant one level down does not exempt it.
    const walk = (node: Record<string, unknown>, path: string): void => {
      const keys = Object.keys(node);
      for (const key of keys) {
        if (key.startsWith('_')) continue;
        const documented = keys.some((k) => k === `_comment_${key}` || k === '_comment');
        expect(documented, `${path}${key} has no comment field`).toBe(true);
        // Recurse into a nested block only when it documents its own internals.
        // A bare lookup table keyed by posture or ownership is fully described
        // by the parent's comment; a block of distinct tunables is not, and
        // opts in by carrying `_comment_` entries of its own.
        const value = node[key];
        if (value && typeof value === 'object' && !Array.isArray(value)) {
          const inner = value as Record<string, unknown>;
          if (Object.keys(inner).some((k) => k.startsWith('_comment'))) {
            walk(inner, `${path}${key}.`);
          }
        }
      }
    };
    // Groups are self-describing; it is the numbers inside them that need a note.
    for (const [group, values] of Object.entries(CONSTANTS)) {
      if (group.startsWith('_')) continue;
      walk(values as Record<string, unknown>, `${group}.`);
    }
  });

  it('sets a 25-year horizon in quarters', () => {
    expect(CONSTANTS.game.horizonTurns).toBe(100);
    expect(CONSTANTS.game.quartersPerYear).toBe(4);
  });
});

/**
 * Content reachability. Neither of these can fail at runtime — an unread effect
 * key is silently ignored and an unreachable card simply never appears — which is
 * exactly why they need a test. A typo'd effect name is authored content that does
 * nothing, and it looks identical to content that works.
 */
describe('event and technology content', () => {
  /** Every key `conditionsFor` actually folds into a route's conditions. */
  const READ_BY_CONDITIONS = new Set([
    'demand', 'fare', 'fuelPrice', 'crewCost', 'maintenanceCost',
    'handlingCost', 'completion', 'loadCeiling', 'paxCost',
  ]);

  it('names only effects the conditions layer reads', () => {
    for (const card of EVENTS) {
      for (const key of Object.keys(card.effects ?? {})) {
        expect(READ_BY_CONDITIONS.has(key), `event ${card.id}: "${key}" is never read`).toBe(true);
      }
    }
    for (const node of TECH_NODES) {
      for (const key of Object.keys(node.effects ?? {})) {
        expect(READ_BY_CONDITIONS.has(key), `tech ${node.id}: "${key}" is never read`).toBe(true);
      }
    }
  });

  it('leaves no card that can never fire', () => {
    // Weight 0 is legitimate and load-bearing: sept11 and covid must not turn up
    // at random in a present-day game. It is only correct for a card the history
    // script fires by hand, though — otherwise the card is dead content.
    const scripted = new Set(HISTORICAL.map((h) => h.eventId));
    for (const card of EVENTS) {
      expect(card.weight, `event ${card.id}: negative weight`).toBeGreaterThanOrEqual(0);
      if (card.weight === 0) {
        expect(scripted.has(card.id), `event ${card.id}: weight 0 and never scripted`).toBe(true);
      }
      expect(card.minDuration).toBeLessThanOrEqual(card.maxDuration);
    }
    // And every scripted entry names a card that exists.
    for (const entry of HISTORICAL) {
      expect(EVENTS.some((c) => c.id === entry.eventId), `history: unknown event ${entry.eventId}`).toBe(true);
    }
  });

  /*
   * A scripted beat may state its own length, because the deck's range describes a
   * KIND of event and a dated one is a particular instance: the 2001 recession runs
   * six quarters where the card allows four to twelve. Two ways that goes wrong and
   * neither would fail anything else — a length of zero makes a scripted crisis
   * expire the quarter it opens (`pruneEffects` keeps only `until > turn`), so the
   * beat silently never happens; and a length outside the card's own range means the
   * wrong card is being fired, since the range is what the card claims about itself.
   */
  it('gives every dated beat a length its card can actually carry', () => {
    for (const entry of HISTORICAL) {
      if (entry.durationQuarters === undefined) continue;
      const card = EVENTS.find((c) => c.id === entry.eventId)!;
      const where = `history ${entry.year}Q${entry.quarter} ${entry.eventId}`;
      expect(Number.isInteger(entry.durationQuarters), `${where}: non-integer length`).toBe(true);
      expect(entry.durationQuarters, `${where}: would never run`).toBeGreaterThanOrEqual(1);
      expect(entry.durationQuarters, `${where}: shorter than the card allows`)
        .toBeGreaterThanOrEqual(card.minDuration);
      expect(entry.durationQuarters, `${where}: longer than the card allows`)
        .toBeLessThanOrEqual(card.maxDuration);
    }
  });

  it('resolves every technology prerequisite', () => {
    for (const node of TECH_NODES) {
      if (!node.requires) continue;
      expect(
        TECH_NODES.some((n) => n.id === node.requires),
        `tech ${node.id}: requires unknown "${node.requires}"`,
      ).toBe(true);
      expect(node.cost).toBeGreaterThan(0);
      expect(node.quarters).toBeGreaterThan(0);
    }
  });
});
