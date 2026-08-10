/**
 * The financial layer (Phase 4): what a carrier is worth, what it can borrow,
 * and how one carrier takes over another.
 *
 * Modeled on Railroad Tycoon: a company's stock is priced off its book value and
 * trailing earnings, debt is a bond priced by credit rating (cheap when strong,
 * a trap when weak), and control comes from owning a majority of the shares —
 * after which the rest can be bought out at a premium.
 *
 * Everything here is a pure function of GameState. Valuations are deliberately
 * NON-recursive: a stake in another carrier is valued at that carrier's
 * standalone (operating) worth, never at its worth-including-its-own-stakes, so
 * a ring of cross-holdings can never spin the numbers to infinity.
 */
import type { Carrier, CarrierId, GameState, QuarterResult } from './types.ts';
import { CONSTANTS } from './world.ts';

const FIN = CONSTANTS.finance;
const PER_YEAR = CONSTANTS.game.quartersPerYear;

/*
 * Memoised on the FLEET ARRAY's identity, for the same reason and with the same
 * caveat as the network tally in `economics.ts`.
 *
 * This is a small sum, but it sits under `bookValue` -> `sharePrice`, which every
 * carrier evaluates for every other carrier when it considers buying shares — so it
 * runs O(carriers^2) times a turn over fleets that are no longer small. It profiled
 * as the second-largest single cost in the sim once the route scans were dealt with.
 *
 * A fleet array is replaced wholesale whenever anything about it changes, including
 * the quarterly depreciation of `bookValue`, so a stale entry cannot survive a
 * change to the metal it describes. A WeakMap means retired carriers cost nothing.
 * If aircraft ever start being mutated in place, this is the first thing to suspect.
 */
const fleetValueCache = new WeakMap<readonly Carrier['fleet'][number][], number>();

/** Book value of the metal a carrier owns outright. */
export function fleetBookValue(carrier: Carrier): number {
  const cached = fleetValueCache.get(carrier.fleet);
  if (cached !== undefined) return cached;
  const total = carrier.fleet.reduce((sum, a) => sum + (a.ownership === 'owned' ? a.bookValue : 0), 0);
  fleetValueCache.set(carrier.fleet, total);
  return total;
}

/** Cash plus owned metal, before debt. The asset base a lender looks at. */
export function grossAssets(state: GameState, carrier: Carrier): number {
  return carrier.cash + fleetBookValue(carrier) + holdingsValue(state, carrier);
}

/** Assets net of debt — the accounting book value of the equity. */
export function bookValue(state: GameState, carrier: Carrier): number {
  return grossAssets(state, carrier) - carrier.debt;
}

/**
 * The most recent `count` quarters for one carrier, oldest first — the same rows
 * and the same order as filtering the whole history and taking `slice(-count)`.
 *
 * History is append-ordered and only ever the last handful of rows matter, so
 * this walks back from the end and stops. Filtering the whole array instead means
 * scanning thousands of rows to find four by the end of a long game, and the three
 * callers below measured 62% of a headless game's runtime on the CPU profile.
 *
 * The order matters as much as the rows: floating-point addition is not
 * associative, so summing newest-first would shift results in the last bits and
 * break the byte-identical reproducibility the save tests assert.
 */
function recentQuarters(
  state: GameState,
  carrierId: CarrierId,
  count: number,
): readonly QuarterResult[] {
  const history = state.history;
  const key = `${carrierId}|${count}`;
  let memo = recentCache.get(history);
  if (memo) {
    const hit = memo.get(key);
    if (hit) return hit;
  } else {
    memo = new Map();
    recentCache.set(history, memo);
  }
  const out: QuarterResult[] = [];
  for (let i = history.length - 1; i >= 0 && out.length < count; i--) {
    const row = history[i]!;
    if (row.carrierId === carrierId) out.push(row);
  }
  out.reverse();
  memo.set(key, out);
  return out;
}

/**
 * Memo for the walk above, keyed on the history array itself.
 *
 * A carrier that has stopped trading — bankrupt, or acquired — never gets another
 * row, so the walk never fills its quota and reads the entire array every time.
 * Measured over a 200-turn game those calls are only 2.9% of the total but a third
 * of every row scanned, and the share grows with the length of the game.
 *
 * Keying on the array is sound because the engine REPLACES history rather than
 * pushing to it (`next.history = [...next.history, ...settled]`), so a new quarter
 * is a new array and cannot be read through a stale entry. States that share a
 * history array share the answer legitimately: the result depends on nothing else.
 * A WeakMap, so a finished game's cache leaves with it. Returned readonly — the
 * array is shared, and a caller that sorted it would corrupt every later reader.
 */
const recentCache = new WeakMap<readonly QuarterResult[], Map<string, QuarterResult[]>>();

/** Sum of the last four quarters of net income for a carrier. */
export function trailingEarnings(state: GameState, carrierId: CarrierId): number {
  let sum = 0;
  for (const q of recentQuarters(state, carrierId, PER_YEAR)) sum += q.netIncome;
  return sum;
}

/**
 * Trailing-year earnings from OPERATIONS — net income less the dividends the
 * carrier collected on stakes it holds.
 *
 * Only this belongs under the earnings multiple. A dividend is the return on an
 * asset that `holdingsValue` already carries at market, so capitalising it at the
 * operating multiple as well would value the same stake twice: a carrier earning
 * $40M a year from operations was worth $560M, while one earning the identical
 * $40M as dividends was worth $920M. `trailingEarnings` (the total) stays the
 * right measure everywhere else — solvency, credit rating, whether a carrier is
 * profitable at all — because those are about the cash that actually arrives.
 */
export function operatingEarnings(state: GameState, carrierId: CarrierId): number {
  let sum = 0;
  for (const q of recentQuarters(state, carrierId, PER_YEAR)) sum += q.netIncome - (q.dividendIncome ?? 0);
  return sum;
}

/**
 * How fast operating earnings are growing, as a multiple in [floor, cap]. Compares
 * the trailing year with the year before it; a carrier compounding is worth more
 * than its current earnings imply, a shrinking one less. Reads the operating line
 * for the same reason the multiple does — see `operatingEarnings`.
 */
export function growthFactor(state: GameState, carrierId: CarrierId): number {
  const recent = recentQuarters(state, carrierId, PER_YEAR * 2);
  if (recent.length < PER_YEAR * 2) return 1;
  const operating = (q: QuarterResult): number => q.netIncome - (q.dividendIncome ?? 0);
  // recent is oldest first, so the older year leads and the trailing year follows.
  let lastYear = 0;
  for (let i = 0; i < PER_YEAR; i++) lastYear += operating(recent[i]!);
  let thisYear = 0;
  for (let i = PER_YEAR; i < PER_YEAR * 2; i++) thisYear += operating(recent[i]!);
  if (lastYear <= 0) return thisYear > 0 ? FIN.growthCap : 1;
  const ratio = thisYear / lastYear;
  return Math.max(FIN.growthFloor, Math.min(FIN.growthCap, ratio));
}

/**
 * A carrier's standalone equity value: book value plus a multiple of what it
 * earns, scaled by growth. This is the operating worth — it excludes any stakes
 * the carrier holds in others, which is what keeps valuation non-recursive.
 */
export function standaloneEquity(state: GameState, carrier: Carrier): number {
  const book = carrier.cash + fleetBookValue(carrier) - carrier.debt;
  const earnings = operatingEarnings(state, carrier.id);
  // A dividend lifts the price — but only on a carrier that actually earns enough
  // to pay it, so a loss-maker cannot fake a high price with an empty promise.
  const dividendLift = earnings > 0 ? 1 + carrier.dividend * FIN.dividendPricePremium : 1;
  const franchise = FIN.peMultiple * Math.max(0, earnings) * growthFactor(state, carrier.id) * dividendLift;
  return Math.max(0, book) + franchise;
}

/** Value of the stakes a carrier holds in others, at each target's standalone worth. */
export function holdingsValue(state: GameState, carrier: Carrier): number {
  let total = 0;
  for (const [id, sharesHeld] of Object.entries(carrier.holdings)) {
    const target = state.carriers.find((c) => c.id === id);
    if (!target || target.bankruptTurn !== null || target.shares <= 0) continue;
    total += (sharesHeld / target.shares) * standaloneEquity(state, target);
  }
  return total;
}

/** Total equity value of a carrier: its operating worth plus the stakes it holds,
 *  each marked to the target's standalone worth. */
export function equity(state: GameState, carrier: Carrier): number {
  return standaloneEquity(state, carrier) + holdingsValue(state, carrier);
}

/**
 * What the whole company is worth on the market — its operating worth PLUS the
 * value of the stakes it holds in other carriers, marked to market. So buying a
 * stake is value-neutral (cash becomes an equal slice of another carrier), and a
 * holding rising or falling flows straight into the owner's market cap without
 * waiting for a sale. Non-recursive: a stake is valued at the target's STANDALONE
 * worth (holdingsValue), never at its worth-including-its-own-stakes, so a ring of
 * cross-holdings can never spin the numbers to infinity.
 */
export function marketCap(state: GameState, carrier: Carrier): number {
  return equity(state, carrier);
}

/** Price of a single share. */
export function sharePrice(state: GameState, carrier: Carrier): number {
  return carrier.shares > 0 ? marketCap(state, carrier) / carrier.shares : 0;
}

/** Debt as a fraction of gross assets. */
export function leverage(state: GameState, carrier: Carrier): number {
  const assets = grossAssets(state, carrier);
  return assets > 0 ? carrier.debt / assets : carrier.debt > 0 ? Infinity : 0;
}

export type CreditRating = 'AAA' | 'AA' | 'A' | 'BBB' | 'BB' | 'B' | 'CCC';
const RATINGS: readonly CreditRating[] = ['AAA', 'AA', 'A', 'BBB', 'BB', 'B', 'CCC'];

/**
 * The best rating band a carrier's leverage fits within, knocked down a notch if
 * it is losing money — a lender cares about both the debt load and whether the
 * business can service it.
 */
export function creditRating(state: GameState, carrier: Carrier): CreditRating {
  const lev = leverage(state, carrier);
  let band = RATINGS.length - 1;
  for (let i = 0; i < RATINGS.length; i++) {
    if (lev <= FIN.leverageForRating[RATINGS[i]!]) {
      band = i;
      break;
    }
  }
  if (trailingEarnings(state, carrier.id) < 0) band = Math.min(RATINGS.length - 1, band + 1);
  return RATINGS[band]!;
}

/** Quarterly interest rate this carrier would pay on debt. */
export function interestRate(state: GameState, carrier: Carrier): number {
  return FIN.interestByRating[creditRating(state, carrier)];
}

/** How much more a carrier could borrow before hitting the hard leverage ceiling. */
export function borrowingCapacity(state: GameState, carrier: Carrier): number {
  const assets = grossAssets(state, carrier);
  return Math.max(0, FIN.maxLeverage * assets - carrier.debt);
}

/** Does `holder` control `target` (owns more than half the shares)? */
/**
 * The most `buyer` may spend on `target` this quarter, in cash.
 *
 * Three ceilings bind at once and the smallest wins: what is left of the buyer's
 * per-quarter allowance, what is still on the open market, and what the buyer can
 * pay for. `BUY_SHARES` applies exactly these and silently truncates anything
 * larger — it delivers fewer shares rather than erroring — so a dialog that quotes
 * its own maximum must agree with this or it promises a stake the engine will not
 * hand over.
 *
 * It lives here, rather than being worked out in the treasury panel, because that
 * is where it used to live: the panel offered the FULL quarterly cap even after a
 * purchase had already used part of it, and the shortfall was invisible. A rule the
 * engine enforces belongs beside the engine, with one implementation to test.
 */
export function stakePurchaseCeiling(state: GameState, buyer: Carrier, target: Carrier): number {
  if (target.shares <= 0 || target.bankruptTurn !== null) return 0;
  const price = sharePrice(state, target);
  if (price <= 0) return 0;

  const boughtThisQuarter = buyer.stakeBought[target.id] ?? 0;
  const allowance = Math.max(
    0,
    target.shares * CONSTANTS.finance.stakePurchaseCapPerQuarter - boughtThisQuarter,
  );

  let heldByAll = 0;
  for (const c of state.carriers) heldByAll += c.holdings[target.id] ?? 0;
  const float = Math.max(0, target.shares - heldByAll);

  return Math.min(allowance * price, float * price, buyer.cash);
}

/**
 * Where a new issue clears, as a fraction of the market price.
 *
 * The discount widens with the SIZE of the raise, because somebody has to buy every
 * share and a large block only clears if it is priced to move. A flat discount —
 * which this was — meant a 1% top-up and a raise of a quarter of the whole company
 * cleared at the same price, so a company-rescuing issue moved the share price by
 * 1.5% and issuing equity was close to free. Rights issues at that scale price far
 * below market in life, and that is precisely why a board hesitates before one.
 *
 * Floored, so an enormous raise against a small market cap cannot price at nothing
 * and mint unbounded shares.
 */
export function equityIssueDiscount(amount: number, cap: number): number {
  const fin = CONSTANTS.finance;
  if (cap <= 0) return fin.equityRaiseFloorPrice;
  const depth = Math.max(0, amount) / cap;
  return Math.max(
    fin.equityRaiseFloorPrice,
    fin.equityRaiseDiscount - fin.equityRaiseDepthPenalty * depth,
  );
}

/**
 * The most `carrier` may raise in a new equity issue right now.
 *
 * Bound by both the per-quarter cap and the authorized-share headroom, exactly as
 * `ISSUE_EQUITY` binds it. Same reasoning as `stakePurchaseCeiling`: the treasury
 * panel needs this figure to quote a maximum, and a second copy of the rule in the
 * UI is a drift waiting to happen.
 */
export function equityRaiseCeiling(state: GameState, carrier: Carrier): number {
  const fin = CONSTANTS.finance;
  const price = sharePrice(state, carrier);
  if (price <= 0) return 0;
  const issued = carrier.issuedShares ?? 0;
  const headroomShares =
    (fin.authorizedIssuanceFraction * carrier.shares - issued) / (1 - fin.authorizedIssuanceFraction);
  if (headroomShares <= 0) return 0;
  /*
   * The authorized-share ceiling is now implicit: how much cash those shares raise
   * depends on the discount, and the discount depends on how much is raised. Solved
   * by a few fixed-point passes rather than algebra — it converges immediately
   * because the discount moves far slower than the amount, and it stays exact,
   * which matters: the treasury panel quotes this figure as its maximum and
   * `ISSUE_EQUITY` refuses anything above it.
   */
  const cap = marketCap(state, carrier);
  let byAuthorized = headroomShares * price * fin.equityRaiseDiscount;
  for (let pass = 0; pass < 12; pass += 1) {
    byAuthorized = headroomShares * price * equityIssueDiscount(byAuthorized, cap);
  }
  return Math.min(cap * fin.maxEquityRaiseFraction, byAuthorized);
}

export function controls(holder: Carrier, target: Carrier): boolean {
  return target.shares > 0 && (holder.holdings[target.id] ?? 0) / target.shares > FIN.controlThreshold;
}

/**
 * Every carrier `holder` controls, directly or through a chain of them.
 *
 * Control is transitive because that is what a holding company IS: if you hold a
 * majority of A and A holds a majority of B, B does what you say — you command
 * B's whole treasury while bearing only your share of A's share of its losses.
 * That leverage without debt is the entire point of the structure, and it is how
 * the industry actually consolidated (IAG over Vueling, Lufthansa over SWISS) as
 * well as how it consolidated before 1934, when the pyramids got legislated apart.
 *
 * The visited set is not decoration. Nothing forbids A holding B while B holds A —
 * no rule in the engine prevents it and the AI has no reason not to walk into one —
 * and a naive traversal of that ring never returns. Note this is a DIFFERENT cycle
 * from the one `marketCap` guards against: that one is about valuation spiralling,
 * this one is about the walk itself terminating. Neither protects the other.
 */
export function controlledBy(state: GameState, holder: Carrier): Carrier[] {
  const found: Carrier[] = [];
  const seen = new Set<CarrierId>([holder.id]);
  const queue: Carrier[] = [holder];
  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const other of state.carriers) {
      if (seen.has(other.id) || other.bankruptTurn !== null) continue;
      if (!controls(current, other)) continue;
      seen.add(other.id);
      found.push(other);
      queue.push(other);
    }
  }
  return found;
}

/** Whether `holder` commands `target`, directly or down a chain of subsidiaries. */
export function commands(state: GameState, holder: Carrier, target: Carrier): boolean {
  if (holder.id === target.id) return false;
  return controlledBy(state, holder).some((c) => c.id === target.id);
}

/**
 * The economic slice of `target` that `holder` actually owns, following the chain
 * and multiplying the stakes along it.
 *
 * This is the number that makes a pyramid worth building and worth fearing: 51% of
 * A and A's 51% of B is COMMAND of B on 26% of the exposure. The player sees both
 * figures, because a structure whose whole appeal is the gap between them cannot be
 * legible while showing only one.
 */
export function economicInterest(state: GameState, holder: Carrier, target: Carrier): number {
  if (holder.id === target.id) return 1;
  const best = new Map<CarrierId, number>([[holder.id, 1]]);
  const queue: CarrierId[] = [holder.id];
  while (queue.length > 0) {
    const id = queue.shift()!;
    const via = state.carriers.find((c) => c.id === id);
    if (!via) continue;
    const share = best.get(id) ?? 0;
    for (const [heldId, heldShares] of Object.entries(via.holdings)) {
      const held = state.carriers.find((c) => c.id === heldId);
      if (!held || held.shares <= 0 || held.bankruptTurn !== null) continue;
      const through = share * (heldShares / held.shares);
      // Only walk on when this path improves the answer, which also terminates any
      // ring: a stake is a fraction, so going round one strictly shrinks the number.
      if (through > (best.get(heldId) ?? 0) + 1e-12) {
        best.set(heldId, through);
        queue.push(heldId);
      }
    }
  }
  return best.get(target.id) ?? 0;
}

/**
 * A carrier's share of the industry, by sectors flown.
 *
 * Sectors rather than market cap or traffic, because consolidation is about how
 * much of the map one house holds, and because it is the figure a player can see on
 * the board without opening a panel. Counts carriers it COMMANDS as well as itself —
 * a pyramid is concentration whatever the register says, which is the same rule the
 * merger review uses.
 */
export function industryShare(state: GameState, carrier: Carrier): number {
  const mine = new Set<CarrierId>([carrier.id, ...controlledBy(state, carrier).map((c) => c.id)]);
  let held = 0;
  let all = 0;
  for (const r of state.routes) {
    const live = state.carriers.find((c) => c.id === r.carrierId);
    if (!live || live.bankruptTurn !== null) continue;
    all += 1;
    if (mine.has(r.carrierId)) held += 1;
  }
  return all > 0 ? held / all : 0;
}

/**
 * How much harder the world pushes back on a carrier that is running away with it.
 *
 * Returns 1 for anyone of ordinary size and climbs as a carrier's share of the map
 * passes `dominance.noticedAbove`. It is the answer to a player question — can the
 * AI adapt to what I am doing — and to the observation behind it, that buying the
 * whole field was the cheapest path to victory and nothing in the game noticed.
 *
 * Deliberately keyed on ANY carrier rather than on the player. A runaway roll-up
 * should meet the same resistance, or this is not a rule about concentration, it is
 * a rule about the human, and the field would behave differently depending on who
 * was ahead. Pillar 4 says success attracts sharks; it does not say whose.
 */
export function dominancePressure(state: GameState, carrier: Carrier): number {
  const fin = CONSTANTS.finance;
  const excess = industryShare(state, carrier) - fin.dominanceNoticedAbove;
  if (excess <= 0) return 1;
  return 1 + excess * fin.dominancePressure;
}

/**
 * The cash a carrier needs to acquire a target outright: the whole company at a
 * premium, less the value of the stake it already holds.
 */
export function acquisitionCost(state: GameState, acquirer: Carrier, target: Carrier): number {
  /*
   * The premium rises with how much of the industry the BUYER already holds.
   *
   * Two real forces wearing one number: minority holders of the last independents
   * know what a near-monopolist needs their shares for and price accordingly, and a
   * competition authority extracts remedies from a dominant acquirer that it waves
   * through for a small one. Together they are why the final acquisitions of a
   * roll-up are its dearest, and why buying the whole board should be the hardest
   * way to win rather than — as it was — the cheapest.
   */
  const whole = marketCap(state, target) * FIN.acquisitionPremium * dominancePressure(state, acquirer);
  const alreadyOwned = target.shares > 0 ? (acquirer.holdings[target.id] ?? 0) / target.shares : 0;
  return Math.max(0, whole * (1 - alreadyOwned));
}

/**
 * Compact money for the sim's own action-rejection messages. The UI has its own
 * formatter; this exists so engine.ts can name a figure without importing the UI
 * layer or tripping its no-magic-numbers rule.
 */
export function money(n: number): string {
  const sign = n < 0 ? '−' : '';
  const a = Math.abs(n);
  if (a >= 1e9) return `${sign}$${(a / 1e9).toFixed(2)}B`;
  if (a >= 1e6) return `${sign}$${(a / 1e6).toFixed(1)}M`;
  if (a >= 1e3) return `${sign}$${Math.round(a / 1e3)}K`;
  return `${sign}$${Math.round(a)}`;
}
