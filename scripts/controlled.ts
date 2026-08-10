/**
 * Controlled lever experiment — the other half of the demand audit.
 *
 * `analyze.ts` is observational, so its posture and competition splits are
 * confounded: the AI CHOOSES undercut on the routes that suit undercutting, and
 * rivals ENTER the markets worth entering. Comparing those groups measures the
 * selection as much as the lever.
 *
 * This holds a sector, a fleet and the world fixed and moves exactly one thing at
 * a time, which is the only way to answer "how much does this decision actually
 * buy the player".
 *
 *   npm run controlled
 */
import { newGame } from '../src/sim/engine.ts';
import { computeRouteEconomics } from '../src/sim/economics.ts';
import { NEUTRAL } from '../src/sim/conditions.ts';
import { AIRCRAFT_TYPES, canReach, getAircraftType } from '../src/sim/fleet.ts';
import { cityDistanceKm } from '../src/sim/world.ts';
import type { Aircraft, PricingPosture, Route } from '../src/sim/types.ts';

const POSTURES: readonly PricingPosture[] = ['premium', 'match', 'undercut'];

/** Representative sectors, one per distance band plus the two the symptom named. */
const SECTORS: readonly (readonly [string, string, string])[] = [
  ['LON', 'PAR', 'short, dense'],
  ['NYC', 'CHI', 'short, dense'],
  ['LON', 'IST', 'medium'],
  ['NYC', 'LAX', 'medium, transcon'],
  ['LON', 'NYC', 'long, transatlantic'],
  ['PAR', 'NYC', 'long, transatlantic'],
  ['LON', 'SIN', 'ultra-long'],
];

const state = newGame(1, 'LON');
const usd = (n: number): string => {
  const m = n / 1e6;
  return `${m < 0 ? '-' : ''}$${Math.abs(m).toFixed(2)}M`;
};

function tails(typeId: string, n: number): Aircraft[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `probe-${i}`,
    typeId,
    ownership: 'leased' as const,
    acquiredTurn: 0,
    deliversTurn: 0,
    bookValue: 0,
    routeId: 'r',
  }));
}

function priced(
  from: string,
  to: string,
  typeId: string,
  count: number,
  posture: PricingPosture,
  rivalAttractiveness = 0,
  rivalCapacity = 0,
): { net: number; lf: number; fare: number; rev: number } {
  const route: Route = { id: 'r', carrierId: 'player', from, to, posture, openedTurn: 0 };
  const econ = computeRouteEconomics(
    route, tails(typeId, count), state.turn, NEUTRAL, rivalAttractiveness, rivalCapacity, 1,
  );
  return { net: econ.netCash, lf: econ.loadFactor, fare: econ.fareOneWay, rev: econ.revenue };
}

/** The best type/count the sector supports, so every lever is judged on a sane build. */
function bestBuild(from: string, to: string, posture: PricingPosture): { typeId: string; count: number; net: number } {
  const dist = cityDistanceKm(from, to);
  let best = { typeId: '', count: 0, net: -Infinity };
  for (const type of AIRCRAFT_TYPES) {
    if (!canReach(type, dist)) continue;
    for (let n = 1; n <= 6; n++) {
      const { net } = priced(from, to, type.id, n, posture);
      if (net > best.net) best = { typeId: type.id, count: n, net };
    }
  }
  return best;
}

console.log('\nControlled lever experiment — one sector, one fleet, one thing changed at a time\n');

// --- 1. Posture ------------------------------------------------------------
console.log('POSTURE: quarterly net on the sector\'s best build, by posture');
console.log('  sector            km     build            premium        match      undercut    swing');
for (const [a, b, label] of SECTORS) {
  const dist = cityDistanceKm(a, b);
  const build = bestBuild(a, b, 'match');
  if (!build.typeId) continue;
  const nets = POSTURES.map((p) => priced(a, b, build.typeId, build.count, p).net);
  const lo = Math.min(...nets);
  const hi = Math.max(...nets);
  const base = Math.abs(nets[1]!); // match
  const swing = base > 0 ? (100 * (hi - lo)) / base : 0;
  console.log(
    `  ${(a + '–' + b).padEnd(10)} ${String(Math.round(dist)).padStart(6)}  ` +
    `${(build.count + '× ' + getAircraftType(build.typeId).name).padEnd(16)}` +
    nets.map((n) => usd(n).padStart(13)).join('') +
    `  ${swing.toFixed(0).padStart(5)}%   ${label}`,
  );
}

// --- 2. Gauge --------------------------------------------------------------
console.log('\nGAUGE: quarterly net by aircraft type, 1 frame, match posture');
for (const [a, b, label] of SECTORS) {
  const dist = cityDistanceKm(a, b);
  const options = AIRCRAFT_TYPES
    .filter((t) => canReach(t, dist))
    .map((t) => ({ name: t.name, seats: t.seats, ...priced(a, b, t.id, 1, 'match') }))
    .sort((x, y) => y.net - x.net);
  if (options.length === 0) continue;
  const best = options[0]!;
  const worst = options[options.length - 1]!;
  const spread = Math.abs(best.net) > 0 ? (100 * (best.net - worst.net)) / Math.abs(best.net) : 0;
  console.log(
    `  ${(a + '–' + b).padEnd(10)} ${String(options.length).padStart(2)} types  ` +
    `best ${best.name.padEnd(12)} ${usd(best.net).padStart(10)} (${best.seats}s)   ` +
    `worst ${worst.name.padEnd(12)} ${usd(worst.net).padStart(10)} (${worst.seats}s)   spread ${spread.toFixed(0)}%  ${label}`,
  );
}

// --- 3. Competition --------------------------------------------------------
console.log('\nCOMPETITION: same build, rivals added to the market');
console.log('  sector       alone        1 rival       2 rivals     dent(1)  dent(2)');
for (const [a, b] of SECTORS) {
  const build = bestBuild(a, b, 'match');
  if (!build.typeId) continue;
  // A rival of comparable size: same attractiveness and capacity this build offers.
  const mine = priced(a, b, build.typeId, build.count, 'match');
  const self = computeRouteEconomics(
    { id: 'r', carrierId: 'player', from: a, to: b, posture: 'match', openedTurn: 0 },
    tails(build.typeId, build.count), state.turn, NEUTRAL, 0, 0, 1,
  );
  // Attractiveness is not exported directly; approximate a like-for-like rival by
  // giving the market one more carrier of the same capacity and pull.
  const pull = self.demandShare > 0 ? (self.demandShare / (1 - self.demandShare)) : 1;
  const one = priced(a, b, build.typeId, build.count, 'match', pull, self.capacityWeekly);
  const two = priced(a, b, build.typeId, build.count, 'match', pull * 2, self.capacityWeekly * 2);
  const d1 = mine.net !== 0 ? (100 * (mine.net - one.net)) / Math.abs(mine.net) : 0;
  const d2 = mine.net !== 0 ? (100 * (mine.net - two.net)) / Math.abs(mine.net) : 0;
  console.log(
    `  ${(a + '–' + b).padEnd(10)} ${usd(mine.net).padStart(11)} ${usd(one.net).padStart(13)} ` +
    `${usd(two.net).padStart(14)} ${d1.toFixed(0).padStart(8)}% ${d2.toFixed(0).padStart(7)}%`,
  );
}

// --- 4. Where the load ceiling binds ---------------------------------------
console.log('\nHEADROOM: demand offered to one frame vs the seats it has');
console.log('  sector       demand/wk   share   won/wk   seats/wk   ratio   LF     spilled');
for (const [a, b] of SECTORS) {
  const build = bestBuild(a, b, 'match');
  if (!build.typeId) continue;
  const route: Route = { id: 'r', carrierId: 'player', from: a, to: b, posture: 'match', openedTurn: 0 };
  const e = computeRouteEconomics(route, tails(build.typeId, build.count), state.turn, NEUTRAL, 0, 0, 1);
  const won = e.paxCarriedWeekly + e.spilledWeekly;
  console.log(
    `  ${(a + '–' + b).padEnd(10)} ${Math.round(e.marketDemandWeekly).toLocaleString('en-US').padStart(10)} ` +
    `${(100 * e.demandShare).toFixed(0).padStart(6)}% ${Math.round(won).toLocaleString('en-US').padStart(8)} ` +
    `${Math.round(e.capacityWeekly).toLocaleString('en-US').padStart(10)} ` +
    `${(won / Math.max(1, e.capacityWeekly)).toFixed(2).padStart(7)} ${(100 * e.loadFactor).toFixed(1).padStart(6)}% ` +
    `${Math.round(e.spilledWeekly).toLocaleString('en-US').padStart(9)}`,
  );
}
// --- 5. Fuel sensitivity ---------------------------------------------------
// Long-haul burns most of its cost in fuel, so a walk that is a nuisance on a
// short sector can be fatal on a transatlantic one. This is the likeliest
// mechanism behind "long-haul loses money while everything else prints".
console.log('\nFUEL: quarterly net on the best build as the spot price walks ($/L)');
console.log('  sector          $0.50        $0.80        $1.20        $1.80       break-even');
for (const [a, b] of SECTORS) {
  const build = bestBuild(a, b, 'match');
  if (!build.typeId) continue;
  const route: Route = { id: 'r', carrierId: 'player', from: a, to: b, posture: 'match', openedTurn: 0 };
  const at = (fuel: number): number =>
    computeRouteEconomics(
      route, tails(build.typeId, build.count), state.turn,
      { ...NEUTRAL, fuelPrice: fuel }, 0, 0, 1,
    ).netCash;
  const nets = [0.5, 0.8, 1.2, 1.8].map(at);
  // Where does it cross zero? Bisect; the relationship is monotone in fuel.
  let lo = 0.1;
  let hi = 12;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (at(mid) > 0) lo = mid;
    else hi = mid;
  }
  console.log(
    `  ${(a + '–' + b).padEnd(10)} ${nets.map((n) => usd(n).padStart(12)).join(' ')}   ` +
    `${hi < 11.9 ? '$' + hi.toFixed(2) + '/L' : 'never'}`,
  );
}

// --- 6. Widebody on the transatlantic --------------------------------------
console.log('\nGAUGE ON LON–NYC: is a widebody ever the answer?');
console.log('  type              seats   1 frame      3 frames     6 frames');
for (const type of AIRCRAFT_TYPES) {
  if (!canReach(type, cityDistanceKm('LON', 'NYC'))) continue;
  if (type.seats < 200) continue;
  const nets = [1, 3, 6].map((n) => priced('LON', 'NYC', type.id, n, 'match').net);
  console.log(
    `  ${type.name.padEnd(16)} ${String(type.seats).padStart(5)} ` +
    nets.map((n) => usd(n).padStart(13)).join(''),
  );
}
console.log();
