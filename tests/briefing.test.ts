/**
 * The quarterly board briefing — the diff of what changed while the books closed.
 * The alerts are the part that matters: a loss condition must telegraph, so the
 * takeover-exposure warning is what these tests defend.
 */
import { describe, expect, it } from 'vitest';
import { getCarrier, newGame } from '../src/sim/engine.ts';
import { CONSTANTS } from '../src/sim/world.ts';
import { stake } from '../src/ui/format.ts';
import { buildBriefing } from '../src/ui/briefing.ts';
import type { GameState, QuarterResult } from '../src/sim/types.ts';

const FIN = CONSTANTS.finance;

const quarter = (turn: number, netIncome: number): QuarterResult => ({
  turn, carrierId: 'player', revenue: 0, fuel: 0, crew: 0, maintenance: 0, handling: 0,
  lease: 0, standing: 0, fixed: 0, overhead: 0, interest: 0, tax: 0, netIncome, cashAfter: 0,
});

/** A player whose share price has collapsed from a real peak and who is losing
 *  money — the state that should draw a takeover warning. */
function distressed(): { prev: GameState; next: GameState } {
  const base = newGame(1, 'LON');
  const year = CONSTANTS.game.quartersPerYear;
  const losing = Array.from({ length: year }, (_, i) => quarter(i + 1, -10_000_000));
  const next: GameState = {
    ...base,
    turn: FIN.hostileGraceTurns + 2,
    playerPeakEquity: 1_000_000_000,
    carriers: base.carriers.map((c) => (c.isPlayer ? { ...c, cash: 0, debt: 1_000_000_000 } : c)),
    history: losing,
  };
  return { prev: base, next };
}

describe('the board briefing alerts', () => {
  it('warns when the player is exposed to a hostile takeover', () => {
    const { prev, next } = distressed();
    const b = buildBriefing(prev, next);
    expect(b.alerts.some((a) => a.tone === 'danger' && /hostile takeover/i.test(a.text))).toBe(true);
  });

  it('does not cry takeover on a healthy carrier', () => {
    const base = newGame(1, 'LON');
    const next: GameState = { ...base, turn: 40, history: [quarter(40, 5_000_000)] };
    const b = buildBriefing(base, next);
    expect(b.alerts.some((a) => /hostile takeover/i.test(a.text))).toBe(false);
  });

  it('flags a credit-rating downgrade', () => {
    const base = newGame(1, 'LON');
    // Load the balance sheet with debt so the rating drops between the two states.
    const prev: GameState = { ...base, carriers: base.carriers.map((c) => (c.isPlayer ? { ...c, cash: 200_000_000, debt: 0 } : c)) };
    const next: GameState = {
      ...base,
      turn: 5,
      history: [quarter(5, -1_000_000)],
      carriers: base.carriers.map((c) => (c.isPlayer ? { ...c, cash: 20_000_000, debt: 400_000_000 } : c)),
    };
    const b = buildBriefing(prev, next);
    expect(b.alerts.some((a) => /credit rating cut/i.test(a.text))).toBe(true);
  });
});

describe('the board briefing narrates the quarter', () => {
  it('reports the net headline and the largest cost', () => {
    const base = newGame(1, 'LON');
    const last: QuarterResult = { ...quarter(3, -379_000), revenue: 0, lease: 300_000 };
    const next: GameState = { ...base, turn: 3, history: [last] };
    const b = buildBriefing(base, next);
    expect(b.headline).toMatch(/net/i);
    expect(b.headlineNegative).toBe(true);
    expect(b.quarter.join(' ')).toMatch(/leases/i);
  });

  it('splits the headline into a static label and a flappable figure', () => {
    const base = newGame(1, 'LON');
    const next: GameState = { ...base, turn: 3, history: [quarter(3, 2_400_000)] };
    const b = buildBriefing(base, next);
    expect(b.headlineLabel).toBe('Quarterly net');
    expect(b.headlineValue).toMatch(/\$/); // a money figure, the part that flaps
    expect(b.headline).toBe(`${b.headlineLabel} ${b.headlineValue}`);
    expect(b.headlineNegative).toBe(false);
  });

  it('leaves nothing to flap before the first quarter is flown', () => {
    const base = newGame(1, 'LON');
    const b = buildBriefing(base, base);
    expect(b.headlineValue).toBe('');
    expect(b.headlineLabel).toBe('No quarter flown yet');
  });

  it('reports a rival that failed and one that entered', () => {
    const base = newGame(1, 'LON');
    // prev has an extra rival that is solvent; next has it bankrupt, plus a newcomer.
    const rivalAlive = { ...base.carriers[0]!, id: 'r1', name: 'Doomed Air', isPlayer: false, bankruptTurn: null, archetypeId: 'ulcc' };
    const rivalDead = { ...rivalAlive, bankruptTurn: 6, acquiredBy: null };
    const newcomer = { ...rivalAlive, id: 'r2', name: 'Fresh Air' };
    const prev: GameState = { ...base, carriers: [...base.carriers, rivalAlive] };
    const next: GameState = {
      ...base,
      turn: 6,
      history: [quarter(6, 1_000_000)],
      carriers: [...base.carriers, rivalDead, newcomer],
    };
    const b = buildBriefing(prev, next);
    expect(b.board.some((l) => /Doomed Air went bankrupt/i.test(l))).toBe(true);
    expect(b.board.some((l) => /Fresh Air entered/i.test(l))).toBe(true);
  });

  it('reports a world event with what it does and how long it lasts', () => {
    // The deck carries a blurb and the actual multipliers for every card, and the
    // briefing used to print only "Oil spike has begun." — no consequence, no
    // duration, and less information than the fuel line two rows below it.
    const base = newGame(1, 'LON');
    const prev: GameState = { ...base, events: [] };
    const next: GameState = {
      ...base,
      turn: 4,
      history: [quarter(4, 0)],
      events: [{ source: 'oil-spike', kind: 'event', until: 8, effects: { fuelPrice: 1.4 } }],
    };
    const b = buildBriefing(prev, next);
    const line = b.world.find((l) => /oil spike/i.test(l));
    expect(line).toBeDefined();
    expect(line).toMatch(/fuel prices up 40%/i);
    expect(line).toMatch(/for 4 quarters/i);
    // And it must read as prose: no lowercase fragment after a full stop, which
    // is what running the blurb straight into the effects produced.
    expect(line).not.toMatch(/\.\s+[a-z]/);
  });

  it('puts a crisis in the alerts, not five lines down the page', () => {
    // The four cards the deck marks `crisis` are the quarters that decide games.
    // As a bullet under "The world" they sat below routine revenue and rival
    // chatter — 5+ lines down on 28% of the quarters they fired.
    const base = newGame(1, 'LON');
    const prev: GameState = { ...base, events: [] };
    const next: GameState = {
      ...base,
      turn: 13,
      history: [quarter(13, 0)],
      events: [{ source: 'pandemic', kind: 'event', until: 20, effects: { demand: 0.42, fare: 0.85 } }],
    };
    const b = buildBriefing(prev, next);
    expect(b.world.some((l) => /pandemic/i.test(l))).toBe(false);
    const alert = b.alerts.find((a) => /pandemic/i.test(a.text));
    expect(alert).toBeDefined();
    expect(alert!.text).toMatch(/demand down 58%/i);
    // Warn, not danger: the danger tone sounds an alarm and is reserved for a
    // game actually ending. A crisis every few years would make that furniture.
    expect(alert!.tone).toBe('warn');
  });

  it('leaves a non-crisis event in the world section', () => {
    const base = newGame(1, 'LON');
    const prev: GameState = { ...base, events: [] };
    const next: GameState = {
      ...base,
      turn: 6,
      history: [quarter(6, 0)],
      events: [{ source: 'oil-spike', kind: 'event', until: 10, effects: { fuelPrice: 1.4 } }],
    };
    const b = buildBriefing(prev, next);
    expect(b.alerts.some((a) => /oil spike/i.test(a.text))).toBe(false);
    expect(b.world.some((l) => /oil spike/i.test(l))).toBe(true);
  });

  it('reports a rival issuing stock — evasive action against a raid', () => {
    const base = newGame(1, 'LON');
    const rival = { ...base.carriers[0]!, id: 'r1', name: 'Fortress Air', isPlayer: false, archetypeId: 'legacy' };
    const prev: GameState = { ...base, carriers: [...base.carriers, rival] };
    // Same rival, ~25% more shares next quarter — a defensive equity issue.
    const next: GameState = {
      ...base,
      turn: 6,
      history: [quarter(6, 0)],
      carriers: [...base.carriers, { ...rival, shares: rival.shares * 1.25 }],
    };
    const b = buildBriefing(prev, next);
    expect(b.markets.some((l) => /Fortress Air issued new stock/i.test(l))).toBe(true);
  });

  it('flags when the dilution is aimed at the player\'s own raid', () => {
    const base = newGame(1, 'LON');
    const rival = { ...base.carriers[0]!, id: 'r1', name: 'Fortress Air', isPlayer: false, archetypeId: 'legacy' };
    const withStake = (c: typeof base.carriers[0]) =>
      c.isPlayer ? { ...c, holdings: { r1: rival.shares * 0.45 } } : c;
    const prev: GameState = { ...base, carriers: [...base.carriers.map(withStake), rival] };
    const next: GameState = {
      ...base,
      turn: 6,
      history: [quarter(6, 0)],
      carriers: [...base.carriers.map(withStake), { ...rival, shares: rival.shares * 1.25 }],
    };
    const b = buildBriefing(prev, next);
    expect(b.markets.some((l) => /diluting your stake/i.test(l))).toBe(true);
  });

  it('says so, loudly, when the state has bailed you out', () => {
    /*
     * Reported as a bug: "I keep losing money but my cash never goes under $30
     * million." It was the bailout — the settlement lifted cash to the cushion and
     * booked the difference as debt, and told the player nothing at all. A rescue
     * that looks identical to a broken number is worse than no rescue.
     */
    const before = newGame(4, 'LON');
    const me = getCarrier(before, before.playerCarrierId);
    const after: GameState = {
      ...before,
      turn: before.turn + 1,
      carriers: before.carriers.map((c) =>
        c.isPlayer ? { ...c, cash: 30_000_000, debt: 44_000_000, bailouts: 1 } : c,
      ),
      history: [
        ...before.history,
        {
          turn: before.turn + 1, carrierId: me.id, revenue: 0, fuel: 0, crew: 0,
          maintenance: 0, handling: 0, lease: -9_000_000, standing: 0, fixed: 0,
          overhead: 0, interest: 0, tax: 0, netIncome: -9_000_000,
          cashAfter: 30_000_000, bailout: 44_000_000,
        },
      ],
    };
    const b = buildBriefing(before, after);
    const alert = b.alerts.find((a) => /state stepped in/i.test(a.text));
    expect(alert, 'a bailout must raise an alert').toBeDefined();
    expect(alert?.tone).toBe('danger');
    // It has to name the money and what is left, or it is just a mood.
    expect(alert?.text).toMatch(/\$44\.0M/);
    expect(alert?.text).toMatch(/rescue/i);
  });
});

describe('the share register is reported in both directions', () => {
  it('says so when a big holder of your stock loses it', () => {
    // Accumulation was telegraphed quarter by quarter and the unwinding was
    // silent: a rival could hold a majority of the player, collapse, have the
    // whole position liquidated back into the float, and the briefing said only
    // "X went bankrupt" — nothing about the ownership of the player's own company
    // changing hands, which is the largest thing that can happen to a register.
    const base = newGame(1, 'LON');
    const me = base.carriers.find((c) => c.isPlayer)!;
    const holder = {
      ...me, id: 'H', name: 'Raider', isPlayer: false, archetypeId: 'rollup',
      holdings: { [me.id]: me.shares * 0.45 }, bankruptTurn: null,
    };
    const prev: GameState = { ...base, turn: 40, carriers: [me, holder] };
    const next: GameState = {
      ...base, turn: 41, history: [quarter(41, 0)],
      carriers: [me, { ...holder, holdings: {}, bankruptTurn: 41 }],
    };
    const b = buildBriefing(prev, next);
    const alert = b.alerts.find((a) => /Raider/.test(a.text));
    expect(alert).toBeDefined();
    expect(alert!.text).toMatch(/45% of you/);
    expect(alert!.text).toMatch(/open market/i);
  });

  it('reports a holder merely selling down, without crying collapse', () => {
    const base = newGame(1, 'LON');
    const me = base.carriers.find((c) => c.isPlayer)!;
    const holder = {
      ...me, id: 'H', name: 'Quiet Air', isPlayer: false, archetypeId: 'ulcc',
      holdings: { [me.id]: me.shares * 0.3 }, bankruptTurn: null,
    };
    const prev: GameState = { ...base, turn: 40, carriers: [me, holder] };
    const next: GameState = {
      ...base, turn: 41, history: [quarter(41, 0)],
      carriers: [me, { ...holder, holdings: { [me.id]: me.shares * 0.12 } }],
    };
    const b = buildBriefing(prev, next);
    expect(b.alerts.some((a) => /Quiet Air/.test(a.text))).toBe(false);
    expect(b.markets.some((l) => /Quiet Air cut its stake in you from 30% to 12%/.test(l))).toBe(true);
  });
});

describe('a shareholding is never rounded away to nothing', () => {
  it('shows a small stake as a small stake, not as zero', () => {
    // The treasury listed "Halyard Group 0%" beside a Buy out button, which reads
    // as a phantom entry. It was not: a rival taking a modest speculative position
    // in a large carrier genuinely lands under half a percent, and whole-percent
    // rounding erased it. Accumulation is most worth seeing while it is small.
    expect(stake(0.004)).toBe('0.4%');
    expect(stake(0.0083)).toBe('0.8%');
    expect(stake(0.0003)).toBe('<0.1%');
    // Only a genuinely empty holding reads as zero.
    expect(stake(0)).toBe('0%');
    // And it still rounds cleanly once the stake is worth rounding.
    expect(stake(0.253)).toBe('25%');
    expect(stake(0.6)).toBe('60%');
  });

  it('reports an accumulating rival at its real size', () => {
    const base = newGame(1, 'LON');
    const me = base.carriers.find((c) => c.isPlayer)!;
    const rival = {
      ...me, id: 'H', name: 'Halyard Group', isPlayer: false, archetypeId: 'ulcc',
      holdings: {}, bankruptTurn: null,
    };
    const prev: GameState = { ...base, turn: 20, carriers: [me, rival] };
    const next: GameState = {
      ...base, turn: 21, history: [quarter(21, 0)],
      carriers: [me, { ...rival, holdings: { [me.id]: me.shares * 0.106 } }],
    };
    const b = buildBriefing(prev, next);
    const alert = b.alerts.find((a) => /Halyard/.test(a.text));
    expect(alert).toBeDefined();
    expect(alert!.text).toMatch(/11%/);
    expect(alert!.text).not.toMatch(/0%/);
  });
});
