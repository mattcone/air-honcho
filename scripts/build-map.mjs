/**
 * Build-time map data pipeline.
 *
 * Reads Natural Earth 1:110m LAND (public domain, shipped as TopoJSON by the
 * `world-atlas` package), converts to GeoJSON, and aggressively rounds
 * coordinates. Output is generated, not committed.
 *
 * WHY LAND AND NOT COUNTRIES. This used to build from `countries-110m.json`,
 * which draws all 177 country polygons, each stroked as `.land` — so every
 * national border appeared in the coastline colour. Nothing in the game reads
 * country identity: `map.ts` uses only `feature.geometry`, and city labels take
 * their country from `cities.json`. The borders were decoration, and decoration
 * that made claims.
 *
 * A player asked why Crimea had a border around it. It did because Natural
 * Earth's default file is a DE FACTO view that assigns Crimea to Russia, so it
 * is a separate polygon in Russia's MultiPolygon and gets its own outline. The
 * same file ships separately-outlined Kosovo, Somaliland, Palestine, W. Sahara,
 * Taiwan and N. Cyprus. Natural Earth's point-of-view and disputed-boundary
 * layers, which is how a map is supposed to express those, do not exist at the
 * 110m tier — only at 10m and 50m.
 *
 * Dissolving to a single landmass answers the whole category instead of
 * adjudicating it case by case. It also suits the seatback-magazine look better
 * and cuts the payload by 59% (158 KB -> 64 KB). If country borders are ever
 * genuinely needed, the fix is a 10m/50m source with the disputed layer, not a
 * return to this file.
 *
 * Rounding to 2 decimal places is ~1.1 km at the equator — far below what the
 * 110m source resolution can express, and well below one screen pixel at our
 * map scale, so it is lossless in practice and roughly halves the file size.
 */
import { writeFile, readFile, mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { feature } from 'topojson-client';

const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(here, '../src/data/world-110m.geo.json');
const PRECISION = 2;
/**
 * Antarctica is a large slab of geometry we never render (the map clips at
 * 60°S). With no country names left to filter on, it goes by latitude: drop any
 * polygon lying entirely south of this. Measured, not guessed — at both -55 and
 * -60 exactly the same 8 polygons qualify, all reaching no further north than
 * -63.3°, and the southernmost surviving land is Tierra del Fuego at -52.5°.
 * So the cut is nowhere near anything inhabited and the threshold is not
 * delicate.
 */
const ANTARCTIC_LAT = -60;

function roundCoords(node) {
  if (typeof node[0] === 'number') {
    const f = 10 ** PRECISION;
    return [Math.round(node[0] * f) / f, Math.round(node[1] * f) / f];
  }
  return node.map(roundCoords);
}

/** Northernmost latitude anywhere in a polygon's outer ring. */
function maxLat(polygon) {
  return polygon[0].reduce((hi, [, lat]) => (lat > hi ? lat : hi), -Infinity);
}

const topo = JSON.parse(await readFile(require.resolve('world-atlas/land-110m.json'), 'utf8'));
// The land object is one dissolved MultiPolygon — no internal boundaries at all.
const land = feature(topo, topo.objects.land).features[0];

const polygons = land.geometry.coordinates
  .filter((polygon) => maxLat(polygon) >= ANTARCTIC_LAT)
  .map(roundCoords);

// Kept as a FeatureCollection of one so the renderer is unchanged: map.ts
// iterates features and handles a MultiPolygon geometry already.
const geo = {
  type: 'FeatureCollection',
  features: [{ type: 'Feature', properties: { name: 'Land' }, geometry: { type: 'MultiPolygon', coordinates: polygons } }],
};

await mkdir(dirname(OUT), { recursive: true });
await writeFile(OUT, JSON.stringify(geo));

const bytes = JSON.stringify(geo).length;
console.log(`build-map: ${polygons.length} land polygons -> ${(bytes / 1024).toFixed(0)} KB at src/data/world-110m.geo.json`);
