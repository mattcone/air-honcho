/**
 * Equirectangular projection, world-space -> SVG user units.
 *
 * Chosen over Robinson for Phase 0 because it is separable (x depends only on
 * lon, y only on lat), which makes antimeridian splitting and hit-testing
 * trivial. Great-circle arcs still bend correctly because they are sampled in
 * spherical space before being projected — the projection never sees a straight
 * line it has to fake.
 *
 * The full graticule is 1000x500. We clip the viewBox to 84°N–58°S: it drops
 * Antarctica and the empty Arctic, and gives the inhabited world the whole frame.
 */
import type { LatLon } from '../sim/geo.ts';

export const MAP_WIDTH = 1000;
export const MAP_HEIGHT = 500;

const LAT_TOP = 84;
const LAT_BOTTOM = -58;

export interface Point {
  readonly x: number;
  readonly y: number;
}

export function project(p: LatLon): Point {
  return {
    x: ((p.lon + 180) / 360) * MAP_WIDTH,
    y: ((90 - p.lat) / 180) * MAP_HEIGHT,
  };
}

const top = project({ lat: LAT_TOP, lon: 0 }).y;
const bottom = project({ lat: LAT_BOTTOM, lon: 0 }).y;

/** The clipped plate as numbers, so the map can zoom into a sub-rectangle of it. */
export const VIEW_MIN_X = 0;
export const VIEW_MIN_Y = top;
export const VIEW_W = MAP_WIDTH;
export const VIEW_H = bottom - top;

export const VIEWBOX = `${VIEW_MIN_X} ${VIEW_MIN_Y.toFixed(2)} ${VIEW_W} ${VIEW_H.toFixed(2)}`;

/**
 * Proportions of the clipped plate. The frame uses this as its `aspect-ratio`
 * so it hugs the map exactly instead of letterboxing it against bands of empty
 * paper — and taking it from the same two numbers as VIEWBOX means the two can
 * never drift apart.
 */
export const MAP_ASPECT = MAP_WIDTH / (bottom - top);

/** Build an SVG path `d` from one run of already-projected points. */
export function polyline(points: readonly Point[]): string {
  if (points.length === 0) return '';
  return points
    .map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(2)} ${p.y.toFixed(2)}`)
    .join('');
}
