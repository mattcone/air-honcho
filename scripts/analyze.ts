/**
 * Demand-model audit instrument.
 *
 * Runs whole games, collects every sector every quarter, and reports the
 * DISTRIBUTIONS rather than the averages — an average load factor of 88% is
 * consistent both with a healthy spread and with every route pinned to the
 * ceiling, and only the second is a problem.
 *
 *   npm run analyze                          # 10 seeds, present-day, medium
 *   npm run analyze -- --seeds 20 --json     # machine-readable
 *   npm run analyze -- --difficulty hard
 *
 * Reads only; changes nothing. No dependencies beyond what the sim already uses.
 */
import { runGame, type RouteObservation } from '../src/sim/headless.ts';
import type { Difficulty } from '../src/sim/types.ts';

// --- args -------------------------------------------------------------------

const argv = process.argv.slice(2);
function flag(name: string, fallback: string): string {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1]! : fallback;
}
const SEEDS = Number(flag('seeds', '10'));
const START = Number(flag('seed', '1'));
const TURNS = Number(flag('turns', '100'));
const SCENARIO = flag('scenario', 'present') as 'present' | 'history';
const DIFFICULTY = flag('difficulty', 'medium') as Difficulty;
const JSON_OUT = argv.includes('--json');

// --- small stats helpers ----------------------------------------------------

const sum = (xs: readonly number[]): number => xs.reduce((a, b) => a + b, 0);
const mean = (xs: readonly number[]): number => (xs.length ? sum(xs) / xs.length : 0);

function quantile(sorted: readonly number[], q: number): number {
  if (sorted.length === 0) return 0;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return lo === hi ? sorted[lo]! : sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (pos - lo);
}

function describe(xs: readonly number[]): Record<string, number> {
  const s = [...xs].sort((a, b) => a - b);
  return {
    n: s.length,
    p5: quantile(s, 0.05),
    p25: quantile(s, 0.25),
    median: quantile(s, 0.5),
    p75: quantile(s, 0.75),
    p95: quantile(s, 0.95),
    mean: mean(s),
  };
}

/** Pearson correlation — is an input actually moving an outcome? */
function correlation(xs: readonly number[], ys: readonly number[]): number {
  const n = Math.min(xs.length, ys.length);
  if (n < 2) return 0;
  const mx = mean(xs.slice(0, n));
  const my = mean(ys.slice(0, n));
  let num = 0;
  let dx = 0;
  let dy = 0;
  for (let i = 0; i < n; i++) {
    const a = xs[i]! - mx;
    const b = ys[i]! - my;
    num += a * b;
    dx += a * a;
    dy += b * b;
  }
  return dx > 0 && dy > 0 ? num / Math.sqrt(dx * dy) : 0;
}

function histogram(xs: readonly number[], lo: number, hi: number, bins: number): string[] {
  const counts = new Array<number>(bins).fill(0);
  for (const x of xs) {
    const idx = Math.min(bins - 1, Math.max(0, Math.floor(((x - lo) / (hi - lo)) * bins)));
    counts[idx] = (counts[idx] ?? 0) + 1;
  }
  const peak = Math.max(1, ...counts);
  return counts.map((c, i) => {
    const from = lo + ((hi - lo) * i) / bins;
    const to = lo + ((hi - lo) * (i + 1)) / bins;
    const pct = xs.length ? (100 * c) / xs.length : 0;
    const bar = '█'.repeat(Math.round((c / peak) * 40));
    return `${from.toFixed(0).padStart(5)}–${to.toFixed(0).padEnd(5)} ${pct.toFixed(1).padStart(5)}%  ${bar}`;
  });
}

// --- distance bands, per the audit brief ------------------------------------

type Band = 'short' | 'medium' | 'long';
const bandOf = (km: number): Band => (km < 1500 ? 'short' : km > 5000 ? 'long' : 'medium');
const BANDS: readonly Band[] = ['short', 'medium', 'long'];

// --- collect ----------------------------------------------------------------

const rows: RouteObservation[] = [];
for (let i = 0; i < SEEDS; i++) {
  runGame(START + i, TURNS, SCENARIO, DIFFICULTY, (batch) => {
    for (const r of batch) rows.push(r);
  });
}

if (rows.length === 0) {
  console.log('No sectors were ever flown — nothing to analyze.');
  process.exit(0);
}

// --- report -----------------------------------------------------------------

const lf = rows.map((r) => r.loadFactor * 100);
const margins = rows.map((r) => r.margin * 100);
const unprofitable = rows.filter((r) => r.netCash < 0);

const byBand = new Map<Band, RouteObservation[]>(BANDS.map((b) => [b, []]));
for (const r of rows) byBand.get(bandOf(r.distanceKm))!.push(r);

const byPosture = new Map<string, RouteObservation[]>();
for (const r of rows) {
  const list = byPosture.get(r.posture) ?? [];
  list.push(r);
  byPosture.set(r.posture, list);
}

const contested = rows.filter((r) => r.competitors > 0);
const alone = rows.filter((r) => r.competitors === 0);

interface BandStats {
  observations: number;
  sharePct: number;
  loadFactorPct: Record<string, number>;
  marginPct: Record<string, number>;
  unprofitablePct: number;
  medianFare: number;
  medianDemand: number;
  medianAircraft: number;
}

const bandStats: Record<Band, BandStats> = Object.fromEntries(
  BANDS.map((b) => {
    const rs = byBand.get(b)!;
    const med = (pick: (r: RouteObservation) => number): number =>
      quantile([...rs.map(pick)].sort((a, x) => a - x), 0.5);
    return [
      b,
      {
        observations: rs.length,
        sharePct: (100 * rs.length) / rows.length,
        loadFactorPct: describe(rs.map((r) => r.loadFactor * 100)),
        marginPct: describe(rs.map((r) => r.margin * 100)),
        unprofitablePct: rs.length ? (100 * rs.filter((r) => r.netCash < 0).length) / rs.length : 0,
        medianFare: med((r) => r.fareOneWay),
        medianDemand: med((r) => r.marketDemandWeekly),
        medianAircraft: med((r) => r.aircraftCount),
      },
    ];
  }),
) as Record<Band, BandStats>;

/**
 * The specific sectors the symptom named. A band aggregate can hide them: "long
 * haul" is mostly thin uncontested pairs, while LON–NYC is the most fought-over
 * market on the board, so the two can point in opposite directions.
 */
const NAMED: readonly (readonly [string, string])[] = [
  ['LON', 'NYC'], ['PAR', 'NYC'], ['LON', 'LAX'], ['NYC', 'LAX'], ['LON', 'PAR'],
];
const namedStats = NAMED.map(([a, b]) => {
  const rs = rows.filter(
    (r) => (r.from === a && r.to === b) || (r.from === b && r.to === a),
  );
  const med = (pick: (r: RouteObservation) => number): number =>
    quantile([...rs.map(pick)].sort((x, y) => x - y), 0.5);
  return {
    pair: `${a}–${b}`,
    observations: rs.length,
    medianLoadFactorPct: rs.length ? med((r) => r.loadFactor * 100) : 0,
    medianMarginPct: rs.length ? med((r) => r.margin * 100) : 0,
    unprofitablePct: rs.length ? (100 * rs.filter((r) => r.netCash < 0).length) / rs.length : 0,
    medianCompetitors: rs.length ? med((r) => r.competitors) : 0,
    medianFare: rs.length ? med((r) => r.fareOneWay) : 0,
    medianAircraft: rs.length ? med((r) => r.aircraftCount) : 0,
  };
});

const report = {
  runs: { seeds: SEEDS, startSeed: START, turns: TURNS, scenario: SCENARIO, difficulty: DIFFICULTY },
  observations: rows.length,
  loadFactorPct: describe(lf),
  /** The headline: how much of the mass sits jammed against the ceiling. */
  atCeilingPct: (100 * rows.filter((r) => r.loadFactor >= r.loadCeiling - 0.005).length) / rows.length,
  marginPct: describe(margins),
  unprofitableSharePct: (100 * unprofitable.length) / rows.length,
  spillShareOfWonPct:
    (100 * sum(rows.map((r) => r.spilledWeekly))) /
    Math.max(1, sum(rows.map((r) => r.paxCarriedWeekly + r.spilledWeekly))),
  byBand: bandStats,
  byPosture: Object.fromEntries(
    [...byPosture.entries()].map(([p, rs]) => [
      p,
      {
        observations: rs.length,
        medianMarginPct: quantile([...rs.map((r) => r.margin * 100)].sort((a, b) => a - b), 0.5),
        medianLoadFactorPct: quantile([...rs.map((r) => r.loadFactor * 100)].sort((a, b) => a - b), 0.5),
        medianFare: quantile([...rs.map((r) => r.fareOneWay)].sort((a, b) => a - b), 0.5),
      },
    ]),
  ),
  competition: {
    uncontested: {
      observations: alone.length,
      medianLoadFactorPct: quantile([...alone.map((r) => r.loadFactor * 100)].sort((a, b) => a - b), 0.5),
      medianMarginPct: quantile([...alone.map((r) => r.margin * 100)].sort((a, b) => a - b), 0.5),
      medianFare: quantile([...alone.map((r) => r.fareOneWay)].sort((a, b) => a - b), 0.5),
    },
    contested: {
      observations: contested.length,
      medianLoadFactorPct: quantile([...contested.map((r) => r.loadFactor * 100)].sort((a, b) => a - b), 0.5),
      medianMarginPct: quantile([...contested.map((r) => r.margin * 100)].sort((a, b) => a - b), 0.5),
      medianFare: quantile([...contested.map((r) => r.fareOneWay)].sort((a, b) => a - b), 0.5),
    },
  },
  namedPairs: namedStats,
  /** Do the levers a player actually pulls move the outcome at all? */
  correlations: {
    aircraftCountVsLoadFactor: correlation(rows.map((r) => r.aircraftCount), rows.map((r) => r.loadFactor)),
    aircraftCountVsMargin: correlation(rows.map((r) => r.aircraftCount), rows.map((r) => r.margin)),
    distanceVsMargin: correlation(rows.map((r) => r.distanceKm), rows.map((r) => r.margin)),
    competitorsVsLoadFactor: correlation(rows.map((r) => r.competitors), rows.map((r) => r.loadFactor)),
    competitorsVsMargin: correlation(rows.map((r) => r.competitors), rows.map((r) => r.margin)),
    demandVsLoadFactor: correlation(rows.map((r) => r.marketDemandWeekly), rows.map((r) => r.loadFactor)),
    capacityVsLoadFactor: correlation(rows.map((r) => r.capacityWeekly), rows.map((r) => r.loadFactor)),
  },
};

if (JSON_OUT) {
  console.log(JSON.stringify(report, null, 2));
} else {
  const pct = (n: number): string => `${n.toFixed(1)}%`;
  const row = (label: string, d: Record<string, number>): string =>
    `${label.padEnd(22)} ${d['p5']!.toFixed(1).padStart(7)} ${d['p25']!.toFixed(1).padStart(7)} ` +
    `${d['median']!.toFixed(1).padStart(7)} ${d['p75']!.toFixed(1).padStart(7)} ${d['p95']!.toFixed(1).padStart(7)}`;

  console.log(`\nAir Honcho — demand audit: ${SEEDS} seeds x ${TURNS} turns, ${SCENARIO}/${DIFFICULTY}`);
  console.log(`${rows.length.toLocaleString('en-US')} sector-quarters observed\n`);

  console.log('                              p5     p25  median     p75     p95');
  console.log(row('load factor %', report.loadFactorPct));
  console.log(row('margin %', report.marginPct));
  console.log(`\nat the load ceiling      ${pct(report.atCeilingPct)}`);
  console.log(`unprofitable sectors     ${pct(report.unprofitableSharePct)}`);
  console.log(`demand won then spilled  ${pct(report.spillShareOfWonPct)}`);

  console.log('\nLoad-factor distribution (%)');
  for (const line of histogram(lf, 0, 100, 20)) console.log('  ' + line);

  console.log('\nMargin distribution (%)');
  for (const line of histogram(margins.map((m) => Math.max(-100, Math.min(100, m))), -100, 100, 20)) {
    console.log('  ' + line);
  }

  console.log('\nBy distance band');
  console.log('  band     n        share   LF med   margin med   unprofitable   fare med   a/c med');
  for (const b of BANDS) {
    const d = bandStats[b];
    console.log(
      `  ${b.padEnd(8)} ${String(d.observations).padStart(7)} ${pct(d.sharePct).padStart(7)} ` +
      `${d.loadFactorPct['median']!.toFixed(1).padStart(8)} ${d.marginPct['median']!.toFixed(1).padStart(12)} ` +
      `${pct(d.unprofitablePct).padStart(14)} ${('$' + d.medianFare.toFixed(0)).padStart(10)} ` +
      `${d.medianAircraft.toFixed(1).padStart(9)}`,
    );
  }

  console.log('\nNamed sectors (the symptom called these out)');
  console.log('  pair        n       LF %   margin %   unprofitable   rivals   fare   a/c');
  for (const d of namedStats) {
    console.log(
      `  ${d.pair.padEnd(10)} ${String(d.observations).padStart(6)} ${d.medianLoadFactorPct.toFixed(1).padStart(8)} ` +
      `${d.medianMarginPct.toFixed(1).padStart(10)} ${pct(d.unprofitablePct).padStart(14)} ` +
      `${d.medianCompetitors.toFixed(1).padStart(8)} ${('$' + d.medianFare.toFixed(0)).padStart(6)} ${d.medianAircraft.toFixed(1).padStart(5)}`,
    );
  }

  console.log('\nBy posture (median)');
  console.log('  posture       n        LF %    margin %    fare');
  for (const [p, d] of Object.entries(report.byPosture) as [string, Record<string, number>][]) {
    console.log(
      `  ${p.padEnd(12)} ${String(d['observations']).padStart(7)} ${d['medianLoadFactorPct']!.toFixed(1).padStart(8)} ` +
      `${d['medianMarginPct']!.toFixed(1).padStart(11)} ${('$' + d['medianFare']!.toFixed(0)).padStart(8)}`,
    );
  }

  console.log('\nCompetition');
  for (const [k, d] of Object.entries(report.competition) as [string, Record<string, number>][]) {
    console.log(
      `  ${k.padEnd(12)} n=${String(d['observations']).padStart(7)}  LF ${d['medianLoadFactorPct']!.toFixed(1)}%` +
      `  margin ${d['medianMarginPct']!.toFixed(1)}%  fare $${d['medianFare']!.toFixed(0)}`,
    );
  }

  console.log('\nCorrelations (input -> outcome)');
  for (const [k, v] of Object.entries(report.correlations)) {
    console.log(`  ${k.padEnd(28)} ${v.toFixed(3).padStart(7)}`);
  }
  console.log();
}
