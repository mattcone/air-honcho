/**
 * Headless game runner — the balance-tuning instrument. Runs on Node's native
 * TypeScript support; no build step.
 *
 *   npm run simulate -- --seed 42 --turns 100 --players ai
 *   npm run simulate -- --seed 42 --games 20 --json
 *
 * Any balance change should include before/after output from this script in the
 * commit message.
 */
import { parseArgs } from 'node:util';
import { runGames } from '../src/sim/headless.ts';
import { turnLabel } from '../src/sim/engine.ts';
import { CONSTANTS } from '../src/sim/world.ts';
import type { Difficulty } from '../src/sim/types.ts';

const { values } = parseArgs({
  options: {
    seed: { type: 'string', default: '42' },
    turns: { type: 'string' },
    games: { type: 'string', default: '1' },
    players: { type: 'string', default: 'ai' },
    scenario: { type: 'string', default: 'present' },
    difficulty: { type: 'string', default: 'medium' },
    json: { type: 'boolean', default: false },
    help: { type: 'boolean', default: false },
  },
});

if (values.help) {
  console.log(`
Usage: npm run simulate -- [options]

  --seed <n>       Starting seed (default 42). With --games > 1, runs seed..seed+games-1.
  --turns <n>      Turns per game (default: the scenario's full horizon).
  --games <n>      Number of games to run (default 1).
  --scenario <s>   "present" (2026, 100 turns) or "history" (2000, 200 turns). Default present.
  --difficulty <s> "easy", "medium" or "hard". Default medium.
  --players <s>    Only "ai" is supported in Phase 0.
  --json           Emit JSON instead of a table.
`);
  process.exit(0);
}

const scenario = values.scenario === 'history' ? 'history' : 'present';
if (values.scenario !== 'present' && values.scenario !== 'history') {
  console.error('--scenario must be "present" or "history".');
  process.exit(1);
}

if (values.difficulty !== 'easy' && values.difficulty !== 'medium' && values.difficulty !== 'hard') {
  console.error('--difficulty must be "easy", "medium" or "hard".');
  process.exit(1);
}
const difficulty = values.difficulty as Difficulty;

const seed = Number(values.seed);
const turns = values.turns !== undefined ? Number(values.turns) : CONSTANTS.scenarios[scenario].horizonTurns;
const games = Number(values.games);

for (const [name, value, min] of [
  ['seed', seed, 0],
  ['turns', turns, 1],
  ['games', games, 1],
] as const) {
  if (!Number.isInteger(value) || value < min) {
    console.error(`--${name} must be an integer >= ${min}.`);
    process.exit(1);
  }
}

if (values.players !== 'ai') {
  console.error('Phase 0 supports --players ai only.');
  process.exit(1);
}

const results = runGames(seed, games, turns, scenario, difficulty);

if (values.json) {
  console.log(JSON.stringify({ turns, games, results }, null, 2));
} else {
  const usd = (n: number): string => `${n < 0 ? '-' : ''}$${(Math.abs(n) / 1e6).toFixed(1)}M`;
  const pad = (s: string | number, width: number): string => String(s).padEnd(width);

  const pct = (n: number): string => `${(n * 100).toFixed(0)}%`;

  console.log(`Air Honcho — headless: ${games} game(s) x ${turns} turns\n`);
  console.log(
    [pad('seed', 7), pad('home', 6), pad('ended', 9), pad('sec', 5), pad('fleet', 6), pad('net worth', 12), pad('LF', 5), pad('rivals', 7), pad('their sec', 10), pad('share', 7), 'outcome'].join(''),
  );

  for (const r of results) {
    console.log(
      [
        pad(r.seed, 7),
        pad(r.homeCityId, 6),
        pad(turnLabel(r.turnsPlayed, CONSTANTS.scenarios[scenario].startYear), 9),
        pad(r.routes, 5),
        pad(r.fleet, 6),
        pad(usd(r.finalNetWorth), 12),
        pad(pct(r.finalLoadFactor), 5),
        pad(r.rivals, 7),
        pad(r.rivalRoutes, 10),
        pad(pct(r.playerRouteShare), 7),
        r.bankruptTurn !== null ? `bankrupt T${r.bankruptTurn}` : 'survived',
      ].join(''),
    );
  }

  const survivors = results.filter((r) => r.bankruptTurn === null).length;
  const worth = results.map((r) => r.finalNetWorth).sort((a, b) => a - b);
  const median = worth[Math.floor(worth.length / 2)] as number;
  const meanLf = results.reduce((s, r) => s + r.finalLoadFactor, 0) / results.length;
  const meanRivals = results.reduce((s, r) => s + r.rivals, 0) / results.length;
  const meanShare = results.reduce((s, r) => s + r.playerRouteShare, 0) / results.length;
  console.log(
    `\n${survivors}/${results.length} survived. Median net worth ${usd(median)}. ` +
      `Mean final load factor ${pct(meanLf)}. ` +
      `Mean ${meanRivals.toFixed(1)} rivals alive, player holding ${pct(meanShare)} of sectors.`,
  );
}
