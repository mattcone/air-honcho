/**
 * Spherical geometry. Great-circle arcs are computed here, never read from data.
 *
 * Pure math, no DOM — the demand model needs distances headlessly, and the map
 * needs the same arcs the sim priced.
 */

export interface LatLon {
  readonly lat: number;
  readonly lon: number;
}

/** Mean Earth radius (IUGG), km. */
export const EARTH_RADIUS_KM = 6371.0088;

const toRad = (deg: number): number => (deg * Math.PI) / 180;
const toDeg = (rad: number): number => (rad * 180) / Math.PI;

/** Central angle between two points, in radians. */
export function centralAngle(a: LatLon, b: LatLon): number {
  const phi1 = toRad(a.lat);
  const phi2 = toRad(b.lat);
  const dPhi = phi2 - phi1;
  const dLambda = toRad(b.lon - a.lon);

  // Haversine: numerically stable for the short routes that dominate the map.
  const h =
    Math.sin(dPhi / 2) ** 2 + Math.cos(phi1) * Math.cos(phi2) * Math.sin(dLambda / 2) ** 2;
  return 2 * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Great-circle distance in km. This is the distance the sim charges fuel for. */
export function distanceKm(a: LatLon, b: LatLon): number {
  return centralAngle(a, b) * EARTH_RADIUS_KM;
}

/**
 * Sample points along the great circle from `a` to `b`, inclusive of both ends.
 * `steps` is the number of segments, so the result has `steps + 1` points.
 */
export function greatCirclePoints(a: LatLon, b: LatLon, steps = 64): LatLon[] {
  const d = centralAngle(a, b);

  // Coincident endpoints, or antipodal ones (where the great circle is not
  // unique) — either way there is no meaningful arc to interpolate.
  if (d < 1e-9 || Math.abs(Math.PI - d) < 1e-9) return [a, b];

  const phi1 = toRad(a.lat);
  const lam1 = toRad(a.lon);
  const phi2 = toRad(b.lat);
  const lam2 = toRad(b.lon);
  const sinD = Math.sin(d);

  const out: LatLon[] = [];
  for (let i = 0; i <= steps; i++) {
    const f = i / steps;
    const A = Math.sin((1 - f) * d) / sinD;
    const B = Math.sin(f * d) / sinD;

    const x = A * Math.cos(phi1) * Math.cos(lam1) + B * Math.cos(phi2) * Math.cos(lam2);
    const y = A * Math.cos(phi1) * Math.sin(lam1) + B * Math.cos(phi2) * Math.sin(lam2);
    const z = A * Math.sin(phi1) + B * Math.sin(phi2);

    out.push({
      lat: toDeg(Math.atan2(z, Math.hypot(x, y))),
      lon: toDeg(Math.atan2(y, x)),
    });
  }
  return out;
}

/**
 * Split a sampled arc wherever it crosses the antimeridian, so a flat projection
 * doesn't draw a stripe back across the whole world. Returns one or more runs of
 * points, each safe to draw as a single polyline.
 *
 * The crossing point is interpolated to ±180 so the two runs meet the map edge
 * cleanly instead of stopping short.
 */
export function splitAtAntimeridian(points: readonly LatLon[]): LatLon[][] {
  if (points.length < 2) return [points.slice()];

  const runs: LatLon[][] = [];
  let run: LatLon[] = [points[0] as LatLon];

  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1] as LatLon;
    const cur = points[i] as LatLon;

    if (Math.abs(cur.lon - prev.lon) > 180) {
      // Fraction of the way from prev to cur at which we hit the dateline,
      // measured on the short (wrapped) side.
      const prevEdge = prev.lon > 0 ? 180 : -180;
      const wrapped = cur.lon + (prev.lon > 0 ? 360 : -360);
      const span = wrapped - prev.lon;
      // span is 0 when the pair is exactly (180, -180) — the segment has no
      // longitudinal extent and prev already sits on the edge. Natural Earth
      // coastlines contain these, and dividing by zero puts NaN in a path.
      const t = span === 0 ? 0 : (prevEdge - prev.lon) / span;
      const lat = prev.lat + (cur.lat - prev.lat) * t;

      run.push({ lat, lon: prevEdge });
      runs.push(run);
      run = [{ lat, lon: -prevEdge }];
    }
    run.push(cur);
  }

  runs.push(run);
  return runs;
}
