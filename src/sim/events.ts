/**
 * The event deck. Drawn once a quarter; each card is pure data from events.json
 * and takes effect by moving operating conditions for a stretch of turns.
 *
 * There is no bespoke code per event, per CLAUDE.md §6 — adding one is a JSON
 * entry. Everything an event can do is expressed as multipliers in
 * `conditions.ts`, and nothing downstream knows an event happened.
 */
import eventData from '../data/events.json' with { type: 'json' };
import type { ActiveEffect, GameState, Region } from './types.ts';
import type { Rng } from './rng.ts';
import { CONSTANTS, difficultyMods } from './world.ts';

export interface EventCard {
  readonly id: string;
  readonly name: string;
  readonly blurb: string;
  readonly tone: 'good' | 'bad';
  readonly weight: number;
  readonly minTurn: number;
  readonly minDuration: number;
  readonly maxDuration: number;
  readonly effects: Record<string, number>;
  /**
   * Effects whose SIZE is rolled when the card is drawn, `[min, max]` per key.
   *
   * Duration was always rolled; the bite never was, so a card played the same way
   * every time it appeared and a player who had seen it once knew exactly what it
   * cost. A ranged effect is drawn fresh each time, so the same headline can be a
   * scare or a serious problem. Merged over `effects`, so a card may fix some keys
   * and roll others.
   */
  readonly effectRange?: Record<string, readonly [number, number]>;
  readonly scope?: { readonly regions?: Region[]; readonly aircraftKlass?: string };
  /** A crisis during which distressed carriers may take a government bailout. */
  readonly crisis?: boolean;
  /**
   * A mutual-exclusion group. Two cards on the same axis are contradictions — an
   * oil glut cannot run during an oil spike — so at most one card per group is
   * ever live at once. Ungrouped cards stack freely.
   */
  readonly group?: string;
}

export const EVENTS: readonly EventCard[] = Object.freeze(
  eventData.events as unknown as EventCard[],
);

const BY_ID = new Map(EVENTS.map((e) => [e.id, e]));

export interface HistoricalEntry {
  readonly year: number;
  readonly quarter: number;
  readonly eventId: string;
  /**
   * How long this beat runs, in quarters. Defaults to the card's `maxDuration`.
   *
   * A scripted beat used to take the maximum always, which quietly turned the 2001
   * recession into a THREE-YEAR continuous slump: the card allows 4-12 quarters and
   * the script took 12 every time, with September 11 stacking on top of the middle
   * of it. Measured, 70% of games died inside that trench. A real date deserves a
   * real length, and the deck's random range is not a statement about any particular
   * recession.
   */
  readonly durationQuarters?: number;
}
/**
 * The scripted beats of the history scenario. Exported so the content tests can
 * see it: a card carrying `weight: 0` — sept11 and covid, which must never turn
 * up at random in a present-day game — is reachable ONLY through this list, and
 * nothing at runtime would notice if it fell off.
 */
export const HISTORICAL = (eventData as unknown as { historical?: HistoricalEntry[] }).historical ?? [];

/**
 * The scripted historical event due this turn, if any — fired only in the
 * history scenario, on top of the random deck. Real beats on real dates.
 */
export function scheduledEvent(state: GameState): ActiveEffect | null {
  if (state.scenario !== 'history') return null;
  const qpy = CONSTANTS.game.quartersPerYear;
  for (const h of HISTORICAL) {
    const turn = (h.year - state.startYear) * qpy + (h.quarter - 1);
    if (turn !== state.turn) continue;
    const card = BY_ID.get(h.eventId);
    if (!card) continue;
    // The beat's own length when it states one; the card's maximum otherwise.
    const duration = h.durationQuarters ?? card.maxDuration;
    return {
      source: card.id,
      kind: 'event',
      until: state.turn + duration,
      effects: card.effects,
      ...(card.scope ? { scope: card.scope } : {}),
    };
  }
  return null;
}

/** Is a crisis (bailouts available) currently in force? */
export function isCrisisActive(state: GameState): boolean {
  return state.events.some((e) => BY_ID.get(e.source)?.crisis === true);
}

export function getEvent(id: string): EventCard {
  const found = BY_ID.get(id);
  if (!found) throw new Error(`Unknown event: ${id}`);
  return found;
}

/** The mutual-exclusion group of an event, if it has one. */
export function eventGroup(id: string): string | undefined {
  return BY_ID.get(id)?.group;
}

/** The exclusion groups currently occupied by running events. */
function liveGroups(state: GameState): Set<string> {
  const groups = new Set<string>();
  for (const e of state.events) {
    const g = BY_ID.get(e.source)?.group;
    if (g) groups.add(g);
  }
  return groups;
}

/** Expire anything whose run has ended. */
export function pruneEffects(effects: readonly ActiveEffect[], turn: number): ActiveEffect[] {
  return effects.filter((e) => e.until === null || e.until > turn);
}

/**
 * Maybe draw a card. At most one event starts per quarter, so the board can
 * follow what is happening to it — two simultaneous shocks read as noise.
 * An event already running is not drawn again.
 */
export function drawEvent(state: GameState, rng: Rng): ActiveEffect | null {
  // Difficulty scales the random deck's draw rate — more disasters on hard, fewer
  // on easy. History's SCRIPTED crises come through a separate path and are untouched.
  if (!rng.chance(CONSTANTS.events.chancePerQuarter * difficultyMods(state.difficulty).eventChance)) return null;

  const running = new Set(state.events.map((e) => e.source));
  // Never draw a card already running, nor one whose axis is already in play — an
  // oil glut must not open on top of an oil spike.
  const groups = liveGroups(state);
  const eligible = EVENTS.filter(
    (e) => state.turn >= e.minTurn && !running.has(e.id) && !(e.group !== undefined && groups.has(e.group)),
  );
  if (eligible.length === 0) return null;

  const total = eligible.reduce((sum, e) => sum + e.weight, 0);
  let roll = rng.float(0, total);
  const card = eligible.find((e) => (roll -= e.weight) <= 0) ?? eligible[eligible.length - 1]!;

  const duration = rng.int(card.minDuration, card.maxDuration);
  return {
    source: card.id,
    kind: 'event',
    until: state.turn + duration,
    effects: rollEffects(card, rng),
    ...(card.scope ? { scope: card.scope } : {}),
  };
}

/**
 * A card's effects for this appearance, with any ranged ones rolled.
 *
 * The whole mechanism behind the chaos card, and it stays inside the rule that
 * events are data: no card gets code of its own, they simply declare which of their
 * effects vary and between what. A card that declares none behaves exactly as it
 * always has, so this is additive to the deck rather than a change to it.
 */
/** Test seam for `rollEffects`; the draw path calls the private one directly. */
export function rollEffectsForTest(card: EventCard, rng: Rng): Record<string, number> {
  return rollEffects(card, rng);
}

function rollEffects(card: EventCard, rng: Rng): Record<string, number> {
  if (!card.effectRange) return card.effects;
  const rolled: Record<string, number> = { ...card.effects };
  // Object key order is insertion order and the data file is fixed, so the draw
  // sequence is stable — the same seed rolls the same storm.
  for (const [key, span] of Object.entries(card.effectRange)) {
    rolled[key] = rng.float(span[0], span[1]);
  }
  return rolled;
}

/**
 * Jet fuel, as a mean-reverting walk in log space.
 *
 * Real crude wanders a long way but does not run off to zero or infinity — it
 * pulls back toward a long-run level. A plain random walk would eventually do
 * something absurd over a hundred quarters. Reversion strength and volatility
 * both live in constants.json.
 */
export function walkFuelPrice(price: number, rng: Rng): number {
  const f = CONSTANTS.events;
  const logMean = Math.log(CONSTANTS.game.startingFuelPricePerL);
  const drift = f.fuelReversion * (logMean - Math.log(price));
  const next = Math.exp(Math.log(price) + drift + rng.normal(0, f.fuelVolatility));
  return Math.min(f.fuelPriceMax, Math.max(f.fuelPriceMin, next));
}

/**
 * Baseline share of the schedule that operates, before any event.
 *
 * Airlines cancel a small but variable slice of flights every quarter to
 * weather, technical faults and air traffic control. This is the one source of
 * variance that reaches a sold-out sector, because it takes away seats rather
 * than passengers.
 */
export function rollCompletion(rng: Rng): number {
  const c = CONSTANTS.events;
  const draw = c.completionMean + rng.normal(0, c.completionStdDev);
  return Math.min(1, Math.max(c.completionFloor, draw));
}
