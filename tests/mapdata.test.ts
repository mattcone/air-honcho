/**
 * Guards the map geometry pipeline end to end. Requires `npm run build:map`
 * first, which both `npm run dev`/`build` and CI do before anything else.
 *
 * The failure this exists to catch: a single NaN coordinate makes the browser
 * discard an entire <path>, so a whole continent silently vanishes.
 */
import { describe, expect, it } from 'vitest';
import worldGeo from '../src/data/world-110m.geo.json' with { type: 'json' };
import { splitAtAntimeridian, type LatLon } from '../src/sim/geo.ts';
import { project } from '../src/ui/projection.ts';

interface Feature {
  properties: { name: string };
  geometry: { type: string; coordinates: number[][][] | number[][][][] };
}

const features = (worldGeo as { features: Feature[] }).features;

function rings(feature: Feature): number[][][] {
  const { type, coordinates } = feature.geometry;
  const polygons = type === 'Polygon' ? [coordinates as number[][][]] : (coordinates as number[][][][]);
  return polygons.flat();
}

describe('generated world geometry', () => {
  it('is one dissolved landmass with many rings', () => {
    // Deliberately a single feature: the map draws land, not countries, so there
    // are no national borders in the geometry to outline. See build-map.mjs for
    // why. A regression to the countries source would fail here first.
    expect(features.length).toBe(1);
    expect(features[0]?.properties.name).toBe('Land');
    expect(rings(features[0]!).length).toBeGreaterThan(100);
  });

  it('drops Antarctica, which the map clips away anyway', () => {
    // No country names left to filter on, so this asserts the outcome the
    // latitude filter exists to produce rather than the mechanism.
    const lats = features.flatMap((f) => rings(f).flat().map(([, lat]) => lat as number));
    expect(Math.min(...lats)).toBeGreaterThan(-60);
  });

  it('projects every ring to finite SVG coordinates', () => {
    for (const feature of features) {
      for (const ring of rings(feature)) {
        const points: LatLon[] = ring.map(([lon, lat]) => ({ lat: lat as number, lon: lon as number }));
        for (const run of splitAtAntimeridian(points)) {
          for (const p of run.map(project)) {
            expect(Number.isFinite(p.x), feature.properties.name).toBe(true);
            expect(Number.isFinite(p.y), feature.properties.name).toBe(true);
          }
        }
      }
    }
  });

  it('keeps source coordinates in range', () => {
    for (const feature of features) {
      for (const ring of rings(feature)) {
        for (const [lon, lat] of ring) {
          expect(Math.abs(lon as number), feature.properties.name).toBeLessThanOrEqual(180);
          expect(Math.abs(lat as number), feature.properties.name).toBeLessThanOrEqual(90);
        }
      }
    }
  });
});
