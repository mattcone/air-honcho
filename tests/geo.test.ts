import { describe, expect, it } from 'vitest';
import {
  distanceKm,
  greatCirclePoints,
  splitAtAntimeridian,
  type LatLon,
} from '../src/sim/geo.ts';

const LON: LatLon = { lat: 51.51, lon: -0.13 };
const NYC: LatLon = { lat: 40.71, lon: -74.01 };
const TYO: LatLon = { lat: 35.68, lon: 139.69 };
const LAX: LatLon = { lat: 34.05, lon: -118.24 };
const SYD: LatLon = { lat: -33.87, lon: 151.21 };

describe('distanceKm', () => {
  // Tolerances are generous because these are city centers, not airports; the
  // point is to catch a broken formula, not to certify a navigation database.
  it.each([
    ['London–New York', LON, NYC, 5570],
    ['Los Angeles–Tokyo', LAX, TYO, 8817],
    ['Sydney–London', SYD, LON, 16994],
  ])('%s is about %i km', (_name, a, b, expected) => {
    expect(distanceKm(a as LatLon, b as LatLon)).toBeCloseTo(expected as number, -1);
  });

  it('is zero for a point against itself', () => {
    expect(distanceKm(LON, LON)).toBe(0);
  });

  it('is symmetric', () => {
    expect(distanceKm(LON, TYO)).toBeCloseTo(distanceKm(TYO, LON), 6);
  });

  it('handles an antimeridian pair without going the long way round', () => {
    const west: LatLon = { lat: 0, lon: 179 };
    const east: LatLon = { lat: 0, lon: -179 };
    // 2° of longitude at the equator, not 358°.
    expect(distanceKm(west, east)).toBeCloseTo(222, -1);
  });

  it('obeys the triangle inequality', () => {
    const direct = distanceKm(LON, SYD);
    const viaDubai = distanceKm(LON, { lat: 25.2, lon: 55.27 }) + distanceKm({ lat: 25.2, lon: 55.27 }, SYD);
    expect(viaDubai).toBeGreaterThan(direct);
  });
});

describe('greatCirclePoints', () => {
  it('starts and ends exactly on the endpoints', () => {
    const points = greatCirclePoints(LON, TYO, 32);
    expect(points).toHaveLength(33);
    expect(points[0]?.lat).toBeCloseTo(LON.lat, 6);
    expect(points[0]?.lon).toBeCloseTo(LON.lon, 6);
    expect(points.at(-1)?.lat).toBeCloseTo(TYO.lat, 6);
    expect(points.at(-1)?.lon).toBeCloseTo(TYO.lon, 6);
  });

  it('every sample lies on the great circle', () => {
    // Sum of the leg distances should equal the direct distance, because every
    // sample is on the geodesic. A straight-line-in-lat/lon fake would be longer.
    const total = distanceKm(LON, TYO);
    const points = greatCirclePoints(LON, TYO, 128);
    let walked = 0;
    for (let i = 1; i < points.length; i++) {
      walked += distanceKm(points[i - 1] as LatLon, points[i] as LatLon);
    }
    expect(walked).toBeCloseTo(total, 1);
  });

  it('bends poleward on a high-latitude crossing', () => {
    // The London–Tokyo geodesic passes well north of both endpoints.
    const points = greatCirclePoints(LON, TYO, 64);
    const maxLat = Math.max(...points.map((p) => p.lat));
    expect(maxLat).toBeGreaterThan(Math.max(LON.lat, TYO.lat));
  });

  it('degrades gracefully for coincident and antipodal points', () => {
    expect(greatCirclePoints(LON, LON)).toHaveLength(2);
    const antipode: LatLon = { lat: -LON.lat, lon: LON.lon + 180 };
    expect(greatCirclePoints(LON, antipode)).toHaveLength(2);
  });

  it('produces valid coordinates throughout', () => {
    for (const p of greatCirclePoints(SYD, LON, 64)) {
      expect(Number.isFinite(p.lat)).toBe(true);
      expect(Number.isFinite(p.lon)).toBe(true);
      expect(Math.abs(p.lat)).toBeLessThanOrEqual(90);
      expect(Math.abs(p.lon)).toBeLessThanOrEqual(180.000001);
    }
  });
});

describe('splitAtAntimeridian', () => {
  it('leaves a non-crossing arc as a single run', () => {
    expect(splitAtAntimeridian(greatCirclePoints(LON, NYC, 32))).toHaveLength(1);
  });

  it('splits a Pacific crossing into two runs that meet the edge', () => {
    const runs = splitAtAntimeridian(greatCirclePoints(LAX, TYO, 64));
    expect(runs).toHaveLength(2);
    expect(Math.abs(runs[0]?.at(-1)?.lon ?? 0)).toBe(180);
    expect(Math.abs(runs[1]?.[0]?.lon ?? 0)).toBe(180);
    // The two edge points are the same place, so their latitudes must agree.
    expect(runs[0]?.at(-1)?.lat).toBeCloseTo(runs[1]?.[0]?.lat ?? 0, 6);
  });

  it('keeps every original point', () => {
    const points = greatCirclePoints(LAX, TYO, 64);
    const kept = splitAtAntimeridian(points).flat().length;
    // Original points, plus the two interpolated edge points.
    expect(kept).toBe(points.length + 2);
  });

  it('handles degenerate input', () => {
    expect(splitAtAntimeridian([])).toEqual([[]]);
    expect(splitAtAntimeridian([LON])).toEqual([[LON]]);
  });

  it('never emits a non-finite coordinate', () => {
    // Natural Earth coastlines contain exact (180, -180) pairs, which have no
    // longitudinal extent to interpolate across. Getting this wrong puts NaN
    // into an SVG path and the browser drops the whole shape.
    const nasty: LatLon[][] = [
      [{ lat: 10, lon: 180 }, { lat: 20, lon: -180 }],
      [{ lat: 10, lon: -180 }, { lat: 20, lon: 180 }],
      [{ lat: 0, lon: 180 }, { lat: 0, lon: -180 }, { lat: 5, lon: 179 }],
      [{ lat: -40, lon: 179.9 }, { lat: -41, lon: -179.9 }],
    ];

    for (const points of nasty) {
      for (const run of splitAtAntimeridian(points)) {
        for (const p of run) {
          expect(Number.isFinite(p.lat), JSON.stringify(points)).toBe(true);
          expect(Number.isFinite(p.lon), JSON.stringify(points)).toBe(true);
        }
      }
    }
  });
});
