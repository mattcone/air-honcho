/**
 * The quarterly board briefing: what changed while the books were closing, shown
 * after every turn. Built by diffing the state before and after the turn, so it
 * reports events — not just the current standings — and leads with the alerts a
 * CEO needs to act on (a cratering share price, a cash crunch, a downgrade)
 * before they become fatal. Pure read of GameState; the modal is dismissible.
 */
import type { GameState } from '../sim/types.ts';
import { getCarrier, turnLabel } from '../sim/engine.ts';
import {
  borrowingCapacity, controls, creditRating, marketCap, sharePrice, trailingEarnings,
} from '../sim/market.ts';
import {
  assignedTo, buildMarketIndex, computeRouteEconomics, feedFactor, marketKey, rivalCapacityOf,
  rivalsOf, stationOverheadFor,
} from '../sim/economics.ts';
import { conditionsFor, klassesOf, marketFuelPrice } from '../sim/conditions.ts';
import { getEvent, isCrisisActive } from '../sim/events.ts';
import { CONSTANTS } from '../sim/world.ts';
import { usd, rate, stake } from './format.ts';
import { splitFlap } from './splitflap.ts';

const FIN = CONSTANTS.finance;
const RATING_ORDER = ['AAA', 'AA', 'A', 'BBB', 'BB', 'B', 'CCC'];
/** A route losing more than this a quarter is worth flagging in the briefing. */
const HEMORRHAGE = 5_000_000;
const MAX_LINES = 6; // per section, so a busy quarter does not become a wall

export interface BriefingAlert {
  readonly tone: 'danger' | 'warn';
  readonly text: string;
}

export interface Briefing {
  readonly quarterLabel: string;
  readonly alerts: readonly BriefingAlert[];
  readonly headline: string;
  /** The headline split in two so the UI can flap the figure while the label holds still. */
  readonly headlineLabel: string;
  readonly headlineValue: string;
  readonly headlineNegative: boolean;
  readonly quarter: readonly string[];
  readonly board: readonly string[];
  readonly world: readonly string[];
  readonly markets: readonly string[];
}

function eventName(id: string): string {
  try { return getEvent(id).name; } catch { return 'An event'; }
}

/**
 * What an event's effects mean, in the units the player thinks in.
 *
 * The deck carries a blurb, a tone, a crisis flag and the actual multipliers for
 * every one of its nineteen cards, and the briefing used to throw all of it away
 * and print "Pandemic scare has begun." A 58% collapse in demand read with less
 * information, and no more weight, than "Fuel rose 8%".
 */
const EFFECT_WORDS: Record<string, string> = {
  demand: 'demand',
  fare: 'fares',
  fuelPrice: 'fuel prices',
  crewCost: 'crew costs',
  maintenanceCost: 'maintenance costs',
  handlingCost: 'ground costs',
  completion: 'flights operating',
  loadCeiling: 'achievable load factor',
};

function describeEffects(effects: Readonly<Record<string, number>>): string {
  const parts: string[] = [];
  for (const [key, value] of Object.entries(effects)) {
    const word = EFFECT_WORDS[key];
    if (!word || !Number.isFinite(value) || value === 1) continue;
    const move = Math.round(Math.abs(1 - value) * 100);
    if (move < 1) continue;
    parts.push(`${word} ${value > 1 ? 'up' : 'down'} ${move}%`);
  }
  // Biggest movement first: on a card that shifts three things, the one that
  // decides the quarter should be the one read first.
  parts.sort((a, b) => Number(b.match(/(\d+)%/)?.[1] ?? 0) - Number(a.match(/(\d+)%/)?.[1] ?? 0));
  return parts.join(', ');
}

/**
 * The consequence clause: what moves, and for how long.
 *
 * Duration leads, so the sentence opens with a capital and the movements read as
 * a list rather than trailing off into one. Written as its own sentence because
 * it follows the card's blurb, which is already a sentence — running the two
 * together produced "...who does not have to. demand down 58%".
 */
function consequence(effects: Readonly<Record<string, number>>, until: number | null, turn: number): string {
  const moved = describeEffects(effects);
  if (!moved) return '';
  const left = until === null ? 0 : until - turn;
  if (left <= 0) return `${moved.charAt(0).toUpperCase()}${moved.slice(1)}.`;
  const window = left === 1 ? 'For one more quarter' : `For ${left} quarters`;
  return `${window}: ${moved}.`;
}

function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] ?? s[v] ?? s[0]!);
}

function cap(lines: string[]): string[] {
  if (lines.length <= MAX_LINES) return lines;
  const extra = lines.length - (MAX_LINES - 1);
  return [...lines.slice(0, MAX_LINES - 1), `…and ${extra} more.`];
}

/** Compare the pre- and post-turn states into a briefing for the player. */
export function buildBriefing(prev: GameState, next: GameState): Briefing {
  const me = getCarrier(next, next.playerCarrierId);
  const mePrev = getCarrier(prev, prev.playerCarrierId);
  const mine = next.history.filter((h) => h.carrierId === me.id);
  const last = mine.at(-1);
  const prevLast = prev.history.filter((h) => h.carrierId === me.id).at(-1);
  const quarterLabel = last ? turnLabel(last.turn - 1, next.startYear) : turnLabel(next.turn - 1, next.startYear);

  const alerts: BriefingAlert[] = [];
  const quarter: string[] = [];
  const board: string[] = [];
  const world: string[] = [];
  const markets: string[] = [];

  // --- Alerts: the things that end games ---
  const equityCap = marketCap(next, me);
  const peak = next.playerPeakEquity;
  const te = trailingEarnings(next, me.id);
  if (next.turn >= FIN.hostileGraceTurns && peak > 0 && equityCap < peak * FIN.craterFraction && te < 0) {
    alerts.push({
      tone: 'danger',
      text: 'Your share price has collapsed and you are losing money — a rival can now seize you in a hostile takeover. Cut debt and get back to profit to lift it out of range.',
    });
  }

  /*
   * A state bailout is the loudest thing that can happen to a balance sheet, and
   * it was completely silent: the settlement lifted cash to the bailout cushion
   * and booked the difference as debt, so a player watching their bank stop at
   * exactly $30M quarter after quarter had no way to tell a rescue from a bug.
   * That is precisely how it was reported.
   */
  if (last?.bailout !== undefined && last.bailout > 0) {
    const left = FIN.maxBailouts - me.bailouts;
    alerts.push({
      tone: 'danger',
      text:
        `You ran out of money and the state stepped in with ${usd(last.bailout)}. ` +
        `It is a loan, not a gift — it is on your balance sheet as debt and it is ` +
        `charging interest. ` +
        (left > 0
          ? `${left === 1 ? 'One more' : `${left} more`} rescue${left === 1 ? '' : 's'} and then the receivers come.`
          : 'There will not be another one.'),
    });
  }

  const crisisRunning = isCrisisActive(next);
  const burn = last
    ? last.fuel + last.crew + last.maintenance + last.handling + last.lease + last.standing +
      last.fixed + last.overhead + last.interest + Math.max(0, last.tax)
    : 0;

  /*
   * The one lever that moves in a downturn, named while it can still be pulled.
   *
   * A crisis empties aircraft; it does not empty the rent on them. Traced through
   * 2001-03 on a North Atlantic carrier, a losing quarter of -$54.5M carried $44.2M
   * of lease — the sectors were still flying at 64-72% load, and it was the fixed
   * bill that did the damage. The only alert that ever mentioned this fired when
   * cash was already under one quarter's costs, far too late to hand metal back,
   * and it said "cut spending" without saying which spending.
   *
   * Fires only when rent is at least half the loss, so it names the lever exactly
   * when pulling it would work, and stays quiet when the problem is somewhere else.
   */
  const crisisLoss = last ? -last.netIncome : 0;
  if (
    crisisRunning && last && crisisLoss > 0
    // Rent alone covers the loss, so handing metal back is a lever that reaches it.
    && last.lease >= crisisLoss
    // ...and the loss is worth acting on: a twentieth of the bank in one quarter.
    && crisisLoss >= me.cash * 0.05
  ) {
    alerts.push({
      tone: 'warn',
      text:
        `A crisis is running and you lost ${usd(crisisLoss)} this quarter while paying ` +
        `${usd(last.lease)} in rent on leased aircraft — more than the loss itself. Rent does ` +
        `not fall when demand does, so handing aircraft back, or closing the sectors bleeding ` +
        `worst, is the lever that reaches this. Every quarter you wait costs the rent again.`,
    });
  }
  if (me.cash >= 0 && burn > 0 && me.cash < burn) {
    alerts.push({
      tone: me.cash < burn * 0.5 ? 'danger' : 'warn',
      text: `Cash is down to ${usd(me.cash)} — under a quarter of running costs. Raise money or cut spending before the bank runs dry.`,
    });
  }

  const ratingNow = creditRating(next, me);
  const ratingWas = creditRating(prev, mePrev);
  if (RATING_ORDER.indexOf(ratingNow) > RATING_ORDER.indexOf(ratingWas)) {
    alerts.push({ tone: 'warn', text: `Credit rating cut from ${ratingWas} to ${ratingNow} — borrowing just got harder.` });
  }

  if (me.debt > 0 && borrowingCapacity(next, me) <= 0) {
    alerts.push({ tone: 'warn', text: 'You have no borrowing headroom left — lenders will not extend more credit.' });
  }

  // A rival buying up your shares — the telegraph before a takeover bid.
  for (const c of next.carriers) {
    if (c.isPlayer || c.bankruptTurn !== null) continue;
    const nowStake = me.shares > 0 ? (c.holdings[me.id] ?? 0) / me.shares : 0;
    const before = prev.carriers.find((p) => p.id === c.id);
    const wasStake = before && mePrev.shares > 0 ? (before.holdings[me.id] ?? 0) / mePrev.shares : 0;
    if (nowStake > wasStake + 0.005 && nowStake >= 0.1) {
      /*
       * The warning has to know how close it is to the end.
       *
       * One sentence covered every stake from a tenth to a majority, so a rival
       * on 53% was told a controlling stake "would" let it take the player over —
       * in the past tense of a thing that had already happened. That reading is
       * now unreachable, because crossing the line ends the game in the same
       * quarter, but the band just below it is where the warning has to do its
       * work and "would" was far too relaxed for 45%.
       */
      const control = FIN.controlThreshold;
      const short = Math.max(0, control - nowStake);
      const closing = nowStake >= control - 0.1;
      alerts.push({
        tone: nowStake >= 0.4 ? 'danger' : 'warn',
        text: closing
          ? `${c.name} holds ${stake(nowStake)} of you and is ${stake(short)} from a majority — ` +
            `at which point it owns your airline and the game ends. Buy the block back, ` +
            `issue equity to dilute it, or lift your price beyond what it can afford.`
          : `${c.name} raised its stake in you to ${stake(nowStake)} — a rival is accumulating ` +
            `your shares. A controlling stake would let it take you over; buy them back or ` +
            `lift your price out of reach.`,
      });
    }
  }

  /*
   * A big holder of YOUR stock losing it — and the shares landing back on the
   * open market where anyone can pick them up.
   *
   * The accumulation above is telegraphed quarter by quarter, and then the
   * unwinding was silent: a rival could hold a majority of the player, collapse,
   * have its entire position liquidated back into the float, and the briefing
   * would say only "X went bankrupt" — with nothing about the fact that the
   * ownership of the player's own company had just changed hands. That is the
   * single largest thing that can happen to a share register.
   */
  for (const before of prev.carriers) {
    if (before.isPlayer) continue;
    const wasStake = mePrev.shares > 0 ? (before.holdings[me.id] ?? 0) / mePrev.shares : 0;
    if (wasStake < 0.1) continue;
    const now = next.carriers.find((c) => c.id === before.id);
    const nowStake = now && me.shares > 0 ? (now.holdings[me.id] ?? 0) / me.shares : 0;
    if (nowStake >= wasStake - 0.005) continue;
    const was = stake(wasStake);
    const gone = now && now.bankruptTurn !== null && before.bankruptTurn === null;
    if (gone) {
      const fate = now.acquiredBy ? 'was taken over' : 'collapsed';
      alerts.push({
        tone: 'warn',
        text: `${before.name} ${fate}, and the ${was} of you it held has gone back on the open market. ` +
          `Nobody owns that block now — buy it back before somebody else does.`,
      });
    } else {
      markets.push(
        `${before.name} cut its stake in you from ${was} to ${stake(nowStake)}.`,
      );
    }
  }

  // Worst-performing sector, if it is bleeding materially.
  const index = buildMarketIndex(next);
  let worst: { from: string; to: string; net: number } | null = null;
  for (const route of next.routes) {
    if (route.carrierId !== me.id) continue;
    const assigned = assignedTo(me, route.id);
    if (assigned.length === 0) continue;
    const econ = computeRouteEconomics(
      route, assigned, next.turn, conditionsFor(next, me, route, klassesOf(assigned)),
      rivalsOf(index, route), rivalCapacityOf(index, route),
      feedFactor(next.routes, me.id, route.from, route.to, route.id),
      stationOverheadFor(next.routes, me.id, route.from, route.to, true),
    );
    if (!worst || econ.netCash < worst.net) worst = { from: route.from, to: route.to, net: econ.netCash };
  }
  if (worst && worst.net < -HEMORRHAGE) {
    alerts.push({ tone: 'warn', text: `${worst.from}–${worst.to} lost ${usd(-worst.net)} this quarter — reprice it, re-fleet it, or close it.` });
  }

  // --- Your quarter ---
  if (last) {
    const costs: Array<[string, number]> = [
      ['fuel', last.fuel], ['crew', last.crew], ['maintenance', last.maintenance],
      ['handling', last.handling], ['leases', last.lease], ['overhead', last.overhead],
      ['interest', last.interest],
    ];
    const biggest = costs.reduce((a, b) => (b[1] > a[1] ? b : a));
    quarter.push(`Revenue ${usd(last.revenue)}. Largest cost: ${biggest[0]} at ${usd(biggest[1])}.`);
    if (prevLast) {
      const delta = last.netIncome - prevLast.netIncome;
      if (Math.abs(delta) >= 100_000) {
        quarter.push(`${delta >= 0 ? 'Up' : 'Down'} ${usd(Math.abs(delta))} on the previous quarter.`);
      }
    }
  }

  // --- The board: rivals ---
  const prevIds = new Set(prev.carriers.map((c) => c.id));
  for (const c of next.carriers) {
    if (!c.isPlayer && !prevIds.has(c.id)) board.push(`${c.name} entered the market.`);
  }
  for (const c of next.carriers) {
    if (c.isPlayer) continue;
    const before = prev.carriers.find((p) => p.id === c.id);
    if (before && before.bankruptTurn === null && c.bankruptTurn !== null) {
      if (c.acquiredBy) {
        const buyer = next.carriers.find((x) => x.id === c.acquiredBy);
        board.push(`${c.name} was taken over by ${buyer?.name ?? 'a rival'}.`);
      } else {
        board.push(`${c.name} went bankrupt.`);
      }
    }
  }
  // A stake of yours that crossed into control this quarter.
  for (const c of next.carriers) {
    if (c.isPlayer || c.bankruptTurn !== null) continue;
    const before = prev.carriers.find((p) => p.id === c.id);
    if (controls(me, c) && !(before && controls(mePrev, before))) {
      board.push(`You took control of ${c.name} — you can now set its dividend and buy out the rest.`);
    }
  }
  const myMarkets = new Set(next.routes.filter((r) => r.carrierId === me.id).map((r) => marketKey(r.from, r.to)));
  const prevRouteIds = new Set(prev.routes.map((r) => r.id));
  for (const r of next.routes) {
    if (r.carrierId === me.id || prevRouteIds.has(r.id)) continue;
    if (!myMarkets.has(marketKey(r.from, r.to))) continue;
    const owner = next.carriers.find((c) => c.id === r.carrierId);
    board.push(`${owner?.name ?? 'A rival'} opened ${r.from}–${r.to}, a market you serve.`);
  }

  // --- The world: events and fuel ---
  const prevEv = new Set(prev.events.filter((e) => e.kind === 'event').map((e) => e.source));
  const nextEv = new Set(next.events.filter((e) => e.kind === 'event').map((e) => e.source));
  for (const effect of next.events) {
    if (effect.kind !== 'event' || prevEv.has(effect.source)) continue;
    let card: ReturnType<typeof getEvent> | null = null;
    try { card = getEvent(effect.source); } catch { card = null; }
    const detail = [card?.blurb, consequence(effect.effects, effect.until, next.turn)]
      .filter(Boolean).join(' ');
    const line = detail ? `${eventName(effect.source)}. ${detail}` : `${eventName(effect.source)} has begun.`;
    /*
     * A crisis goes to the ALERTS box, not into the third section of the page.
     *
     * The deck marks four of its cards as a crisis — pandemic, recession,
     * September 11, COVID — and those are the quarters that decide games. Printed
     * as a bullet under "The world" they sat below routine revenue and rival
     * chatter, five or more lines down the briefing on 28% of the quarters they
     * fired. Warn rather than danger: the danger tone sounds an alarm, and that
     * is reserved for a game actually ending. A crisis is loud enough in the box.
     *
     * Always `warn`: every card the deck marks as a crisis is a bad one, which is
     * more or less what the flag means. If a good crisis is ever written, this
     * needs an `info` tone rather than a cheerful warning.
     */
    if (card?.crisis) alerts.push({ tone: 'warn', text: line });
    else world.push(line);
  }
  for (const s of prevEv) if (!nextEv.has(s)) world.push(`${eventName(s)} has ended.`);
  const fuelNow = marketFuelPrice(next);
  const fuelWas = marketFuelPrice(prev);
  if (fuelWas > 0) {
    const df = (fuelNow - fuelWas) / fuelWas;
    if (Math.abs(df) >= 0.03) world.push(`Fuel ${df > 0 ? 'rose' : 'fell'} ${Math.round(Math.abs(df) * 100)}% to ${rate(fuelNow)}/L.`);
  }

  // --- Markets ---
  const spNow = sharePrice(next, me);
  const spWas = sharePrice(prev, mePrev);
  if (spWas > 0 && Math.abs(spNow - spWas) / spWas >= 0.03) {
    const d = (spNow - spWas) / spWas;
    markets.push(`Share price ${d > 0 ? 'rose' : 'fell'} ${Math.round(Math.abs(d) * 100)}% to ${rate(spNow)}.`);
  } else if (spWas <= 0 && spNow > 0) {
    markets.push(`Share price recovered to ${rate(spNow)}.`);
  }
  // Share-count moves: a near-doubling is a stock split (value-neutral); a smaller
  // bump is an equity issue — which, for a rival, is a board diluting a raider, the
  // evasive action worth seeing (especially when the raider being diluted is you).
  for (const c of next.carriers) {
    const before = prev.carriers.find((p) => p.id === c.id);
    if (!before || before.shares <= 0) continue;
    const ratio = c.shares / before.shares;
    if (ratio >= 1.9 && (c.isPlayer || (me.holdings[c.id] ?? 0) > 0)) {
      markets.push(`${c.isPlayer ? 'Your' : `${c.name}'s`} stock split ${Math.round(ratio)}-for-1.`);
    } else if (!c.isPlayer && ratio > 1.02 && ratio < 1.9) {
      const yourStake = me.shares > 0 ? (me.holdings[c.id] ?? 0) / c.shares : 0;
      markets.push(
        yourStake >= FIN.takeoverDefenseThreshold
          ? `${c.name} issued new stock to fend off your raid, diluting your stake to ${stake(yourStake)}.`
          : `${c.name} issued new stock — evasive action against a takeover.`,
      );
    }
  }
  const solvent = next.carriers.filter((c) => c.bankruptTurn === null);
  const ranked = solvent
    .map((c) => ({ id: c.id, value: marketCap(next, c) }))
    .sort((a, b) => b.value - a.value);
  const rank = ranked.findIndex((x) => x.id === me.id) + 1;
  if (rank > 0 && solvent.length > 1) {
    markets.push(`You rank ${ordinal(rank)} of ${solvent.length} carriers by market cap.`);
  }

  const net = last?.netIncome ?? 0;
  const headlineLabel = last ? 'Quarterly net' : 'No quarter flown yet';
  const headlineValue = last ? usd(net) : '';
  return {
    quarterLabel,
    alerts,
    headline: headlineValue ? `${headlineLabel} ${headlineValue}` : headlineLabel,
    headlineLabel,
    headlineValue,
    headlineNegative: net < 0,
    quarter,
    board: cap(board),
    world: cap(world),
    markets,
  };
}

/** Render a briefing into the modal body. */
export function renderBriefing(body: HTMLElement, b: Briefing): void {
  body.replaceChildren();

  if (b.alerts.length > 0) {
    const box = document.createElement('div');
    box.className = 'brief-alerts';
    for (const a of b.alerts) {
      const p = document.createElement('p');
      p.className = `brief-alert brief-alert--${a.tone}`;
      p.textContent = a.text;
      box.append(p);
    }
    body.append(box);
  }

  const headline = document.createElement('p');
  headline.className = 'brief-headline';
  headline.classList.toggle('is-negative', b.headlineNegative);
  const label = document.createElement('span');
  label.className = 'brief-headline-label';
  label.textContent = b.headlineValue ? `${b.headlineLabel} ` : b.headlineLabel;
  headline.append(label);
  if (b.headlineValue) headline.append(splitFlap(b.headlineValue));
  body.append(headline);

  const section = (title: string, lines: readonly string[]): void => {
    if (lines.length === 0) return;
    const sec = document.createElement('section');
    sec.className = 'brief-section';
    const h = document.createElement('h3');
    h.className = 'brief-section-title';
    h.textContent = title;
    sec.append(h);
    const ul = document.createElement('ul');
    ul.className = 'brief-list';
    for (const line of lines) {
      const li = document.createElement('li');
      li.textContent = line;
      ul.append(li);
    }
    sec.append(ul);
    body.append(sec);
  };

  section('This quarter', b.quarter);
  section('The competition', b.board);
  section('The world', b.world);
  section('Markets', b.markets);
}
