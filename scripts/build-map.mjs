/**
 * Build-time map data pipeline.
 *
 * Reads Natural Earth 1:110m country boundaries (public domain, shipped as
 * TopoJSON by the `world-atlas` package), converts to GeoJSON, and aggressively
 * rounds coordinates. Output is generated, not committed.
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

function roundCoords(node) {
  if (typeof node[0] === 'number') {
    const f = 10 ** PRECISION;
    return [Math.round(node[0] * f) / f, Math.round(node[1] * f) / f];
  }
  return node.map(roundCoords);
}

const topo = JSON.parse(await readFile(require.resolve('world-atlas/countries-110m.json'), 'utf8'));
const geo = feature(topo, topo.objects.countries);

for (const f of geo.features) {
  f.geometry.coordinates = roundCoords(f.geometry.coordinates);
  // `id` and `properties.name` are all we need; drop anything else.
  f.properties = { name: f.properties?.name ?? 'Unknown' };
}

// Antarctica is a large slab of geometry we never render (the map clips at 60°S).
geo.features = geo.features.filter((f) => f.properties.name !== 'Antarctica');

await mkdir(dirname(OUT), { recursive: true });
await writeFile(OUT, JSON.stringify(geo));

const bytes = JSON.stringify(geo).length;
console.log(`build-map: ${geo.features.length} countries -> ${(bytes / 1024).toFixed(0)} KB at src/data/world-110m.geo.json`);
