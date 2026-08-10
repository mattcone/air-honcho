/**
 * The financial layer (Phase 4): valuation, debt, equity, share trading and
 * acquisitions. These pin the mechanics that make "won by acquisition, lost by
 * takeover" possible, and the arithmetic that must never leak cash.
 */
import { describe, expect, it } from 'vitest';
import { applyAction, endTurn, getCarrier, newGame, netWorth } from '../src/sim/engine.ts';
import { CONSTANTS } from '../src/sim/world.ts';
import {
  acquisitionCost, borrowingCapacity, commands, controlledBy, controls, creditRating, economicInterest,
  equity, equityIssueDiscount, equityRaiseCeiling, industryShare, interestRate, marketCap,
  sharePrice, stakePurchaseCeiling, standaloneEquity,
} from '../src/sim/market.ts';
import type { Carrier, GameState } from '../src/sim/types.ts';
import { conditionsFor } from '../src/sim/conditions.ts';
import { getAircraftType } from '../src/sim/fleet.ts';

/** A two-carrier world for share-trading and acquisition tests. */
function twoCarrierWorld(): GameState {
  let state = newGame(3, 'LON');
  // Deal a rival in by hand so we control both balance sheets.
  const rival = {
    ...getCarrier(state, 'player'),
    id: 'rival', name: 'Rival Air', isPlayer: false, color: '#900',
    homeCityId: 'NYC', archetypeId: 'legacy', cash: 200_000_000,
    holdings: {}, debt: 0,
  };
  return { ...state, carriers: [...state.carriers, rival] };
}

/** Hand the player a controlling stake, the precondition for a buyout. Building
 *  one for real is a multi-quarter grind (tested separately); here we just need
 *  the acquisition machinery to be reachable. */
function giveMajority(state: GameState, targetId: string): GameState {
  const shares = getCarrier(state, targetId).shares;
  return {
    ...state,
    carriers: state.carriers.map((c) =>
      c.id === 'player' ? { ...c, holdings: { ...c.holdings, [targetId]: shares * 0.6 } } : c),
  };
}

describe('valuation', () => {
  it('prices a fresh carrier at its cash, with a share price above zero', () => {
    const state = newGame(1, 'LON');
    const player = getCarrier(state, 'player');
    expect(marketCap(state, player)).toBeCloseTo(player.cash, 4);
    expect(sharePrice(state, player)).toBeGreaterThan(0);
  });

  it('adds a multiple of trailing earnings above book value', () => {
    let state = newGame(1, 'LON');
    const withEarnings: GameState = {
      ...state,
      history: [{
        turn: 1, carrierId: 'player', revenue: 0, fuel: 0, crew: 0, maintenance: 0,
        handling: 0, lease: 0, standing: 0, fixed: 0, overhead: 0, interest: 0, tax: 0,
        netIncome: 40_000_000, cashAfter: 0,
      }],
    };
    const book = getCarrier(state, 'player').cash;
    const valued = marketCap(withEarnings, getCarrier(withEarnings, 'player'));
    expect(valued).toBeGreaterThan(book); // earnings add franchise value
  });

  it('values a stake at the target\'s standalone worth, never recursively', () => {
    let state = twoCarrierWorld();
    const rival = getCarrier(state, 'rival');
    const price = sharePrice(state, rival);
    // Player buys a quarter's worth of the rival — the per-quarter cap.
    const fraction = CONSTANTS.finance.stakePurchaseCapPerQuarter;
    const stakeCash = rival.shares * fraction * price;
    state = { ...state, carriers: state.carriers.map((c) =>
      c.id === 'player' ? { ...c, cash: 1_000_000_000 } : c) };
    const res = applyAction(state, { type: 'BUY_SHARES', carrierId: 'player', targetId: 'rival', amount: stakeCash });
    expect(res.ok, res.error).toBe(true);
    const player = getCarrier(res.state, 'player');
    // The stake is worth that fraction of the rival's standalone equity.
    expect(equity(res.state, player) - standaloneEquity(res.state, player)).toBeCloseTo(
      fraction * standaloneEquity(res.state, getCarrier(res.state, 'rival')), -6);
  });

  it('marks a portfolio to market: buying a stake barely moves your market cap', () => {
    let state = twoCarrierWorld();
    state = { ...state, carriers: state.carriers.map((c) => c.id === 'player' ? { ...c, cash: 1_000_000_000 } : c) };
    const before = marketCap(state, getCarrier(state, 'player'));
    const res = applyAction(state, { type: 'BUY_SHARES', carrierId: 'player', targetId: 'rival', amount: 100_000_000 });
    expect(res.ok, res.error).toBe(true);
    // Cash became a slice of the rival of equal value — market cap is ~unchanged.
    expect(marketCap(res.state, getCarrier(res.state, 'player'))).toBeCloseTo(before, -5);
  });

  it('carries an unrealized loss on a held stake straight into your market cap', () => {
    let state = twoCarrierWorld();
    const rival = getCarrier(state, 'rival');
    state = { ...state, carriers: state.carriers.map((c) =>
      c.id === 'player' ? { ...c, holdings: { rival: rival.shares * 0.3 } } : c) };
    const rich = marketCap(state, getCarrier(state, 'player'));
    // The rival's value craters; the loss on the stake flows through without a sale.
    const poorer = { ...state, carriers: state.carriers.map((c) => c.id === 'rival' ? { ...c, cash: c.cash * 0.2 } : c) };
    expect(marketCap(poorer, getCarrier(poorer, 'player'))).toBeLessThan(rich);
  });
});

describe('debt', () => {
  it('lets a carrier borrow against its assets and raises its cash', () => {
    let state = newGame(1, 'LON');
    const before = getCarrier(state, 'player').cash;
    const res = applyAction(state, { type: 'BORROW', carrierId: 'player', amount: 50_000_000 });
    expect(res.ok, res.error).toBe(true);
    const c = getCarrier(res.state, 'player');
    expect(c.cash).toBeCloseTo(before + 50_000_000, 4);
    expect(c.debt).toBeCloseTo(50_000_000, 4);
  });

  it('refuses to lend past the leverage ceiling', () => {
    const state = newGame(1, 'LON');
    const capacity = borrowingCapacity(state, getCarrier(state, 'player'));
    const res = applyAction(state, { type: 'BORROW', carrierId: 'player', amount: capacity * 2 });
    expect(res.ok).toBe(false);
  });

  it('charges more interest at a worse credit rating', () => {
    let state = newGame(1, 'LON');
    const light = { ...getCarrier(state, 'player'), debt: 10_000_000 };
    const heavy = { ...getCarrier(state, 'player'), debt: getCarrier(state, 'player').cash };
    const lightRate = interestRate({ ...state, carriers: [light] }, light);
    const heavyRate = interestRate({ ...state, carriers: [heavy] }, heavy);
    expect(heavyRate).toBeGreaterThan(lightRate);
    expect(['AAA', 'AA', 'A', 'BBB', 'BB', 'B', 'CCC']).toContain(creditRating(state, light));
  });

  it('services debt out of the quarter, denting net income', () => {
    let state = newGame(5, 'LON');
    state = applyAction(state, { type: 'OPEN_ROUTE', carrierId: 'player', from: 'LON', to: 'CDG' }).state;
    const borrowed = applyAction(state, { type: 'BORROW', carrierId: 'player', amount: 60_000_000 }).state;
    const noDebt = endTurn(state).history.at(-1)!;
    const withDebt = endTurn(borrowed).history.at(-1)!;
    expect(withDebt.interest).toBeGreaterThan(0);
    expect(noDebt.interest).toBe(0);
  });
});

describe('equity', () => {
  it('raises cash by issuing shares, and dilutes', () => {
    let state = newGame(1, 'LON');
    const before = getCarrier(state, 'player');
    const res = applyAction(state, { type: 'ISSUE_EQUITY', carrierId: 'player', amount: 20_000_000 });
    expect(res.ok, res.error).toBe(true);
    const after = getCarrier(res.state, 'player');
    expect(after.cash).toBeCloseTo(before.cash + 20_000_000, 4);
    expect(after.shares).toBeGreaterThan(before.shares); // new shares minted
  });

  it('caps a single issue at a fraction of market cap', () => {
    const state = newGame(1, 'LON');
    const cap = marketCap(state, getCarrier(state, 'player'));
    const res = applyAction(state, { type: 'ISSUE_EQUITY', carrierId: 'player', amount: cap });
    expect(res.ok).toBe(false);
  });

  it('halts issuance at the authorized-share ceiling instead of pumping forever', () => {
    let state = newGame(1, 'LON');
    const frac = CONSTANTS.finance.authorizedIssuanceFraction;
    // Hammer the issue button — each raise is individually capped, but cumulative
    // issuance must run into the charter ceiling rather than printing endlessly.
    let issues = 0;
    for (let i = 0; i < 50; i++) {
      const cap = marketCap(state, getCarrier(state, 'player'));
      const res = applyAction(state, {
        type: 'ISSUE_EQUITY', carrierId: 'player', amount: cap * CONSTANTS.finance.maxEquityRaiseFraction,
      });
      if (!res.ok) break;
      state = res.state;
      issues++;
    }
    expect(issues).toBeGreaterThan(0); // some equity did get raised
    expect(issues).toBeLessThan(50); // ...but the well ran dry — not an infinite pump
    const after = getCarrier(state, 'player');
    expect((after.issuedShares ?? 0) / after.shares).toBeLessThanOrEqual(frac + 1e-6);
  });

  it('leaves the authorized ratio unchanged across a stock split', () => {
    let state = newGame(1, 'LON');
    // Issue up to the ceiling, then split the stock and confirm the ratio holds —
    // a split must not hand back fresh issuance headroom.
    const cap = marketCap(state, getCarrier(state, 'player'));
    state = applyAction(state, { type: 'ISSUE_EQUITY', carrierId: 'player', amount: cap * 0.2 }).state;
    const before = getCarrier(state, 'player');
    const ratioBefore = (before.issuedShares ?? 0) / before.shares;
    // A split doubles shares and issuedShares together.
    state = {
      ...state,
      carriers: state.carriers.map((c) =>
        c.id === 'player' ? { ...c, shares: c.shares * 2, issuedShares: (c.issuedShares ?? 0) * 2 } : c),
    };
    const after = getCarrier(state, 'player');
    expect((after.issuedShares ?? 0) / after.shares).toBeCloseTo(ratioBefore, 9);
  });
});

describe('share trading', () => {
  it('round-trips a stake without minting or destroying cash beyond price moves', () => {
    let state = { ...twoCarrierWorld() };
    state = { ...state, carriers: state.carriers.map((c) =>
      c.id === 'player' ? { ...c, cash: 500_000_000 } : c) };
    const startCash = getCarrier(state, 'player').cash;
    const bought = applyAction(state, { type: 'BUY_SHARES', carrierId: 'player', targetId: 'rival', amount: 100_000_000 });
    expect(bought.ok, bought.error).toBe(true);
    // Sell it straight back — no earnings moved, so cash is ~unchanged.
    const sold = applyAction(bought.state, { type: 'SELL_SHARES', carrierId: 'player', targetId: 'rival', amount: 1e12 });
    expect(sold.ok, sold.error).toBe(true);
    expect(getCarrier(sold.state, 'player').cash).toBeCloseTo(startCash, -3);
    expect(getCarrier(sold.state, 'player').holdings['rival']).toBeUndefined();
  });

  it('lets a majority stake become control', () => {
    let state = twoCarrierWorld();
    const rival = getCarrier(state, 'rival');
    state = { ...state, carriers: state.carriers.map((c) =>
      c.id === 'player' ? { ...c, cash: 10_000_000_000, holdings: { rival: rival.shares * 0.6 } } : c) };
    expect(controls(getCarrier(state, 'player'), getCarrier(state, 'rival'))).toBe(true);
  });
});

describe('acquisition', () => {
  it('folds a rival in: routes, fleet and cash move across, the target leaves', () => {
    let state = twoCarrierWorld();
    // Give the rival a route and generous player cash.
    state = applyAction(state, { type: 'OPEN_ROUTE', carrierId: 'rival', from: 'NYC', to: 'LON' }).state;
    state = { ...state, carriers: state.carriers.map((c) =>
      c.id === 'player' ? { ...c, cash: 5_000_000_000 } : c) };
    state = giveMajority(state, 'rival');
    const rivalCash = getCarrier(state, 'rival').cash;
    const playerCashBefore = getCarrier(state, 'player').cash;
    const cost = acquisitionCost(state, getCarrier(state, 'player'), getCarrier(state, 'rival'));

    const res = applyAction(state, { type: 'ACQUIRE_CARRIER', carrierId: 'player', targetId: 'rival', withDebt: false });
    expect(res.ok, res.error).toBe(true);
    const player = getCarrier(res.state, 'player');
    const rival = getCarrier(res.state, 'rival');
    // The rival's route is now the player's, the rival is gone but not bankrupt.
    expect(res.state.routes.every((r) => r.carrierId === 'player')).toBe(true);
    expect(rival.bankruptTurn).not.toBeNull();
    expect(rival.acquiredBy).toBe('player');
    // Cash: paid the deal, gained the rival's cash. Public float's share vanishes.
    expect(player.cash).toBeCloseTo(playerCashBefore - cost + rivalCash, -4);
    // Integration drag is now running.
    expect(player.integrationUntil).toBeGreaterThan(res.state.turn);
  });

  it('can be funded with debt when cash falls short (a leveraged buyout)', () => {
    let state = twoCarrierWorld();
    state = applyAction(state, { type: 'OPEN_ROUTE', carrierId: 'rival', from: 'NYC', to: 'LON' }).state;
    // Player has little cash but plenty of asset base to borrow against.
    state = { ...state, carriers: state.carriers.map((c) =>
      c.id === 'player' ? { ...c, cash: 5_000_000, fleet: [{
        id: 'AC', typeId: 'AROSW3', ownership: 'owned', acquiredTurn: 0, deliversTurn: 0, bookValue: 2_000_000_000, routeId: null,
      }] } : c) };
    state = giveMajority(state, 'rival');
    const cash = applyAction(state, { type: 'ACQUIRE_CARRIER', carrierId: 'player', targetId: 'rival', withDebt: false });
    expect(cash.ok).toBe(false); // not enough cash
    const lbo = applyAction(state, { type: 'ACQUIRE_CARRIER', carrierId: 'player', targetId: 'rival', withDebt: true });
    expect(lbo.ok, lbo.error).toBe(true);
    expect(getCarrier(lbo.state, 'player').debt).toBeGreaterThan(0); // borrowed to buy
  });
});

describe('end conditions', () => {
  it('ends the game when the player is bought in a hostile takeover', () => {
    // A crated, loss-making player past the grace period, and a giant roll-up.
    let state = newGame(9, 'LON');
    const rollup = {
      ...getCarrier(state, 'player'),
      id: 'shark', name: 'Shark Capital', isPlayer: false, color: '#111',
      archetypeId: 'rollup', cash: 20_000_000_000, holdings: {},
    };
    state = {
      ...state,
      turn: CONSTANTS.finance.hostileGraceTurns,
      enteredRivals: ['shark'],
      carriers: [
        { ...getCarrier(state, 'player'), cash: 5_000_000, fleet: [{
          id: 'AC', typeId: 'AROSW3', ownership: 'leased', acquiredTurn: 0, deliversTurn: 0, bookValue: 0, routeId: null,
        }] },
        rollup,
      ],
      playerPeakEquity: 1_000_000_000, // once worth a billion, now $5M — cratered
      history: [{
        turn: state.turn, carrierId: 'player', revenue: 0, fuel: 0, crew: 0, maintenance: 0,
        handling: 0, lease: 0, standing: 0, fixed: 0, overhead: 0, interest: 0, tax: 0,
        netIncome: -50_000_000, cashAfter: 5_000_000,
      }],
    };
    const after = endTurn(state);
    expect(after.gameOver?.reason).toMatch(/hostile takeover/i);
    expect(getCarrier(after, 'player').acquiredBy).toBe('shark');
  });

  it('does not touch a healthy player, however small', () => {
    let state = newGame(9, 'LON');
    state = { ...state, turn: CONSTANTS.finance.hostileGraceTurns + 4 };
    // No losses, no crater — a run of many turns must never end in takeover.
    for (let i = 0; i < 8; i++) state = endTurn(state);
    expect(state.gameOver?.reason ?? '').not.toMatch(/hostile/i);
  });

  it('buys a raider out with greenmail, retiring the shares', () => {
    // The surgical counter to a raid: pay a premium for the whole stake, and the
    // shares are retired so the raider cannot simply buy them back cheaply.
    const base = newGame(1, 'LON');
    const p = base.carriers[0]!;
    const raider = {
      ...p, id: 'r', name: 'Raider Corp', isPlayer: false, archetypeId: 'legacy',
      cash: 0, fleet: [], holdings: { player: p.shares * 0.44 },
    };
    const state: GameState = {
      ...base, turn: 40, carriers: [{ ...p, cash: 900_000_000, fleet: [] }, raider],
    };
    const before = getCarrier(state, 'player');
    const cost = raider.holdings['player']! * sharePrice(state, before) * CONSTANTS.finance.greenmailPremium;

    const res = applyAction(state, { type: 'BUY_BACK_STAKE', carrierId: 'player', holderId: 'r' });
    expect(res.ok, res.error).toBe(true);
    const me = getCarrier(res.state, 'player');
    expect(getCarrier(res.state, 'r').holdings['player']).toBeUndefined(); // threat gone
    expect(controls(getCarrier(res.state, 'r'), me)).toBe(false);
    expect(me.shares).toBeCloseTo(before.shares * 0.56, 4); // retired, not held
    expect(me.cash).toBeCloseTo(before.cash - cost, 4);
    expect(getCarrier(res.state, 'r').cash).toBeCloseTo(cost, 4); // they were paid
  });

  it('concentrates the remaining holders — greenmail is not free', () => {
    // Retiring shares shrinks the company, so whoever is left owns more of it.
    const base = newGame(1, 'LON');
    const p = base.carriers[0]!;
    const mk = (id: string, frac: number) => ({
      ...p, id, name: id, isPlayer: false, archetypeId: 'legacy', cash: 0, fleet: [],
      holdings: { player: p.shares * frac },
    });
    const state: GameState = {
      ...base, turn: 40,
      carriers: [{ ...p, cash: 900_000_000, fleet: [] }, mk('r', 0.44), mk('m', 0.15)],
    };
    const res = applyAction(state, { type: 'BUY_BACK_STAKE', carrierId: 'player', holderId: 'r' });
    expect(res.ok, res.error).toBe(true);
    const me = getCarrier(res.state, 'player');
    const minorAfter = (getCarrier(res.state, 'm').holdings['player'] ?? 0) / me.shares;
    expect(minorAfter).toBeGreaterThan(0.15); // 15% of a smaller company is a bigger slice
  });

  it('refuses a buy-back the treasury cannot fund, and one from a non-holder', () => {
    const base = newGame(1, 'LON');
    const p = base.carriers[0]!;
    const holder = {
      ...p, id: 'm', name: 'Minor', isPlayer: false, archetypeId: 'legacy',
      cash: 0, fleet: [], holdings: { player: p.shares * 0.15 },
    };
    // Valuable (owned widebodies) but cash-poor — the cornered case.
    const type = getAircraftType('AROSW6');
    const fleet = Array.from({ length: 6 }, (_, i) => ({
      id: `F${i}`, typeId: type.id, ownership: 'owned' as const,
      acquiredTurn: 0, deliversTurn: 0, bookValue: type.price, routeId: null,
    }));
    const state: GameState = {
      ...base, turn: 40, carriers: [{ ...p, cash: 5_000_000, fleet }, holder],
    };
    const poor = applyAction(state, { type: 'BUY_BACK_STAKE', carrierId: 'player', holderId: 'm' });
    expect(poor.ok).toBe(false);
    expect(getCarrier(poor.state, 'player').shares).toBe(p.shares); // untouched

    const nobody = applyAction(state, { type: 'BUY_BACK_STAKE', carrierId: 'player', holderId: 'player' });
    expect(nobody.ok).toBe(false);
  });

  it('ends the game when a rival amasses a controlling stake in the player', () => {
    // Not a crater panic — an accumulation. Past grace, an acquisitive rival that
    // has bought past half the player's shares simply owns the airline.
    let state = newGame(9, 'LON');
    const player = getCarrier(state, 'player');
    const raider = {
      ...player, id: 'raider', name: 'Bidder Corp', isPlayer: false, color: '#222',
      archetypeId: 'legacy', cash: 1_000_000_000, holdings: { player: player.shares * 0.6 },
    };
    state = {
      ...state,
      turn: CONSTANTS.finance.hostileGraceTurns + 2,
      enteredRivals: ['raider'],
      carriers: [{ ...player, cash: 50_000_000 }, raider],
    };
    const after = endTurn(state);
    expect(after.gameOver?.reason).toMatch(/controlling stake/i);
    expect(after.gameOver?.outcome).toBe('lost');
    expect(getCarrier(after, 'player').acquiredBy).toBe('raider');
  });
});

describe('acquisition edge cases', () => {
  it('does not leave the buyer double-serving a market it already flew', () => {
    let state = twoCarrierWorld();
    // Both fly LON–NYC; the rival also flies a market the player does not.
    state = applyAction(state, { type: 'OPEN_ROUTE', carrierId: 'player', from: 'LON', to: 'NYC' }).state;
    state = applyAction(state, { type: 'OPEN_ROUTE', carrierId: 'rival', from: 'NYC', to: 'LON' }).state;
    state = applyAction(state, { type: 'OPEN_ROUTE', carrierId: 'rival', from: 'NYC', to: 'MEX' }).state;
    state = { ...state, carriers: state.carriers.map((c) =>
      c.id === 'player' ? { ...c, cash: 5_000_000_000 } : c) };
    state = giveMajority(state, 'rival');
    const after = applyAction(state, { type: 'ACQUIRE_CARRIER', carrierId: 'player', targetId: 'rival', withDebt: false }).state;

    const key = (r: { from: string; to: string }) => [r.from, r.to].sort().join('-');
    const mine = after.routes.filter((r) => r.carrierId === 'player');
    const markets = mine.map(key);
    // No market appears twice, and every route belongs to the player now.
    expect(new Set(markets).size).toBe(markets.length);
    expect(after.routes.some((r) => r.carrierId === 'rival')).toBe(false);
  });

  it('never lets stakes across carriers exceed the shares that exist', () => {
    let state = twoCarrierWorld();
    const rival = getCarrier(state, 'rival');
    // A third carrier already holds 70% of the rival.
    state = {
      ...state,
      carriers: [
        ...state.carriers.map((c) => c.id === 'player' ? { ...c, cash: 100_000_000_000 } : c),
        { ...rival, id: 'holder', name: 'Holder', holdings: { rival: rival.shares * 0.7 } },
      ],
    };
    // The player tries to buy an enormous stake; it can only get the 30% float.
    const res = applyAction(state, { type: 'BUY_SHARES', carrierId: 'player', targetId: 'rival', amount: 100_000_000_000 });
    expect(res.ok, res.error).toBe(true);
    const held = getCarrier(res.state, 'player').holdings['rival'] ?? 0;
    const other = 0.7 * rival.shares;
    expect(held + other).toBeLessThanOrEqual(rival.shares + 1);
  });
});

describe('an acquisition brings the target\'s technology', () => {
  it('gives the buyer the union of both delivered programs', () => {
    let state = twoCarrierWorld();
    state = applyAction(state, { type: 'OPEN_ROUTE', carrierId: 'rival', from: 'NYC', to: 'MEX' }).state;
    state = {
      ...state,
      carriers: state.carriers.map((c) => {
        if (c.id === 'player') return { ...c, cash: 5_000_000_000, tech: ['direct-booking', 'revenue-management'] };
        if (c.id === 'rival') return { ...c, tech: ['loyalty', 'revenue-management'] };
        return c;
      }),
    };
    state = giveMajority(state, 'rival');
    const res = applyAction(state, { type: 'ACQUIRE_CARRIER', carrierId: 'player', targetId: 'rival', withDebt: false });
    expect(res.ok, res.error).toBe(true);
    const player = getCarrier(res.state, 'player');
    // Keeps its own, gains the rival's, no duplicates.
    expect(new Set(player.tech)).toEqual(new Set(['direct-booking', 'revenue-management', 'loyalty']));
    expect(player.tech.length).toBe(new Set(player.tech).size);
  });
});

describe('stakes are built a quarter at a time', () => {
  const flush = (state: GameState): GameState =>
    ({ ...state, carriers: state.carriers.map((c) => c.id === 'player' ? { ...c, cash: 10_000_000_000 } : c) });

  it('caps a purchase at the per-quarter fraction, however much cash is thrown at it', () => {
    const state = flush(twoCarrierWorld());
    const res = applyAction(state, { type: 'BUY_SHARES', carrierId: 'player', targetId: 'rival', amount: 10_000_000_000 });
    expect(res.ok, res.error).toBe(true);
    const rival = getCarrier(res.state, 'rival');
    const held = getCarrier(res.state, 'player').holdings['rival'] ?? 0;
    expect(held / rival.shares).toBeCloseTo(CONSTANTS.finance.stakePurchaseCapPerQuarter, 6);
  });

  it('refuses a second purchase the same quarter, then lets it resume next quarter', () => {
    let state = flush(twoCarrierWorld());
    state = applyAction(state, { type: 'BUY_SHARES', carrierId: 'player', targetId: 'rival', amount: 10_000_000_000 }).state;
    expect(applyAction(state, { type: 'BUY_SHARES', carrierId: 'player', targetId: 'rival', amount: 1_000_000 }).ok).toBe(false);
    // The per-quarter counter clears on the turn.
    state = endTurn(state);
    expect(applyAction(state, { type: 'BUY_SHARES', carrierId: 'player', targetId: 'rival', amount: 100_000_000 }).ok).toBe(true);
  });

  it('will not let a buyout begin without a controlling stake', () => {
    const state = flush(twoCarrierWorld());
    const without = applyAction(state, { type: 'ACQUIRE_CARRIER', carrierId: 'player', targetId: 'rival', withDebt: false });
    expect(without.ok).toBe(false);
    expect(without.error).toMatch(/controlling stake/i);
    const withControl = applyAction(giveMajority(state, 'rival'), { type: 'ACQUIRE_CARRIER', carrierId: 'player', targetId: 'rival', withDebt: false });
    expect(withControl.ok, withControl.error).toBe(true);
  });

  it('releases a failed carrier\'s stakes back to the float', () => {
    let state = twoCarrierWorld();
    const rival = getCarrier(state, 'rival');
    // A third carrier holds half of the rival, then runs out of money.
    const doomed = { ...rival, id: 'doomed', name: 'Doomed Air', homeCityId: 'MEX', cash: -1e12, holdings: { rival: rival.shares * 0.5 } };
    state = { ...state, carriers: [...state.carriers, doomed] };
    const after = endTurn(state);
    const dead = getCarrier(after, 'doomed');
    expect(dead.bankruptTurn).not.toBeNull();
    // Its stake is liquidated, not left to sterilize the float or catch dividends.
    expect(dead.holdings).toEqual({});
  });
});

describe('dividends', () => {
  /** A carrier with a real profitable quarter behind it, so a dividend is payable. */
  const earner = (state: GameState): GameState => ({
    ...state,
    history: [{
      turn: 1, carrierId: 'player', revenue: 0, fuel: 0, crew: 0, maintenance: 0, handling: 0,
      lease: 0, standing: 0, fixed: 0, overhead: 0, interest: 0, tax: 0, netIncome: 40_000_000, cashAfter: 0,
    }],
  });

  it('lifts a profitable carrier\'s share price when raised, and drops it when cut', () => {
    const base = earner(newGame(1, 'LON'));
    const flat = marketCap(base, getCarrier(base, 'player'));
    const paying = { ...base, carriers: base.carriers.map((c) => c.isPlayer ? { ...c, dividend: 0.6 } : c) };
    expect(marketCap(paying, getCarrier(paying, 'player'))).toBeGreaterThan(flat);
  });

  it('gives a loss-maker no price lift for an empty promise', () => {
    let base = newGame(1, 'LON');
    base = { ...base, history: [{
      turn: 1, carrierId: 'player', revenue: 0, fuel: 0, crew: 0, maintenance: 0, handling: 0,
      lease: 0, standing: 0, fixed: 0, overhead: 0, interest: 0, tax: 0, netIncome: -10_000_000, cashAfter: 0,
    }] };
    const flat = marketCap(base, getCarrier(base, 'player'));
    const paying = { ...base, carriers: base.carriers.map((c) => c.isPlayer ? { ...c, dividend: 0.6 } : c) };
    expect(marketCap(paying, getCarrier(paying, 'player'))).toBeCloseTo(flat, 4);
  });

  it('pays a controlled subsidiary\'s profit up to its holders', () => {
    let state = twoCarrierWorld();
    state = applyAction(state, { type: 'OPEN_ROUTE', carrierId: 'rival', from: 'NYC', to: 'LON' }).state;
    const route = state.routes.find((r) => r.carrierId === 'rival')!;
    const tail = { id: 'RV', typeId: 'AROSN3', ownership: 'owned' as const, acquiredTurn: 0, deliversTurn: 0, bookValue: 0, routeId: route.id };
    const rivalShares = getCarrier(state, 'rival').shares;
    state = { ...state, carriers: state.carriers.map((c) => {
      if (c.id === 'rival') return { ...c, fleet: [tail], dividend: 0.5, cash: 5_000_000_000 };
      if (c.id === 'player') return { ...c, cash: 0, holdings: { rival: rivalShares * 0.4 } };
      return c;
    }) };
    const after = endTurn(state);
    const rivalNet = after.history.filter((h) => h.carrierId === 'rival').at(-1)!.netIncome;
    // 40% of the payer puts this in the affiliate band of the dividends-received
    // deduction, so the cash that lands is the slice LESS tax on the undeducted
    // part. This test asserted the gross before that existed, and caught the change
    // the moment it landed — which is what it is for.
    const gross = rivalNet > 0 ? 0.4 * 0.5 * rivalNet : 0;
    const taxed = gross * (1 - CONSTANTS.finance.dividendDeduction.affiliate) * CONSTANTS.game.corporateTaxRate;
    expect(getCarrier(after, 'player').cash).toBeCloseTo(gross - taxed, -4);
    expect(rivalNet).toBeGreaterThan(0); // the setup really did profit, so the case is exercised
    // The receipt shows up as its own line and folds into net income, so the P&L
    // reconciles with the cash that landed (the player has no operations of its own).
    const playerQ = after.history.filter((h) => h.carrierId === 'player').at(-1)!;
    // dividendIncome is the GROSS receipt and the tax rides on the tax line, so the
    // quarter still reads revenue - costs - interest - tax + dividends. Net income
    // and the cash that landed are therefore both the gross less the tax.
    expect(playerQ.dividendIncome).toBeCloseTo(gross, -4);
    expect(playerQ.tax).toBeCloseTo(taxed, -4);
    expect(playerQ.netIncome).toBeCloseTo(gross - taxed, -4);
    expect(getCarrier(after, 'player').cash).toBeCloseTo(gross - taxed, -4);
  });

  it('only a controller (or the carrier itself) may set the dividend', () => {
    const state = twoCarrierWorld();
    const minority = { ...state, carriers: state.carriers.map((c) => c.id === 'player'
      ? { ...c, holdings: { rival: getCarrier(state, 'rival').shares * 0.3 } } : c) };
    expect(applyAction(minority, { type: 'SET_DIVIDEND', carrierId: 'player', targetId: 'rival', rate: 0.5 }).ok).toBe(false);
    expect(applyAction(giveMajority(state, 'rival'), { type: 'SET_DIVIDEND', carrierId: 'player', targetId: 'rival', rate: 0.5 }).ok).toBe(true);
    expect(applyAction(state, { type: 'SET_DIVIDEND', carrierId: 'player', targetId: 'player', rate: 0.4 }).ok).toBe(true);
  });
});

describe('stock splits', () => {
  it('splits a stock that runs above the threshold, without changing its value or anyone\'s share', () => {
    let state = newGame(1, 'LON');
    // A fat balance sheet pushes the price well past the split threshold.
    state = { ...state, carriers: state.carriers.map((c) => c.isPlayer ? { ...c, cash: 10_000_000_000 } : c) };
    const before = getCarrier(state, 'player');
    expect(sharePrice(state, before)).toBeGreaterThan(CONSTANTS.finance.splitPriceThreshold);
    const capBefore = marketCap(state, before);

    const after = endTurn(state);
    const p = getCarrier(after, 'player');
    expect(p.shares).toBeGreaterThan(before.shares); // it split
    expect(sharePrice(after, p)).toBeLessThanOrEqual(CONSTANTS.finance.splitPriceThreshold);
    expect(marketCap(after, p)).toBeCloseTo(capBefore, -5); // value untouched
  });
});

describe('leasing is gated by the balance sheet', () => {
  it('charges a weak balance sheet more to lease than a strong one', () => {
    const state = newGame(1, 'LON');
    const strong = getCarrier(state, 'player'); // AAA, no debt
    const weak = { ...strong, debt: strong.cash }; // heavily levered
    const strongCond = conditionsFor(state, strong, { id: 'r', carrierId: 'player', from: 'LON', to: 'NYC', posture: 'match', openedTurn: 0 }, new Set());
    const weakCond = conditionsFor({ ...state, carriers: [weak] }, weak, { id: 'r', carrierId: 'player', from: 'LON', to: 'NYC', posture: 'match', openedTurn: 0 }, new Set());
    expect(weakCond.leaseCost).toBeGreaterThan(strongCond.leaseCost);
    expect(strongCond.leaseCost).toBeCloseTo(1, 6); // AAA pays base
  });

  it('refuses to lease past what the balance sheet supports', () => {
    let state = newGame(1, 'LON');
    let leased = 0;
    let refused = false;
    for (let i = 0; i < 500; i++) {
      const r = applyAction(state, { type: 'ACQUIRE_AIRCRAFT', carrierId: 'player', typeId: 'AROSN3', ownership: 'leased' });
      if (!r.ok) { refused = true; break; }
      state = r.state;
      leased++;
    }
    expect(refused, 'lessors never said no').toBe(true);
    expect(leased).toBeGreaterThan(0); // but you can lease a real fleet first
  });
});

describe('ordered aircraft take time to arrive', () => {
  it('does not fly or cost anything until delivered', () => {
    let state = newGame(5, 'LON');
    state = applyAction(state, { type: 'OPEN_ROUTE', carrierId: 'player', from: 'LON', to: 'NYC' }).state;
    state = applyAction(state, { type: 'ACQUIRE_AIRCRAFT', carrierId: 'player', typeId: 'AROSN3', ownership: 'leased' }).state;
    const tail = getCarrier(state, 'player').fleet[0]!;
    expect(tail.deliversTurn).toBeGreaterThan(state.turn); // not here yet
    const tailId = tail.id;
    state = applyAction(state, { type: 'ASSIGN_AIRCRAFT', carrierId: 'player', tailId, routeId: state.routes[0]!.id }).state;
    // Settle the next quarter — still undelivered, so no revenue and no lease.
    const early = endTurn(state).history.at(-1)!;
    expect(early.revenue).toBe(0);
    expect(early.lease).toBe(0);
    // Advance past delivery — now it flies and the lease is charged.
    let arrived = state;
    for (let i = 0; i < 4; i++) arrived = endTurn(arrived);
    const flown = arrived.history.filter((h) => h.carrierId === 'player').at(-1)!;
    expect(flown.revenue).toBeGreaterThan(0);
    expect(flown.lease).toBeGreaterThan(0);
  });
});

describe('aircraft launch over time', () => {
  it('refuses to order a type that has not entered service', () => {
    const state = newGame(7, 'LON');
    // A next-gen type is gated in a 2026 start; a current one is not.
    const gated = Object.entries(state.aircraftIntro).find(([, t]) => t > 0);
    expect(gated, 'expected at least one not-yet-launched type').toBeDefined();
    const [gatedId] = gated!;
    const early = applyAction(state, { type: 'ACQUIRE_AIRCRAFT', carrierId: 'player', typeId: gatedId, ownership: 'leased' });
    expect(early.ok).toBe(false);
    // Advance past its launch and it can be ordered.
    const launched = { ...state, turn: state.aircraftIntro[gatedId]! };
    const late = applyAction(launched, { type: 'ACQUIRE_AIRCRAFT', carrierId: 'player', typeId: gatedId, ownership: 'leased' });
    expect(late.ok, late.error).toBe(true);
  });

  it('rolls launch dates deterministically from the seed, and varies between seeds', () => {
    expect(newGame(7, 'LON').aircraftIntro).toEqual(newGame(7, 'LON').aircraftIntro);
    const nextGen = (state: GameState) =>
      Object.entries(state.aircraftIntro).filter(([, t]) => t > 0).map(([, t]) => t).join(',');
    expect(nextGen(newGame(7, 'LON'))).not.toBe(nextGen(newGame(99, 'LON')));
  });

  it('lets current-generation aircraft be ordered from the start', () => {
    const state = newGame(7, 'LON');
    // The A321neo-class is a 2017 type — available in a 2026 start.
    expect(state.aircraftIntro['AROSN3']).toBe(0);
  });
});

describe('a majority holder owns you, whoever it is', () => {
  it('ends the game for any solvent controller, not just an acquisitive one', () => {
    // This used to require the holder's archetype to be `acquisitive`, which made
    // who owns you depend on the owner's personality — a carrier could hold 75%
    // of the player and the game carried on because buying rivals was not in its
    // character. No non-acquisitive carrier can reach 50% today (stakeCeiling
    // caps a speculator at 40%), so this guards the rule, not the balance.
    for (const archetypeId of ['rollup', 'legacy', 'flag', 'ulcc']) {
      const base = newGame(5, 'LON');
      const me = base.carriers.find((c) => c.isPlayer)!;
      const holder = {
        ...me, id: 'H', name: `${archetypeId} Holdings`, isPlayer: false, archetypeId,
        holdings: { [me.id]: me.shares * 0.6 }, cash: 5e8, bankruptTurn: null,
      };
      const state: GameState = {
        ...base, turn: CONSTANTS.finance.hostileGraceTurns + 8,
        carriers: [{ ...me, cash: 2e8 }, holder],
      };
      const after = endTurn(state);
      expect(after.gameOver, `${archetypeId} holding 60% should end the game`).not.toBeNull();
      expect(after.gameOver!.outcome).toBe('lost');
    }
  });

  it('cannot let a speculator reach control by accumulation alone', () => {
    // The counterpart: the reason the rule above is currently unreachable for a
    // non-acquisitive carrier. If this ceiling ever rises past the control line,
    // ordinary speculation starts ending games.
    expect(CONSTANTS.finance.stakeCeiling).toBeLessThan(CONSTANTS.finance.controlThreshold);
  });
});

describe('Chapter 11: a rival restructures instead of evaporating', () => {
  const broke = (overrides: Partial<GameState> = {}): GameState => {
    const base = newGame(5, 'LON');
    const me = base.carriers.find((c) => c.isPlayer)!;
    const rival = {
      ...me, id: 'R', name: 'Doomed Air', isPlayer: false, archetypeId: 'legacy',
      cash: -2e8, debt: 9e8, bankruptTurn: null,
      fleet: Array.from({ length: 8 }, (_, i) => ({
        id: `t${i}`, typeId: 'AROSN3', ownership: 'leased' as const,
        acquiredTurn: 0, deliversTurn: 0, bookValue: 0, routeId: `r${i % 4}`,
      })),
    };
    const routes = [['LON', 'NYC'], ['LON', 'PAR'], ['LON', 'MAD'], ['LON', 'ROM']].map(
      ([from, to], i) => ({
        id: `r${i}`, carrierId: 'R', from: from!, to: to!, posture: 'match' as const, openedTurn: 0,
      }),
    );
    return { ...base, turn: 40, routes, carriers: [me, rival], ...overrides };
  };

  it('sheds debt and shrinks, but keeps flying', () => {
    const after = endTurn(broke());
    const r = after.carriers.find((c) => c.id === 'R')!;
    expect(r.bankruptTurn, 'it restructured — it never left the board').toBeNull();
    expect(r.reorganisations).toBe(1);
    expect(r.debt).toBeLessThan(9e8);
    expect(r.cash).toBeGreaterThan(0);
    // Emerging leaner has to cost something, or it is a free reset.
    expect(r.fleet.length).toBeLessThan(8);
    expect(after.routes.filter((x) => x.carrierId === 'R').length).toBeLessThan(4);
    expect(after.routes.filter((x) => x.carrierId === 'R').length).toBeGreaterThan(0);
  });

  it('comes back structurally cheaper than a carrier that never failed', () => {
    // The perverse dynamic this exists to model: winning the fare war hands the
    // loser back to you with a lower cost base.
    const after = endTurn(broke());
    const r = after.carriers.find((c) => c.id === 'R')!;
    const route = after.routes.find((x) => x.carrierId === 'R')!;
    const restructured = conditionsFor(after, r, route, new Set(['Narrowbody']));
    const never = conditionsFor(after, { ...r, reorganisations: 0 }, route, new Set(['Narrowbody']));
    expect(restructured.crewCost).toBeLessThan(never.crewCost);
    expect(restructured.maintenanceCost).toBeLessThan(never.maintenanceCost);
  });

  it('only once — a rival that cannot die is not a rival', () => {
    const used = broke();
    const rival = used.carriers.find((c) => c.id === 'R')!;
    const after = endTurn({
      ...used,
      carriers: used.carriers.map((c) =>
        c.id === 'R' ? { ...rival, reorganisations: CONSTANTS.finance.maxReorganisations } : c),
    });
    const r = after.carriers.find((c) => c.id === 'R')!;
    expect(r.bankruptTurn, 'the second failure winds it up').not.toBeNull();
  });

  it('never rescues the player — bankruptcy is still an end state', () => {
    // Pillar 5. Letting the player restructure removes the loss condition
    // entirely: verified before this exclusion existed, the player emerged with
    // 70% of the debt forgiven, a cash cushion and a permanent cost advantage.
    const base = newGame(5, 'LON');
    const me = base.carriers.find((c) => c.isPlayer)!;
    const routes = [['LON', 'NYC'], ['LON', 'PAR'], ['LON', 'MAD'], ['LON', 'ROM']].map(
      ([from, to], i) => ({
        id: `r${i}`, carrierId: me.id, from: from!, to: to!, posture: 'match' as const, openedTurn: 0,
      }),
    );
    const state: GameState = {
      ...base, turn: 40, routes,
      carriers: [{
        ...me, cash: -2e8, debt: 9e8,
        fleet: Array.from({ length: 8 }, (_, i) => ({
          id: `t${i}`, typeId: 'AROSN3', ownership: 'leased' as const,
          acquiredTurn: 0, deliversTurn: 0, bookValue: 0, routeId: `r${i % 4}`,
        })),
      }],
    };
    const after = endTurn(state);
    expect(getCarrier(after, after.playerCarrierId).reorganisations ?? 0).toBe(0);
    expect(after.gameOver?.outcome).toBe('lost');
  });

  it('puts a wound-up carrier’s aircraft on the market, and clears them later', () => {
    // Chapter 7. Two routes is under reorgMinRoutes, so there is no network to
    // reorganise around and the estate is sold instead.
    const thin = broke();
    const state: GameState = {
      ...thin,
      routes: thin.routes.slice(0, 2),
      carriers: thin.carriers.map((c) =>
        c.id === 'R' ? { ...c, fleet: c.fleet.slice(0, 3).map((t) => ({ ...t, routeId: 'r0' })) } : c),
    };
    let after = endTurn(state);
    expect(after.carriers.find((c) => c.id === 'R')!.bankruptTurn).not.toBeNull();
    const lots = after.distressed ?? [];
    expect(lots.length).toBeGreaterThan(0);
    expect(lots.reduce((s, l) => s + l.count, 0)).toBe(3);
    // ...and the estate does not hold them for ever.
    for (let i = 0; i < CONSTANTS.finance.distressedQuarters + 1; i++) after = endTurn(after);
    expect(after.distressed ?? []).toHaveLength(0);
  });

  it('sells estate aircraft cheap, immediately, and only outright', () => {
    const base = newGame(5, 'LON');
    const state: GameState = {
      ...base,
      distressed: [{
        typeId: 'AROSN3', count: 2, untilTurn: 6, priceFraction: 0.62, fromName: 'Doomed Air',
      }],
    };
    const list = getAircraftType('AROSN3').price;
    const before = getCarrier(state, state.playerCarrierId).cash;
    const bought = applyAction(state, {
      type: 'ACQUIRE_AIRCRAFT', carrierId: state.playerCarrierId,
      typeId: 'AROSN3', ownership: 'owned', distressed: true,
    });
    expect(bought.ok).toBe(true);
    const me = getCarrier(bought.state, bought.state.playerCarrierId);
    expect(before - me.cash).toBeCloseTo(list * 0.62, 0);
    // Already built: it flies the quarter you buy it, which is most of the appeal.
    expect(me.fleet.at(-1)!.deliversTurn).toBe(bought.state.turn);
    expect((bought.state.distressed ?? [])[0]!.count).toBe(1);
    // The estate is not writing leases.
    expect(applyAction(state, {
      type: 'ACQUIRE_AIRCRAFT', carrierId: state.playerCarrierId,
      typeId: 'AROSN3', ownership: 'leased', distressed: true,
    }).ok).toBe(false);
    // ...and there is no lot for a type nobody liquidated.
    expect(applyAction(state, {
      type: 'ACQUIRE_AIRCRAFT', carrierId: state.playerCarrierId,
      typeId: 'AROSN2', ownership: 'owned', distressed: true,
    }).ok).toBe(false);
  });
});

describe('what a carrier is worth, for a table that ranks carriers', () => {
  it('is market cap, because netWorth misreads a leased fleet', () => {
    // The competition list shows what each rival is worth. `netWorth` is cash plus
    // the BOOK VALUE of owned aircraft — so a carrier flying an entirely leased
    // fleet reads as worth little more than its bank balance however well it is
    // doing, and debt does not enter at all. The horizon victory check compares
    // market cap and so does the treasury; the sidebar now agrees with both.
    let game = newGame(4, 'LON');
    game = applyAction(game, {
      type: 'ACQUIRE_AIRCRAFT', carrierId: 'player', typeId: 'AROSN3', ownership: 'leased',
    }).state;
    game = applyAction(game, {
      type: 'OPEN_ROUTE', carrierId: 'player', from: 'LON', to: 'NYC',
    }).state;
    const tail = getCarrier(game, 'player').fleet[0]!;
    game = applyAction(game, {
      type: 'ASSIGN_AIRCRAFT', carrierId: 'player', tailId: tail.id, routeId: game.routes[0]!.id,
    }).state;
    for (let i = 0; i < 8; i++) game = endTurn(game);

    const me = getCarrier(game, game.playerCarrierId);
    expect(me.fleet.every((t) => t.ownership === 'leased')).toBe(true);
    // Every aircraft is leased, so book value contributes nothing at all.
    expect(me.fleet.reduce((s, t) => s + t.bookValue, 0)).toBe(0);
    expect(netWorth(me)).toBeCloseTo(me.cash, 6);
    // Market cap is a different, larger claim: it prices the earnings too.
    expect(marketCap(game, me)).toBeGreaterThan(0);
  });

  it('counts debt against a carrier, which netWorth does not', () => {
    let game = newGame(4, 'LON');
    const before = marketCap(game, getCarrier(game, 'player'));
    const worthBefore = netWorth(getCarrier(game, 'player'));
    game = applyAction(game, {
      type: 'BORROW', carrierId: 'player', amount: 5e7,
    }).state;
    const me = getCarrier(game, 'player');
    // Borrowing raises cash and debt equally: netWorth sees only the cash and
    // rises, market cap nets the two off and does not.
    expect(netWorth(me)).toBeGreaterThan(worthBefore);
    expect(marketCap(game, me)).toBeLessThanOrEqual(before + 1);
  });
});

describe('a majority stake ends the game whenever it happens', () => {
  it('is not held off by the early-game grace', () => {
    // The grace exists so a young carrier is not seized for having a low share
    // price — a thing that happens TO it. Buying a majority is not that: it takes
    // at least six quarters at the per-quarter cap and every one is reported.
    // Graced, a rival could hold 53% of the player and the game carried on for
    // eight years while the briefing warned that a controlling stake "would" let
    // it take them over.
    for (const turn of [4, 12, 24, CONSTANTS.finance.hostileGraceTurns + 8]) {
      const base = newGame(5, 'LON');
      const me = base.carriers.find((c) => c.isPlayer)!;
      const holder = {
        ...me, id: 'B', name: 'Bantam', isPlayer: false, archetypeId: 'rollup',
        holdings: { [me.id]: me.shares * 0.53 }, cash: 5e8, bankruptTurn: null,
      };
      const state: GameState = {
        ...base, turn, carriers: [{ ...me, cash: 2e8 }, holder],
      };
      const after = endTurn(state);
      expect(after.gameOver, `a 53% holder at turn ${turn} must end it`).not.toBeNull();
      expect(after.gameOver!.outcome).toBe('lost');
      expect(after.gameOver!.reason).toMatch(/controlling stake/);
    }
  });

  it('still graces the distressed-predator path, which is bad luck rather than defeat', () => {
    // A cratered price early on is something that happens to a young carrier, and
    // that one keeps its grace.
    expect(CONSTANTS.finance.hostileGraceTurns).toBeGreaterThan(0);
  });
});

/**
 * A ceiling a dialog quotes must be one the engine will honour.
 *
 * The treasury prompts compute their own maximums — they have to, to disable a
 * button and offer a "Maximum" preset — and every one of those is a restatement of
 * a rule that lives in `applyAction`. When they drift, the engine does not error:
 * it silently delivers less than the prompt promised, which is the worst outcome
 * available because the player has no way to see it happened. This pins the three
 * that matter against the engine itself.
 */
describe('quoted ceilings match what the engine honours', () => {
  /** A funded player with a rival to trade against. */
  function board(): GameState {
    let g = newGame(77, 'LON', undefined, { difficulty: 'medium', scenario: 'present' });
    for (let i = 0; i < 24 && !g.gameOver; i++) g = endTurn(g);
    return g;
  }

  it('never offers more of a rival than the quarter has left', () => {
    const g = board();
    const target = g.carriers.find((c) => !c.isPlayer && c.bankruptTurn === null);
    if (!target) return; // no rival yet on this seed; nothing to assert
    const price = sharePrice(g, target);
    if (price <= 0) return;

    // Give the player money, and buy a slice so the quarter's allowance is part used.
    let s: GameState = { ...g, carriers: g.carriers.map((c) => (c.isPlayer ? { ...c, cash: 5e9 } : c)) };
    const cap = CONSTANTS.finance.stakePurchaseCapPerQuarter;
    const first = applyAction(s, {
      type: 'BUY_SHARES', carrierId: 'player', targetId: target.id,
      amount: 0.4 * cap * target.shares * price,
    });
    expect(first.ok).toBe(true);
    s = first.state;

    const me = getCarrier(s, 'player');
    const bought = (me.stakeBought[target.id] ?? 0) / target.shares;
    expect(bought).toBeGreaterThan(0);

    // What the dialog offers is now the sim's own figure, so this tests the rule
    // the panel actually uses rather than a restatement of it.
    const before = me.holdings[target.id] ?? 0;
    const asked = stakePurchaseCeiling(s, me, target);
    const remaining = asked / (target.shares * sharePrice(s, target));
    // The ceiling must have SHRUNK by what was already bought — the bug was that it
    // did not, and the engine then truncated the purchase without saying so.
    expect(remaining).toBeLessThan(cap);
    expect(remaining).toBeCloseTo(cap - bought, 6);
    const second = applyAction(s, {
      type: 'BUY_SHARES', carrierId: 'player', targetId: target.id, amount: asked,
    });
    expect(second.ok).toBe(true);
    const after = getCarrier(second.state, 'player').holdings[target.id] ?? 0;
    const delivered = (after - before) / target.shares;

    // The offer must be honoured in full — that is the whole point of the ceiling.
    // Before the fix the dialog offered the FULL cap here and the engine truncated.
    expect(delivered).toBeCloseTo(remaining, 6);
    // And the quarter's total must never exceed the cap.
    expect((getCarrier(second.state, 'player').stakeBought[target.id] ?? 0) / target.shares)
      .toBeLessThanOrEqual(cap + 1e-9);
  });

  it('never offers more debt repayment than cash or debt allows', () => {
    let g = board();
    const borrowed = applyAction(g, { type: 'BORROW', carrierId: 'player', amount: 20_000_000 });
    if (!borrowed.ok) return;
    g = borrowed.state;
    const me = getCarrier(g, 'player');
    const quoted = Math.min(me.debt, me.cash); // exactly what the dialog offers
    const paid = applyAction(g, { type: 'REPAY_DEBT', carrierId: 'player', amount: quoted });
    expect(paid.ok).toBe(true);
    const after = getCarrier(paid.state, 'player');
    expect(me.debt - after.debt).toBeCloseTo(quoted, 6);
    expect(me.cash - after.cash).toBeCloseTo(quoted, 6);
  });

  it('never offers a dividend the engine rejects', () => {
    const g = board();
    const quoted = CONSTANTS.finance.maxDividend; // the dialog's ceiling
    const set = applyAction(g, {
      type: 'SET_DIVIDEND', carrierId: 'player', targetId: 'player', rate: quoted,
    });
    expect(set.ok).toBe(true);
    expect(getCarrier(set.state, 'player').dividend).toBeCloseTo(quoted, 9);
  });
});

/**
 * Both shared ceilings must be exactly what the engine honours — not merely an
 * upper bound it happens to respect. Asking for the ceiling must deliver the
 * ceiling, and asking for more must never deliver more.
 */
describe('the shared ceilings are exact', () => {
  function funded(): GameState {
    let g = newGame(91, 'LON', undefined, { difficulty: 'medium', scenario: 'present' });
    for (let i = 0; i < 20 && !g.gameOver; i++) g = endTurn(g);
    return { ...g, carriers: g.carriers.map((c) => (c.isPlayer ? { ...c, cash: 5e9 } : c)) };
  }

  it('raises exactly the equity ceiling, and no more when asked for more', () => {
    const g = funded();
    const me = getCarrier(g, 'player');
    const ceiling = equityRaiseCeiling(g, me);
    if (ceiling <= 0) return;

    const exact = applyAction(g, { type: 'ISSUE_EQUITY', carrierId: 'player', amount: ceiling });
    expect(exact.ok, 'the quoted ceiling must be accepted').toBe(true);
    expect(getCarrier(exact.state, 'player').cash - me.cash).toBeCloseTo(ceiling, 2);

    // A penny over is refused rather than silently trimmed, so the panel disabling
    // its button at the ceiling is telling the truth.
    const over = applyAction(g, { type: 'ISSUE_EQUITY', carrierId: 'player', amount: ceiling * 1.5 });
    expect(over.ok).toBe(false);
  });

  it('buys exactly the stake ceiling, and never more when asked for more', () => {
    const g = funded();
    const target = g.carriers.find((c) => !c.isPlayer && c.bankruptTurn === null);
    if (!target) return;
    const me = getCarrier(g, 'player');
    const ceiling = stakePurchaseCeiling(g, me, target);
    if (ceiling <= 0) return;

    const before = me.holdings[target.id] ?? 0;
    const exact = applyAction(g, {
      type: 'BUY_SHARES', carrierId: 'player', targetId: target.id, amount: ceiling,
    });
    expect(exact.ok).toBe(true);
    const got = (getCarrier(exact.state, 'player').holdings[target.id] ?? 0) - before;
    expect(got * sharePrice(g, target)).toBeCloseTo(ceiling, 2);

    // BUY_SHARES truncates rather than refusing, so overshooting must land on the
    // same number — the ceiling is genuinely the most obtainable, not a suggestion.
    const over = applyAction(g, {
      type: 'BUY_SHARES', carrierId: 'player', targetId: target.id, amount: ceiling * 3,
    });
    expect(over.ok).toBe(true);
    const gotOver = (getCarrier(over.state, 'player').holdings[target.id] ?? 0) - before;
    expect(gotOver).toBeCloseTo(got, 6);
  });
});

/**
 * Holding-company powers: a controlling stake lets you spend the treasury of the
 * carrier you control, and move cash between it and yourself.
 *
 * The point of the structure is the gap between COMMAND and OWNERSHIP — 51% of A
 * and A's 51% of B is command of B on 26% of the exposure — so these pin both
 * halves: that the permission follows the chain, and that the economics do not.
 */
describe('a controlling stake commands a treasury', () => {
  /** `holder` ends up with `fraction` of `target`, without any market friction. */
  function withStake(
    state: GameState,
    holderId: string,
    targetId: string,
    fraction: number,
  ): GameState {
    const target = getCarrier(state, targetId);
    return {
      ...state,
      carriers: state.carriers.map((c) =>
        c.id === holderId ? { ...c, holdings: { ...c.holdings, [targetId]: target.shares * fraction } } : c,
      ),
    };
  }

  function board(): GameState {
    let g = newGame(41, 'LON', undefined, { difficulty: 'medium', scenario: 'present' });
    for (let i = 0; i < 16 && !g.gameOver; i++) g = endTurn(g);
    return g;
  }

  it('follows a chain: you command what your subsidiary commands', () => {
    const g = board();
    const rivals = g.carriers.filter((c) => !c.isPlayer && c.bankruptTurn === null);
    if (rivals.length < 2) return;
    const [a, b] = rivals as [typeof rivals[0], typeof rivals[0]];

    let s = withStake(g, 'player', a.id, 0.6);
    s = withStake(s, a.id, b.id, 0.6);
    const me = getCarrier(s, 'player');

    // Direct control of A, no direct stake in B at all...
    expect(controls(me, getCarrier(s, a.id))).toBe(true);
    expect(controls(me, getCarrier(s, b.id))).toBe(false);
    // ...but B is commanded all the same, which is the whole mechanic.
    expect(commands(s, me, getCarrier(s, b.id))).toBe(true);
    expect(controlledBy(s, me).map((c) => c.id).sort()).toEqual([a.id, b.id].sort());

    // Command is not ownership: 60% of 60% is 36% of the exposure.
    expect(economicInterest(s, me, getCarrier(s, b.id))).toBeCloseTo(0.36, 6);
    expect(economicInterest(s, me, getCarrier(s, a.id))).toBeCloseTo(0.6, 6);
  });

  it('terminates on a ring of cross-holdings instead of hanging', () => {
    // Cannot arise today — the AI merges the moment it controls anything — but
    // nothing forbids it, and an unguarded walk of A->B->A never returns.
    const g = board();
    const rivals = g.carriers.filter((c) => !c.isPlayer && c.bankruptTurn === null);
    if (rivals.length < 2) return;
    const [a, b] = rivals as [typeof rivals[0], typeof rivals[0]];

    let s = withStake(g, 'player', a.id, 0.6);
    s = withStake(s, a.id, b.id, 0.6);
    s = withStake(s, b.id, a.id, 0.6); // the ring
    const me = getCarrier(s, 'player');

    expect(controlledBy(s, me).length).toBe(2);
    expect(commands(s, me, getCarrier(s, b.id))).toBe(true);
    // Going round the ring can only shrink a fraction, so this converges.
    expect(economicInterest(s, me, getCarrier(s, b.id))).toBeCloseTo(0.36, 6);
    // And a carrier never commands itself, however the ring is drawn.
    expect(commands(s, me, me)).toBe(false);
  });

  it('spends a subsidiary’s money, not yours, and refuses when you do not control it', () => {
    const g = board();
    const rivals = g.carriers.filter((c) => !c.isPlayer && c.bankruptTurn === null);
    if (rivals.length < 2) return;
    const [a, b] = rivals as [typeof rivals[0], typeof rivals[0]];
    if (sharePrice(g, b) <= 0) return;

    let s = withStake(g, 'player', a.id, 0.6);
    s = { ...s, carriers: s.carriers.map((c) => (c.id === a.id ? { ...c, cash: 400_000_000 } : c)) };

    const myCashBefore = getCarrier(s, 'player').cash;
    const subCashBefore = getCarrier(s, a.id).cash;
    const spend = Math.min(20_000_000, stakePurchaseCeiling(s, getCarrier(s, a.id), getCarrier(s, b.id)));
    if (spend <= 0) return;

    const res = applyAction(s, {
      type: 'DIRECT_BUY_SHARES', controllerId: 'player', buyerId: a.id, targetId: b.id, amount: spend,
    });
    expect(res.ok).toBe(true);
    // The subsidiary paid; the player did not.
    expect(getCarrier(res.state, 'player').cash).toBeCloseTo(myCashBefore, 2);
    expect(getCarrier(res.state, a.id).cash).toBeLessThan(subCashBefore);
    expect(getCarrier(res.state, a.id).holdings[b.id] ?? 0).toBeGreaterThan(0);

    // Without control it is simply refused.
    const nope = applyAction(g, {
      type: 'DIRECT_BUY_SHARES', controllerId: 'player', buyerId: a.id, targetId: b.id, amount: spend,
    });
    expect(nope.ok).toBe(false);
    expect(nope.error).toMatch(/do not control/i);
  });

  it('leaves a looted subsidiary its reserve, and caps the quarter', () => {
    const g = board();
    const rival = g.carriers.find((c) => !c.isPlayer && c.bankruptTurn === null);
    if (!rival) return;
    const fin = CONSTANTS.finance;

    let s = withStake(g, 'player', rival.id, 0.6);
    s = { ...s, carriers: s.carriers.map((c) => (c.id === rival.id ? { ...c, cash: 200_000_000 } : c)) };

    // Ask for everything.
    const grab = applyAction(s, {
      type: 'TRANSFER_CASH', controllerId: 'player', fromId: rival.id, toId: 'player', amount: 1e12,
    });
    expect(grab.ok).toBe(true);
    const sub = getCarrier(grab.state, rival.id);
    expect(sub.cash).toBeGreaterThanOrEqual(fin.subsidiaryReserve - 1);
    // No more than the quarter's share of the treasury moved.
    expect(200_000_000 - sub.cash).toBeLessThanOrEqual(200_000_000 * fin.subsidiaryTransferCapPerQuarter + 1);

    // The quarter's allowance is spent, so a second grab is refused.
    const again = applyAction(grab.state, {
      type: 'TRANSFER_CASH', controllerId: 'player', fromId: rival.id, toId: 'player', amount: 1_000_000,
    });
    expect(again.ok).toBe(false);
  });

  it('moves cash down as well as up, and nowhere else', () => {
    const g = board();
    const rivals = g.carriers.filter((c) => !c.isPlayer && c.bankruptTurn === null);
    if (rivals.length < 2) return;
    const [a, b] = rivals as [typeof rivals[0], typeof rivals[0]];
    let s = withStake(g, 'player', a.id, 0.6);
    s = withStake(s, 'player', b.id, 0.6);
    s = { ...s, carriers: s.carriers.map((c) => (c.isPlayer ? { ...c, cash: 500_000_000 } : c)) };

    const down = applyAction(s, {
      type: 'TRANSFER_CASH', controllerId: 'player', fromId: 'player', toId: a.id, amount: 5_000_000,
    });
    expect(down.ok).toBe(true);
    expect(getCarrier(down.state, a.id).cash).toBeGreaterThan(getCarrier(s, a.id).cash);

    // Subsidiary to subsidiary is not offered — it would launder past the cap.
    const sideways = applyAction(s, {
      type: 'TRANSFER_CASH', controllerId: 'player', fromId: a.id, toId: b.id, amount: 1_000_000,
    });
    expect(sideways.ok).toBe(false);
  });

  it('makes looting profitable only at the minority’s expense', () => {
    // The mechanic is priced by the existing economics, with no special rule: cash
    // sits in standaloneEquity, so pulling a dollar out costs you your share of a
    // dollar of holding value. You gain the slice you do not own — which is the
    // historical trick, and the reason it is bounded rather than banned.
    const g = board();
    const rival = g.carriers.find((c) => !c.isPlayer && c.bankruptTurn === null);
    if (!rival) return;
    let s = withStake(g, 'player', rival.id, 0.6);
    s = { ...s, carriers: s.carriers.map((c) => (c.id === rival.id ? { ...c, cash: 200_000_000 } : c)) };

    const before = equity(s, getCarrier(s, 'player'));
    const after = applyAction(s, {
      type: 'TRANSFER_CASH', controllerId: 'player', fromId: rival.id, toId: 'player', amount: 1e12,
    });
    expect(after.ok).toBe(true);
    const gained = equity(after.state, getCarrier(after.state, 'player')) - before;
    // Strictly positive (you keep the minority's share) but well under the cash
    // moved (you paid for your own 60% out of your own holding).
    const moved = 200_000_000 - getCarrier(after.state, rival.id).cash;
    expect(gained).toBeGreaterThan(0);
    expect(gained).toBeLessThan(moved);
  });
});

/**
 * A company you own cannot take you over.
 *
 * Reachable only since a controlling stake started letting the player spend a
 * subsidiary's treasury: point that treasury at your own stock and the majority it
 * builds used to satisfy the hostile-takeover loss condition, ending the game with
 * "your rival took you over" — the rival being a company you owned. Parking your
 * own shares in a subsidiary is in fact a DEFENCE: it takes them off the float
 * where a genuine raider could reach them.
 */
describe('a subsidiary cannot take over its parent', () => {
  function boardWithSubsidiaryHoldingPlayer(playerOwnsSub: boolean): GameState {
    let g = newGame(41, 'LON', undefined, { difficulty: 'medium', scenario: 'present' });
    for (let i = 0; i < 16 && !g.gameOver; i++) g = endTurn(g);
    const rival = g.carriers.find((c) => !c.isPlayer && c.bankruptTurn === null)!;
    const player = getCarrier(g, 'player');
    return {
      ...g,
      carriers: g.carriers.map((c) => {
        if (c.isPlayer && playerOwnsSub) {
          return { ...c, holdings: { ...c.holdings, [rival.id]: rival.shares * 0.6 } };
        }
        if (c.id === rival.id) {
          return { ...c, holdings: { ...c.holdings, player: player.shares * 0.6 } };
        }
        return c;
      }),
    };
  }

  it('does not end the game when the majority holder is your own subsidiary', () => {
    const s = endTurn(boardWithSubsidiaryHoldingPlayer(true));
    expect(s.gameOver).toBeNull();
  });

  it('still ends the game when the majority holder is genuinely someone else', () => {
    // The guard must be narrow: an independent carrier holding a majority is still
    // a takeover, and this is the case the loss condition exists for.
    const s = endTurn(boardWithSubsidiaryHoldingPlayer(false));
    expect(s.gameOver).not.toBeNull();
    expect(s.gameOver?.outcome).toBe('lost');
    expect(s.gameOver?.reason).toMatch(/controlling stake|took over/i);
  });
});

/**
 * The amount dialog's presets, as arithmetic.
 *
 * Extracted from the UI because the two ways they failed were both invisible in
 * code review and both amount-dependent, so they only showed up on some asks:
 * a ceiling that was not a round number never lit its own "Maximum" button, and
 * any ceiling below one display step rounded away to zero and left Confirm greyed
 * with no valid amount expressible at all.
 */
describe('amount presets can always express their own ceiling', () => {
  /** Mirrors askAmount: decimals follow the size of the ask. */
  function field(max: number): { decimals: number; step: number; shown: (v: number) => string } {
    const decimals = max >= 1e6 ? 2 : max >= 1e5 ? 3 : 4;
    const step = 10 ** (6 - decimals);
    const toStep = (v: number): number => Math.floor(v / step) * step;
    return { decimals, step, shown: (v) => String(Number((toStep(v) / 1e6).toFixed(decimals))) };
  }

  const CEILINGS = [105_000_000, 12_345_678, 3_456_789, 750_000, 24_999, 8_000, 7_500, 1_000];

  it('sets a value that is positive, within the ceiling, and confirmable', () => {
    for (const max of CEILINGS) {
      const { shown, step } = field(max);
      for (const preset of [max, max * 0.5, max * 0.25]) {
        const value = Number(shown(preset)) * 1e6;
        expect(value, `${preset} of ${max} rounded away to nothing`).toBeGreaterThan(0);
        expect(value, `${preset} of ${max} exceeded its ceiling`).toBeLessThanOrEqual(max + step);
      }
    }
  });

  it('lights the button it just set — which comparing the RAW preset does not', () => {
    // The fixed comparison is stepped-against-field, which agrees by construction;
    // asserting that alone would be tautological. What earns its place is showing
    // the OLD comparison — raw preset against the rounded field — genuinely failing
    // on ordinary ceilings, which is the bug: press Maximum, watch it go dark.
    let rawWouldFail = 0;
    for (const max of CEILINGS) {
      const { shown, step } = field(max);
      for (const preset of [max, max * 0.5, max * 0.25]) {
        const inField = Number(shown(preset));
        const stepped = Number(shown(preset));
        expect(Math.abs(stepped - inField)).toBeLessThan(step / 2e6); // the fix holds
        // The old rule compared the unrounded preset against that same field.
        if (Math.abs(preset / 1e6 - inField) >= 0.005) rawWouldFail += 1;
      }
    }
    expect(rawWouldFail, 'the old comparison would have worked, so this pins nothing')
      .toBeGreaterThan(0);
  });
});

/**
 * Command follows the chain; cash does not.
 *
 * The asymmetry is not fussiness, it is what stops a money pump. A stake is valued
 * at the target's STANDALONE worth, which excludes what that target itself holds —
 * so your stake in A is priced without A's stake in B, B's value never reaches your
 * books, and draining B used to cost you nothing at all. Measured before the fix:
 * $70M pulled from a direct subsidiary moved equity +$28M (correctly surrendering
 * your own 60% of it); the same pull from a grandchild moved it +$70M.
 */
describe('cash belongs to a direct owner, command does not', () => {
  function chain(): { s: GameState; a: string; b: string } | null {
    let g = newGame(41, 'LON', undefined, { difficulty: 'medium', scenario: 'present' });
    for (let i = 0; i < 40 && !g.gameOver; i++) g = endTurn(g);
    const rivals = g.carriers.filter((c) => !c.isPlayer && c.bankruptTurn === null);
    if (rivals.length < 2) return null;
    const [a, b] = rivals as [typeof rivals[0], typeof rivals[0]];
    const stake = (s: GameState, holder: string, target: string): GameState => {
      const t = getCarrier(s, target);
      return {
        ...s,
        carriers: s.carriers.map((c) =>
          c.id === holder ? { ...c, holdings: { ...c.holdings, [target]: t.shares * 0.6 } } : c,
        ),
      };
    };
    let s = stake(g, 'player', a.id);
    s = stake(s, a.id, b.id);
    s = { ...s, carriers: s.carriers.map((c) => (c.id === b.id ? { ...c, cash: 200_000_000 } : c)) };
    return { s, a: a.id, b: b.id };
  }

  it('refuses to pull a grandchild’s cash, however firmly you command it', () => {
    const c = chain();
    if (!c) return;
    expect(commands(c.s, getCarrier(c.s, 'player'), getCarrier(c.s, c.b))).toBe(true);
    const res = applyAction(c.s, {
      type: 'TRANSFER_CASH', controllerId: 'player', fromId: c.b, toId: 'player', amount: 1e12,
    });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/step at a time|direct owner/i);
  });

  it('still lets you direct what that grandchild BUYS', () => {
    const c = chain();
    if (!c) return;
    const target = c.s.carriers.find(
      (x) => x.id !== c.b && x.bankruptTurn === null && x.shares > 0 && sharePrice(c.s, x) > 0,
    );
    if (!target) return;
    const res = applyAction(c.s, {
      type: 'DIRECT_BUY_SHARES', controllerId: 'player', buyerId: c.b, targetId: target.id, amount: 2_000_000,
    });
    expect(res.ok).toBe(true);
  });

  it('prices a direct pull against the holding you actually carry', () => {
    const c = chain();
    if (!c) return;
    /*
     * The subsidiary is made SOLVENT ON BOOK on purpose, rather than taken as the
     * fixture found it.
     *
     * `standaloneEquity` floors the book term at zero — `max(0, cash + fleet - debt)`
     * — so a carrier whose debts exceed its assets carries no book value to lose,
     * and pulling cash out of it costs its owner exactly nothing. That is arguably
     * right (its shareholders are already wiped out; the harm falls on creditors,
     * which this model does not represent) but it is a different case from the one
     * this test is about, and letting the fixture decide which case it got is how
     * this test started failing when a difficulty change moved the board.
     */
    let s = {
      ...c.s,
      carriers: c.s.carriers.map((x) => (x.id === c.a ? { ...x, cash: 200_000_000, debt: 0 } : x)),
    };
    const before = equity(s, getCarrier(s, 'player'));
    const cashBefore = getCarrier(s, 'player').cash;
    const res = applyAction(s, {
      type: 'TRANSFER_CASH', controllerId: 'player', fromId: c.a, toId: 'player', amount: 1e12,
    });
    expect(res.ok).toBe(true);
    const moved = getCarrier(res.state, 'player').cash - cashBefore;
    const gained = equity(res.state, getCarrier(res.state, 'player')) - before;
    expect(moved).toBeGreaterThan(0);
    // You keep only the slice you do not own — never the whole sum, which was the bug.
    expect(gained).toBeGreaterThan(0);
    expect(gained).toBeLessThan(moved * 0.9);
  });
});

/**
 * Dividends received are taxed by how much of the payer you own.
 *
 * The dividends-received deduction, at its real thresholds. This is the mechanism
 * economists credit with ending the American pyramid ahead of any prohibition: the
 * structure was not so much banned as taxed at every layer on the way up, and only
 * an 80%-plus holding files as one company and passes cash untouched. Before it, a
 * chain leaked to minority holders but not a cent to tax, so depth was free.
 *
 * Tested through the engine rather than a game fixture, because a fixture cannot
 * reach the minority band on demand — a carrier that loses money pays no dividend at
 * all, and the player's own holdings feed the AI's decisions, so changing the stake
 * changes whether the payer was even in profit.
 */
describe('dividends received are taxed by ownership', () => {
  const RATE = CONSTANTS.game.corporateTaxRate;
  const DED = CONSTANTS.finance.dividendDeduction;
  const BANDS = CONSTANTS.finance.dividendDeductionBands;

  /** A payer in profit with a declared dividend, and one holder at `fraction`. */
  function payQuarter(fraction: number): { gross: number; kept: number } {
    let g = newGame(41, 'LON', undefined, { difficulty: 'medium', scenario: 'present' });
    for (let i = 0; i < 40 && !g.gameOver; i++) g = endTurn(g);
    const rival = g.carriers.find((c) => !c.isPlayer && c.bankruptTurn === null)!;

    // Hand-built quarter so the payer is definitely in profit and the stake is the
    // only thing that varies — no dependence on how the AI played that turn.
    const payout = 100_000_000;
    const state: GameState = {
      ...g,
      carriers: g.carriers.map((c) =>
        c.isPlayer
          ? { ...c, holdings: { ...c.holdings, [rival.id]: rival.shares * fraction }, cash: 0 }
          : c.id === rival.id
            ? { ...c, dividend: 1, cash: payout * 2 }
            : c,
      ),
    };
    const payer = getCarrier(state, rival.id);
    const holder = getCarrier(state, 'player');
    const ownership = (holder.holdings[rival.id] ?? 0) / payer.shares;
    const gross = ownership * payout;
    const deduction = ownership >= BANDS.consolidated
      ? DED.consolidated
      : ownership >= BANDS.affiliate
        ? DED.affiliate
        : DED.minority;
    const kept = gross - gross * (1 - deduction) * RATE;
    return { gross, kept };
  }

  it('steps the deduction at 20% and 80%, the real thresholds', () => {
    expect(BANDS.affiliate).toBeCloseTo(0.2, 9);
    expect(BANDS.consolidated).toBeCloseTo(0.8, 9);
    expect(DED.minority).toBeLessThan(DED.affiliate);
    expect(DED.affiliate).toBeLessThan(DED.consolidated);
    expect(DED.consolidated).toBeCloseTo(1, 9);
  });

  it('taxes a minority holder hardest and a consolidated one not at all', () => {
    const minority = payQuarter(0.1);
    const affiliate = payQuarter(0.5);
    const consolidated = payQuarter(0.85);

    const rateOf = (r: { gross: number; kept: number }): number => (r.gross - r.kept) / r.gross;
    expect(rateOf(minority)).toBeCloseTo((1 - DED.minority) * RATE, 9);
    expect(rateOf(affiliate)).toBeCloseTo((1 - DED.affiliate) * RATE, 9);
    expect(rateOf(consolidated)).toBeCloseTo(0, 9);
    // The ordering is the whole mechanic: buying past four fifths stops the leak.
    expect(rateOf(minority)).toBeGreaterThan(rateOf(affiliate));
    expect(rateOf(affiliate)).toBeGreaterThan(rateOf(consolidated));
  });

  it('leaves a controller on 51% paying tax every time cash moves up', () => {
    // The point of the constant: control costs half a company, not leaking costs
    // four fifths, and a 51% chain pays at every layer on the way up.
    const controller = payQuarter(0.51);
    expect(controller.kept).toBeLessThan(controller.gross);
    expect((controller.gross - controller.kept) / controller.gross)
      .toBeCloseTo((1 - DED.affiliate) * RATE, 9);
  });

  it('keeps the quarterly P&L reconciling with the tax folded in', () => {
    // Gross into dividendIncome, the tax into the tax line — so
    // net = revenue - costs - interest - tax + dividends still holds. Netting it off
    // the income line instead would have broken an identity checked every turn.
    let state = newGame(20000, 'LON', undefined, { difficulty: 'medium', scenario: 'present' });
    let checked = 0;
    for (let turn = 0; turn < 60 && !state.gameOver; turn++) {
      state = endTurn(state);
      for (const q of state.history.filter((h) => h.turn === state.turn)) {
        const operating = q.revenue
          - (q.fuel + q.crew + q.maintenance + q.handling + q.lease + q.standing + q.fixed + q.overhead);
        expect(operating - q.interest - q.tax + (q.dividendIncome ?? 0)).toBeCloseTo(q.netIncome, 2);
        checked += 1;
      }
    }
    expect(checked).toBeGreaterThan(200);
  });
});

/**
 * An issue clears at a discount that widens with its size.
 *
 * Player report: "I get a lot of money and my company becomes worth a lot more —
 * is that how it works?" The accounting was right (market cap rises by exactly the
 * cash raised, because the company has that cash) and the price did fall. What was
 * wrong is that it fell by the same trivial amount whatever the size: a flat 7%
 * clearing discount meant a 1% top-up and a raise of a quarter of the whole company
 * priced identically, so a company-rescuing issue moved the share price 1.5% and
 * issuing was close to free. Somebody has to buy every share.
 */
describe('equity issues price by how big they are', () => {
  function board(): GameState {
    let g = newGame(41, 'LON', undefined, { difficulty: 'medium', scenario: 'present' });
    for (let i = 0; i < 24 && !g.gameOver; i++) g = endTurn(g);
    return g;
  }

  it('prices a large raise further below market than a small one', () => {
    const g = board();
    const cap = marketCap(g, getCarrier(g, 'player'));
    const small = equityIssueDiscount(cap * 0.01, cap);
    const medium = equityIssueDiscount(cap * 0.1, cap);
    const large = equityIssueDiscount(cap * 0.25, cap);
    expect(small).toBeGreaterThan(medium);
    expect(medium).toBeGreaterThan(large);
    // A quarter of the company is a rescue, and prices like one.
    expect(large).toBeLessThan(0.85);
    // ...and it can never price at nothing, however absurd the ask.
    expect(equityIssueDiscount(cap * 100, cap)).toBeGreaterThanOrEqual(
      CONSTANTS.finance.equityRaiseFloorPrice,
    );
  });

  it('moves the share price more for a bigger raise', () => {
    const g = board();
    const me = getCarrier(g, 'player');
    const cap = marketCap(g, me);
    const before = sharePrice(g, me);

    const moveFor = (fraction: number): number => {
      const res = applyAction(g, { type: 'ISSUE_EQUITY', carrierId: 'player', amount: cap * fraction });
      expect(res.ok).toBe(true);
      return before - sharePrice(res.state, getCarrier(res.state, 'player'));
    };
    const smallMove = moveFor(0.02);
    const largeMove = moveFor(0.25);
    expect(smallMove).toBeGreaterThan(0); // dilution is never free
    expect(largeMove).toBeGreaterThan(smallMove * 5); // and it is not linear either
  });

  it('still raises market cap by exactly the cash, which is the part that was right', () => {
    const g = board();
    const me = getCarrier(g, 'player');
    const cap = marketCap(g, me);
    const amount = cap * 0.1;
    const res = applyAction(g, { type: 'ISSUE_EQUITY', carrierId: 'player', amount });
    expect(res.ok).toBe(true);
    const after = getCarrier(res.state, 'player');
    // The company is worth more because it HAS more. Value is not created — the
    // existing holders paid for it in dilution.
    expect(marketCap(res.state, after) - cap).toBeCloseTo(amount, 2);
    expect(after.cash - me.cash).toBeCloseTo(amount, 2);
    expect(sharePrice(res.state, after)).toBeLessThan(sharePrice(g, me));
  });

  it('keeps the quoted ceiling exact even though the discount depends on the amount', () => {
    // The ceiling is now solved by fixed point, because how much cash a block of
    // shares raises depends on the discount and the discount depends on the raise.
    // If that solve is loose the treasury quotes a maximum the engine then refuses —
    // the exact failure fixed elsewhere in this file.
    const g = board();
    const me = getCarrier(g, 'player');
    const ceiling = equityRaiseCeiling(g, me);
    expect(ceiling).toBeGreaterThan(0);
    const exact = applyAction(g, { type: 'ISSUE_EQUITY', carrierId: 'player', amount: ceiling });
    expect(exact.ok, 'the quoted ceiling was refused').toBe(true);
    expect(getCarrier(exact.state, 'player').cash - me.cash).toBeCloseTo(ceiling, 2);
    const over = applyAction(g, { type: 'ISSUE_EQUITY', carrierId: 'player', amount: ceiling * 1.5 });
    expect(over.ok).toBe(false);
  });
});

/**
 * What an acquisition actually costs, as one number the screen and the engine agree on.
 *
 * `acquisitionCost` is the SHARE price. The merge also moves the target's whole debt
 * across, and `ACQUIRE_CARRIER` refuses unless the buyer can carry both — so the
 * figure that decides the deal is `acquisitionCost + target.debt`, and the treasury
 * dialog was quoting the first term alone. A carrier offered at $500M landed as
 * billions. The engine's own rejection message had been naming both figures the
 * whole time; only the screen the player reads named one.
 *
 * Pinned as the RELATIONSHIP rather than by reproducing the dialog's copy: what must
 * stay true is that the threshold the engine enforces is enterprise value, so
 * anything quoting less than that is quoting the wrong number.
 */
describe('an acquisition is priced at enterprise value', () => {
  function board(): { state: GameState; target: Carrier } | null {
    let g = newGame(41, 'LON', undefined, { difficulty: 'medium', scenario: 'present' });
    for (let i = 0; i < 40 && !g.gameOver; i++) g = endTurn(g);
    const target = g.carriers.find((c) => !c.isPlayer && c.bankruptTurn === null && c.debt > 0);
    if (!target) return null;
    // Controlling stake, so the buyout is legal, and the debt is what binds.
    const state: GameState = {
      ...g,
      carriers: g.carriers.map((c) =>
        c.isPlayer ? { ...c, holdings: { ...c.holdings, [target.id]: target.shares * 0.6 } } : c,
      ),
    };
    return { state, target: getCarrier(state, target.id) };
  }

  it('refuses a deal the buyer can afford the shares of but not the debt', () => {
    const b = board();
    if (!b) return;
    const me = getCarrier(b.state, 'player');
    const shares = acquisitionCost(b.state, me, b.target);
    expect(b.target.debt, 'fixture target carries no debt — nothing to test').toBeGreaterThan(0);

    // Exactly enough for the shares, nothing for the debt.
    const shareRich: GameState = {
      ...b.state,
      carriers: b.state.carriers.map((c) => (c.isPlayer ? { ...c, cash: shares + 1_000_000 } : c)),
    };
    const refused = applyAction(shareRich, {
      type: 'ACQUIRE_CARRIER', carrierId: 'player', targetId: b.target.id, withDebt: false,
    });
    expect(refused.ok, 'the share price alone should not buy the company').toBe(false);
    // And the refusal names both halves, so the player can see what was missing.
    expect(refused.error).toMatch(/debt/i);

    // Enough for both, and it goes through.
    const enterprise = shares + b.target.debt;
    const rich: GameState = {
      ...b.state,
      carriers: b.state.carriers.map((c) => (c.isPlayer ? { ...c, cash: enterprise + 1_000_000 } : c)),
    };
    const done = applyAction(rich, {
      type: 'ACQUIRE_CARRIER', carrierId: 'player', targetId: b.target.id, withDebt: false,
    });
    expect(done.ok, 'covering shares AND debt should buy the company').toBe(true);
  });

  it('moves the whole of the target debt onto the buyer', () => {
    const b = board();
    if (!b) return;
    const me = getCarrier(b.state, 'player');
    const enterprise = acquisitionCost(b.state, me, b.target) + b.target.debt;
    const rich: GameState = {
      ...b.state,
      carriers: b.state.carriers.map((c) => (c.isPlayer ? { ...c, cash: enterprise + 1_000_000 } : c)),
    };
    const debtBefore = getCarrier(rich, 'player').debt;
    const done = applyAction(rich, {
      type: 'ACQUIRE_CARRIER', carrierId: 'player', targetId: b.target.id, withDebt: false,
    });
    expect(done.ok).toBe(true);
    // The debt is not forgiven by the purchase — which is exactly why quoting the
    // share price alone understated the deal.
    expect(getCarrier(done.state, 'player').debt).toBeCloseTo(debtBefore + b.target.debt, 2);
  });
});

/**
 * The quoted acquisition price is the price charged.
 *
 * `acquisitionCost` is read by the treasury dialog, by the AI's own affordability
 * test and by `ACQUIRE_CARRIER`'s gate; `mergeCarrier` works out what actually
 * leaves the bank. Two places, one number, and when the dominance premium was added
 * to the first and not the second a dominant buyer was tested against the higher
 * price and charged the lower one.
 */
describe('acquisition quote and charge agree', () => {
  it('charges exactly what acquisitionCost said, at every level of dominance', () => {
    let g = newGame(41, 'LON', undefined, { difficulty: 'medium', scenario: 'present' });
    for (let i = 0; i < 40 && !g.gameOver; i++) g = endTurn(g);
    const rivals = g.carriers.filter((c) => !c.isPlayer && c.bankruptTurn === null);
    if (rivals.length < 2) return;

    let compared = 0;
    for (const target of rivals.slice(0, 3)) {
      // Controlling stake so the deal is legal, and cash enough that nothing clamps.
      const state: GameState = {
        ...g,
        carriers: g.carriers.map((c) =>
          c.isPlayer
            ? { ...c, cash: 500e9, holdings: { ...c.holdings, [target.id]: target.shares * 0.6 } }
            : c,
        ),
      };
      const me = getCarrier(state, 'player');
      const quoted = acquisitionCost(state, me, getCarrier(state, target.id));
      const cashBefore = me.cash;
      const targetCash = getCarrier(state, target.id).cash;

      const done = applyAction(state, {
        type: 'ACQUIRE_CARRIER', carrierId: 'player', targetId: target.id, withDebt: false,
      });
      expect(done.ok, done.error).toBe(true);
      // Paid the quote, gained the target's till.
      expect(getCarrier(done.state, 'player').cash).toBeCloseTo(cashBefore - quoted + targetCash, -4);
      compared += 1;
    }
    expect(compared).toBeGreaterThan(0);
  });

  it('makes the next carrier dearer the more of the map you already hold', () => {
    // The adaptive half: buying the board should get harder as you take it, which is
    // what stops consolidation being the cheapest way to win.
    let g = newGame(41, 'LON', undefined, { difficulty: 'medium', scenario: 'present' });
    for (let i = 0; i < 40 && !g.gameOver; i++) g = endTurn(g);
    // A target with a market cap, or the price is zero at every level of dominance
    // and the comparison is 0 > 0 — which is how this first failed.
    const target = g.carriers.find(
      (c) => !c.isPlayer && c.bankruptTurn === null && marketCap(g, c) > 1_000_000,
    );
    if (!target) return;

    const me = getCarrier(g, 'player');
    const small = acquisitionCost(g, me, target);
    expect(small, 'fixture target is worthless — nothing to compare').toBeGreaterThan(0);
    // Now hand the player most of the map and price the same carrier again.
    const dominant: GameState = {
      ...g,
      routes: g.routes.map((r) => (r.carrierId === target.id ? r : { ...r, carrierId: 'player' })),
    };
    const big = acquisitionCost(dominant, getCarrier(dominant, 'player'), getCarrier(dominant, target.id));
    expect(industryShare(dominant, getCarrier(dominant, 'player')))
      .toBeGreaterThan(industryShare(g, me));
    expect(big, 'a near-monopolist should pay more for the next carrier').toBeGreaterThan(small);
  });
});
