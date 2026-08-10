/**
 * Offline tuning harness — the balance instrument for the RIVAL brains, the way
 * `simulate` is the instrument for the player's economy.
 *
 * Nothing here ships. It runs the sim many times over seeded games, scores each
 * archetype on how it actually does against the others, and prints numbers a human
 * pastes into `archetypes.json`. The game itself stays pure data + deterministic
 * code, per CLAUDE.md §6 — no model, no network, no dependency at runtime.
 *
 * Two modes:
 *
 *   compare — A/B one knob head to head. Gives ONE archetype the variant value and
 *             leaves the others at baseline, so the question is "does this actually
 *             win?" rather than "did the world change?". This is the honest test of
 *             a proposed AI improvement: a change that lifts everyone equally may
 *             just be inflation, and a change that helps its holder BEAT the others
 *             is a real edge.
 *
 *   search  — hill-climb a set of numeric knobs for one archetype, keeping a change
 *             only when it raises that archetype's share of industry value across
 *             every seed. Guarded against the §9 failure mode: a candidate that
 *             pushes one archetype past `dominanceCap` of the industry is rejected
 *             however good its score, because a single dominant strategy is exactly
 *             what the doctrine says to avoid.
 *
 * Usage:
 *   npm run tune -- --mode compare --archetype ulcc --knob appraisalQuarters --values 1,8
 *   npm run tune -- --mode search  --archetype legacy --knobs incursionAppetite,growthDrag --iters 20
 */
import { parseArgs } from 'node:util';
import { newGame, endTurn } from '../src/sim/engine.ts';
import { marketCap } from '../src/sim/market.ts';
import { CITIES } from '../src/sim/world.ts';
import { Rng } from '../src/sim/rng.ts';
import {
  clearArchetypeOverrides, getArchetype, setArchetypeOverrides,
} from '../src/sim/ai/archetype.ts';
import type { Difficulty, GameState } from '../src/sim/types.ts';

const { values } = parseArgs({
  options: {
    mode: { type: 'string', default: 'compare' },
    archetype: { type: 'string', default: 'ulcc' },
    knob: { type: 'string' },
    knobs: { type: 'string' },
    values: { type: 'string', default: '1,8' },
    games: { type: 'string', default: '12' },
    turns: { type: 'string', default: '60' },
    seed: { type: 'string', default: '500' },
    iters: { type: 'string', default: '15' },
    step: { type: 'string', default: '0.25' },
    difficulty: { type: 'string', default: 'medium' },
    help: { type: 'boolean', default: false },
  },
});

if (values.help) {
  console.log(`
Usage: npm run tune -- [options]

  --mode <compare|search>  compare: A/B one knob head to head. search: hill-climb knobs.
  --archetype <id>         Which archetype to tune (ulcc, legacy, flag, rollup).
  --knob <name>            compare: the knob to vary.
  --values <a,b>           compare: the two values to pit against each other.
  --knobs <a,b,c>          search: numeric knobs to hill-climb.
  --iters <n>              search: candidate steps to try (default 15).
  --step <f>               search: relative step size (default 0.25).
  --games <n>              Seeded games per evaluation (default 12).
  --turns <n>              Turns per game (default 60 — long enough to separate, short enough to iterate).
  --seed <n>               First seed (default 500).
  --difficulty <d>         easy | medium | hard (default medium).
`);
  process.exit(0);
}

const ARCHETYPE = String(values.archetype);
const GAMES = Number(values.games);
const TURNS = Number(values.turns);
const SEED0 = Number(values.seed);
const DIFFICULTY = String(values.difficulty) as Difficulty;

/** What one seeded game says about every archetype. */
interface Outcome {
  /** Archetype id -> total market cap of its solvent carriers. */
  readonly valueByArchetype: Map<string, number>;
  /** Archetype id -> [solvent, entered]. */
  readonly survival: Map<string, { live: number; total: number }>;
  readonly industryValue: number;
}

function runOne(seed: number): Outcome {
  // Same home-city draw as the headless runner, so tuning games look like real ones.
  const home = Rng.fromSeed(seed ^ 0x5f3759df).pick(CITIES).id;
  let s: GameState = newGame(seed, home, 'Fixture', { difficulty: DIFFICULTY });
  for (let i = 0; i < TURNS && !s.gameOver; i++) s = endTurn(s);

  const valueByArchetype = new Map<string, number>();
  const survival = new Map<string, { live: number; total: number }>();
  let industryValue = 0;
  for (const c of s.carriers) {
    if (c.isPlayer || !c.archetypeId) continue;
    const row = survival.get(c.archetypeId) ?? { live: 0, total: 0 };
    row.total += 1;
    if (c.bankruptTurn === null) {
      row.live += 1;
      const v = Math.max(0, marketCap(s, c));
      valueByArchetype.set(c.archetypeId, (valueByArchetype.get(c.archetypeId) ?? 0) + v);
      industryValue += v;
    }
    survival.set(c.archetypeId, row);
  }
  return { valueByArchetype, survival, industryValue };
}

/** Mean share of industry value, and survival rate, for `archetype` across the games. */
function evaluate(): { share: number; survival: number; industry: number; shares: Map<string, number> } {
  let shareSum = 0;
  let live = 0;
  let total = 0;
  let industry = 0;
  const sharesSum = new Map<string, number>();
  for (let i = 0; i < GAMES; i++) {
    const o = runOne(SEED0 + i);
    if (o.industryValue > 0) {
      shareSum += (o.valueByArchetype.get(ARCHETYPE) ?? 0) / o.industryValue;
      for (const [id, v] of o.valueByArchetype) {
        sharesSum.set(id, (sharesSum.get(id) ?? 0) + v / o.industryValue);
      }
    }
    const row = o.survival.get(ARCHETYPE);
    if (row) { live += row.live; total += row.total; }
    industry += o.industryValue;
  }
  const shares = new Map<string, number>();
  for (const [id, v] of sharesSum) shares.set(id, v / GAMES);
  return {
    share: shareSum / GAMES,
    survival: total > 0 ? live / total : 0,
    industry: industry / GAMES,
    shares,
  };
}

const pct = (v: number): string => `${(v * 100).toFixed(1)}%`;
const usd = (v: number): string => `$${(v / 1e6).toFixed(0)}M`;

if (values.mode === 'compare') {
  const knob = String(values.knob ?? 'appraisalQuarters');
  const [a, b] = String(values.values).split(',').map(Number);
  if (!Number.isFinite(a) || !Number.isFinite(b)) {
    console.error('--values must be two numbers, e.g. 1,8');
    process.exit(1);
  }
  console.log(
    `A/B on ${ARCHETYPE}.${knob}: ${a} vs ${b} — ${GAMES} games x ${TURNS} turns, ${DIFFICULTY}.\n` +
      `Only ${ARCHETYPE} changes; every other archetype stays at baseline, so this measures\n` +
      `whether the knob WINS rather than whether the world moved.\n`,
  );
  const rows: { value: number; share: number; survival: number; industry: number }[] = [];
  for (const v of [a, b] as number[]) {
    setArchetypeOverrides({ [ARCHETYPE]: { [knob]: v } });
    const r = evaluate();
    rows.push({ value: v, ...r });
    console.log(
      `  ${knob}=${String(v).padEnd(5)} | ${ARCHETYPE} share of industry value ${pct(r.share).padStart(6)}` +
        ` | its survival ${pct(r.survival).padStart(6)} | industry ${usd(r.industry)}`,
    );
  }
  clearArchetypeOverrides();
  const [x, y] = rows as [typeof rows[0], typeof rows[0]];
  const better = y.share > x.share ? y : x;
  const delta = Math.abs(y.share - x.share);
  console.log(
    `\n  -> ${knob}=${better.value} wins by ${pct(delta)} of industry value.` +
      (delta < 0.01 ? '  (inside noise — treat as no effect)' : ''),
  );
} else if (values.mode === 'search') {
  const knobs = String(values.knobs ?? 'incursionAppetite').split(',').map((k) => k.trim()).filter(Boolean);
  const iters = Number(values.iters);
  const step = Number(values.step);
  const dominanceCap = 0.6;

  // Baseline: the archetype's current numbers, read straight from the data.
  clearArchetypeOverrides();
  const arch = getArchetype(ARCHETYPE) as unknown as Record<string, number>;
  const current: Record<string, number> = {};
  for (const k of knobs) {
    if (typeof arch[k] !== 'number') {
      console.error(`${ARCHETYPE}.${k} is not a number in archetypes.json — cannot search it.`);
      process.exit(1);
    }
    current[k] = arch[k];
  }

  let best = evaluate();
  console.log(
    `Hill-climbing ${ARCHETYPE} on [${knobs.join(', ')}] — ${GAMES} games x ${TURNS} turns, ${DIFFICULTY}.\n` +
      `Score = ${ARCHETYPE}'s mean share of industry value. A candidate that pushes any archetype\n` +
      `past ${pct(dominanceCap)} is rejected outright (§9: no single dominant strategy).\n`,
  );
  console.log(`  baseline ${JSON.stringify(current)} -> ${pct(best.share)}`);

  // Coordinate descent rather than random sampling: with a handful of knobs, a
  // random walk can spend every iteration on one of them (and did), leaving the
  // rest untested. This walks (knob, direction) pairs in order, so a run of N
  // iterations is a guarantee about what was tried rather than a hope.
  for (let i = 0; i < iters; i++) {
    const knob = knobs[Math.floor(i / 2) % knobs.length]!;
    const direction = i % 2 === 0 ? 1 + step : 1 - step;
    const candidate = { ...current, [knob]: Number((current[knob]! * direction).toFixed(4)) };
    setArchetypeOverrides({ [ARCHETYPE]: candidate });
    const r = evaluate();
    const dominant = [...r.shares.entries()].some(([, v]) => v > dominanceCap);
    const verdict = dominant ? 'REJECTED (dominant)' : r.share > best.share ? 'KEEP' : 'worse';
    console.log(
      `  ${String(i + 1).padStart(2)}/${iters} ${knob}=${String(candidate[knob]).padEnd(7)} -> ${pct(r.share).padStart(6)}  ${verdict}`,
    );
    if (!dominant && r.share > best.share) {
      best = r;
      current[knob] = candidate[knob]!;
    }
  }
  clearArchetypeOverrides();
  console.log(`\n  best found: ${JSON.stringify(current)} -> ${pct(best.share)}`);
  console.log('  Paste into src/data/archetypes.json only after re-running the full suite and simulate.');
} else {
  console.error('--mode must be "compare" or "search".');
  process.exit(1);
}
