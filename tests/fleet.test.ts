import { describe, expect, it } from 'vitest';
import {
  AIRCRAFT_TYPES,
  ageYears,
  canReach,
  getAircraftType,
  hasAircraftType,
  leaseBreakFee,
  legBlockHours,
  maintenancePerBlockHour,
  overhaulCost,
  rotationsPerWeek,
  makerCostMultiplier,
  preferredMaker,
  roundTripHours,
  validateAircraftType,
} from '../src/sim/fleet.ts';
import { applyAction, endTurn, getCarrier, newGame } from '../src/sim/engine.ts';
import { CONSTANTS } from '../src/sim/world.ts';
import { conditionsFor } from '../src/sim/conditions.ts';
import type { Aircraft } from '../src/sim/types.ts';

const tail = (typeId: string, acquiredTurn = 0): Aircraft => ({
  id: 't', typeId, ownership: 'leased', acquiredTurn, deliversTurn: 0, bookValue: 0, routeId: null,
});

describe('aircraft.json', () => {
  it('offers a full ladder of gauges', () => {
    expect(AIRCRAFT_TYPES.length).toBeGreaterThanOrEqual(12);
    const seats = AIRCRAFT_TYPES.map((t) => t.seats);
    expect(Math.min(...seats)).toBeLessThan(60);
    expect(Math.max(...seats)).toBeGreaterThan(400);
  });

  it('has unique ids and names', () => {
    expect(new Set(AIRCRAFT_TYPES.map((t) => t.id)).size).toBe(AIRCRAFT_TYPES.length);
    expect(new Set(AIRCRAFT_TYPES.map((t) => t.name)).size).toBe(AIRCRAFT_TYPES.length);
  });

  it('keeps every figure positive and plausible', () => {
    for (const t of AIRCRAFT_TYPES) {
      expect(t.seats, t.id).toBeGreaterThan(0);
      expect(t.rangeKm, t.id).toBeGreaterThan(500);
      expect(t.cruiseKmh, t.id).toBeGreaterThan(300);
      expect(t.price, t.id).toBeGreaterThan(0);
      expect(t.leaseMonthly, t.id).toBeGreaterThan(0);
      expect(t.fuelBurnLPerKm, t.id).toBeGreaterThan(0);
      expect(t.crewPerBlockHour, t.id).toBeGreaterThan(0);
      // A month's lease should never approach the purchase price.
      expect(t.leaseMonthly * 12, t.id).toBeLessThan(t.price);
    }
  });

  it('makes bigger aircraft more fuel-efficient per seat', () => {
    // The whole gauge decision rests on this: big jets burn more per km but less
    // per seat-km, so they only pay off when you can fill them.
    const small = getAircraftType('CIRRO70');
    const large = getAircraftType('AROSN3');
    expect(large.fuelBurnLPerKm).toBeGreaterThan(small.fuelBurnLPerKm);
    expect(large.fuelBurnLPerKm / large.seats).toBeLessThan(small.fuelBurnLPerKm / small.seats);
  });

  it('rejects unknown types and finds known ones', () => {
    expect(hasAircraftType('AROSN2')).toBe(true);
    expect(hasAircraftType('NOPE')).toBe(false);
    expect(() => getAircraftType('NOPE')).toThrow(/Unknown aircraft type/);
  });
});

describe('frequency derivation', () => {
  it('refuses sectors beyond range', () => {
    const type = getAircraftType('TARN42');
    expect(canReach(type, type.rangeKm - 1)).toBe(true);
    expect(canReach(type, type.rangeKm + 1)).toBe(false);
    expect(rotationsPerWeek(type, type.rangeKm + 1)).toBe(0);
  });

  it('flies more rotations on shorter sectors', () => {
    const type = getAircraftType('AROSN2');
    expect(rotationsPerWeek(type, 500)).toBeGreaterThan(rotationsPerWeek(type, 2000));
  });

  it('never exceeds the utilization budget', () => {
    const weekly = CONSTANTS.fleet.utilizationHoursPerDay * 7;
    for (const type of AIRCRAFT_TYPES) {
      for (const dist of [400, 1500, 5000]) {
        if (!canReach(type, dist)) continue;
        const hours = rotationsPerWeek(type, dist) * roundTripHours(type, dist);
        expect(hours, `${type.id} @ ${dist}km`).toBeCloseTo(weekly, 6);
      }
    }
  });

  it('adds ground overhead to every leg', () => {
    const type = getAircraftType('AROSN2');
    expect(legBlockHours(type, 870)).toBeCloseTo(1 + CONSTANTS.fleet.blockPadHoursPerLeg, 6);
  });
});

describe('aging', () => {
  it('measures age in years from the acquisition turn', () => {
    const perYear = CONSTANTS.game.quartersPerYear;
    expect(ageYears(tail('AROSN2', 0), 0)).toBe(0);
    expect(ageYears(tail('AROSN2', 0), perYear)).toBe(1);
    // A tail acquired in the future is not negatively aged.
    expect(ageYears(tail('AROSN2', 10), 2)).toBe(0);
  });

  it('makes maintenance rise with age', () => {
    const type = getAircraftType('AROSN2');
    expect(maintenancePerBlockHour(type, 0)).toBe(type.maintPerBlockHour);
    expect(maintenancePerBlockHour(type, 10)).toBeGreaterThan(maintenancePerBlockHour(type, 0));
  });
});

describe('the maintenance curve', () => {
  it('saturates rather than rising for ever', () => {
    // A straight line here bankrupts any carrier that holds a fleet two
    // decades, no matter how well the network is run.
    const type = getAircraftType('AROSN3');
    const at = (y: number) => maintenancePerBlockHour(type, y);
    expect(at(10) - at(5)).toBeLessThan(at(5) - at(0));
    expect(at(25) - at(20)).toBeLessThan(at(10) - at(5));
    expect(at(40) / type.maintPerBlockHour).toBeLessThan(2.5);
  });

  it('still makes age hurt', () => {
    const type = getAircraftType('AROSN3');
    expect(maintenancePerBlockHour(type, 15)).toBeGreaterThan(
      maintenancePerBlockHour(type, 0) * 1.4,
    );
  });

  it('counts from the last overhaul, not acquisition', () => {
    const old = { ...tail('AROSN3', 0), overhauledTurn: 40 };
    expect(ageYears(old, 60)).toBe(5);
    expect(ageYears(tail('AROSN3', 0), 60)).toBe(15);
  });
});

describe('lease terms', () => {
  const type = getAircraftType('AROSN3');
  const perYear = CONSTANTS.game.quartersPerYear;

  it('charges nothing once the term is served', () => {
    const term = CONSTANTS.fleet.leaseTermYears * perYear;
    expect(leaseBreakFee(type, 0, term)).toBe(0);
    expect(leaseBreakFee(type, 0, term + 20)).toBe(0);
  });

  it('charges more the earlier the aircraft goes back', () => {
    expect(leaseBreakFee(type, 0, 0)).toBeGreaterThan(leaseBreakFee(type, 0, 4 * perYear));
    expect(leaseBreakFee(type, 0, 4 * perYear)).toBeGreaterThan(0);
  });

  it('makes churning to a fresh airframe cost real money', () => {
    // Without a term, resetting an airframe's age costs only the deposit and
    // leasing strictly dominates owning.
    const deposit = type.leaseMonthly * CONSTANTS.fleet.leaseDepositMonths;
    expect(leaseBreakFee(type, 0, perYear)).toBeGreaterThan(deposit * 5);
  });
});

describe('overhaul pricing', () => {
  it('costs a meaningful slice of list price, but far less than replacing', () => {
    for (const type of AIRCRAFT_TYPES) {
      const cost = overhaulCost(type);
      expect(cost, type.id).toBeGreaterThan(0);
      expect(cost, type.id).toBeLessThan(type.price / 2);
    }
  });

  it('refuses a second visit on an airframe with nothing left to reset', () => {
    // The clock is already at zero, so another visit buys nothing at all — and it
    // was charging full price for it, once per tail on a grouped fleet button.
    let state = newGame(42, 'NYC');
    state = applyAction(state, {
      type: 'ACQUIRE_AIRCRAFT', carrierId: 'player', typeId: 'VANTA5', ownership: 'owned',
    }).state;
    const tailId = getCarrier(state, 'player').fleet[0]!.id;
    for (let i = 0; i < 12; i++) state = endTurn(state);

    const aged = getCarrier(state, 'player').fleet[0]!;
    expect(ageYears(aged, state.turn)).toBeGreaterThan(0);

    const first = applyAction(state, { type: 'OVERHAUL_AIRCRAFT', carrierId: 'player', tailId });
    expect(first.ok).toBe(true);
    state = first.state;
    const afterFirst = getCarrier(state, 'player').cash;
    expect(ageYears(getCarrier(state, 'player').fleet[0]!, state.turn)).toBe(0);

    const second = applyAction(state, { type: 'OVERHAUL_AIRCRAFT', carrierId: 'player', tailId });
    expect(second.ok).toBe(false);
    expect(second.error).toMatch(/nothing to reset/i);
    expect(getCarrier(second.state, 'player').cash).toBe(afterFirst);
  });

  it('allows one again once the airframe has aged', () => {
    let state = newGame(42, 'NYC');
    state = applyAction(state, {
      type: 'ACQUIRE_AIRCRAFT', carrierId: 'player', typeId: 'VANTA5', ownership: 'owned',
    }).state;
    const tailId = getCarrier(state, 'player').fleet[0]!.id;
    for (let i = 0; i < 12; i++) state = endTurn(state);
    state = applyAction(state, { type: 'OVERHAUL_AIRCRAFT', carrierId: 'player', tailId }).state;

    state = endTurn(state); // one quarter of airframe time is enough to earn a visit
    expect(applyAction(state, { type: 'OVERHAUL_AIRCRAFT', carrierId: 'player', tailId }).ok).toBe(true);
  });
});

describe('the aircraft roster is internally coherent', () => {
  // The roster is declared balance surface in its own _meta, and for a long time
  // "is it a finite number" was all that was ever checked. That is how a whole
  // class of aircraft can quietly become unbuyable: every field looks defensible
  // on its own, and nothing compares any field to any other.

  it('keeps every type inside a physically possible fuel efficiency', () => {
    // Published figures run about 2.0 (A321neo) to 3.4 (747-400) litres per 100
    // available seat-km. A type outside a generous band around that is a typo —
    // a misplaced decimal or a seat count that no longer matches the burn.
    for (const t of AIRCRAFT_TYPES) {
      const perHundredSeatKm = (100 * t.fuelBurnLPerKm) / t.seats;
      expect(perHundredSeatKm, `${t.id} (${t.basis})`).toBeGreaterThan(1);
      expect(perHundredSeatKm, `${t.id} (${t.basis})`).toBeLessThan(6);
    }
  });

  it('has no type that another of its era beats on every axis', () => {
    // Dead content: if something available at the same time is at least as good
    // everywhere and better somewhere, nobody would ever buy this.
    const dominated: string[] = [];
    for (const a of AIRCRAFT_TYPES) {
      for (const b of AIRCRAFT_TYPES) {
        if (a.id === b.id || b.introYear > a.introYear) continue;
        const weaklyBetter =
          b.seats >= a.seats && b.rangeKm >= a.rangeKm && b.cruiseKmh >= a.cruiseKmh &&
          b.turnaroundMin <= a.turnaroundMin && b.price <= a.price &&
          b.leaseMonthly <= a.leaseMonthly && b.fuelBurnLPerKm <= a.fuelBurnLPerKm &&
          b.maintPerBlockHour <= a.maintPerBlockHour && b.crewPerBlockHour <= a.crewPerBlockHour;
        const strictlyBetter =
          b.seats > a.seats || b.rangeKm > a.rangeKm || b.price < a.price ||
          b.fuelBurnLPerKm < a.fuelBurnLPerKm || b.leaseMonthly < a.leaseMonthly;
        if (weaklyBetter && strictlyBetter) dominated.push(`${a.id} dominated by ${b.id}`);
      }
    }
    expect(dominated).toEqual([]);
  });

  it('rejects an aircraft that cannot exist, rather than flying it', () => {
    // The guard that matters is the CROSS-FIELD one: seats and fuel burn are only
    // meaningful together, and each looks fine alone.
    const sane = {
      id: 'TEST', name: 'Test', maker: 'T', klass: 'Narrowbody', basis: 'test',
      seats: 180, rangeKm: 6000, cruiseKmh: 870, turnaroundMin: 40, price: 5e7,
      leaseMonthly: 4e5, fuelBurnLPerKm: 4, maintPerBlockHour: 800, maintAgeSlope: 90,
      crewPerBlockHour: 1300, introYear: 2016, introVariabilityYears: 0,
    };
    const load = (patch: Record<string, unknown>): void => {
      validateAircraftType({ ...sane, ...patch }, 0);
    };
    expect(() => load({})).not.toThrow();
    // A 180-seat jet sipping 0.4 L/km would be four times better than anything
    // ever built, and every individual field here is a perfectly ordinary number.
    expect(() => load({ fuelBurnLPerKm: 0.4 })).toThrow(/seat-km/);
    expect(() => load({ seats: 900, fuelBurnLPerKm: 4 })).toThrow(/seat-km/);
    expect(() => load({ seats: 3 })).toThrow(/plausible range/);
    expect(() => load({ cruiseKmh: 87 })).toThrow(/plausible range/);
    expect(() => load({ klass: 'Spaceplane' })).toThrow(/klass/);
  });
});

describe('the roster matches the aircraft it says it is modelled on', () => {
  /*
   * Published hard specs for each `basis`. Seats are a cabin-layout choice, so
   * they are a band (typical two-class to dense single-class); range and entry
   * into service are facts. Cruise carries a loose tolerance on purpose: most
   * types quote both a typical and a maximum cruise (the A320 family is M0.78
   * against M0.82) and this file uses the high end.
   *
   * This table is the whole point. `aircraft.json` calls itself balance surface,
   * and it is — but `basis` is a factual claim, and a claim nobody ever checked
   * is how a regional jet ended up with 100 seats and 3,800 km when the aircraft
   * named in its own data has 120-146 seats and 4,917 km. Cost figures are
   * deliberately NOT pinned here; those are balance. Geometry is not.
   */
  const PUBLISHED: Record<string, {
    seats: readonly [number, number]; rangeKm: number; cruiseKmh: number; eis: number;
  }> = {
    'A220-100':  { seats: [100, 135], rangeKm: 6390,  cruiseKmh: 871, eis: 2016 },
    'A319neo':   { seats: [140, 160], rangeKm: 6950,  cruiseKmh: 871, eis: 2019 },
    'MD-80':     { seats: [140, 172], rangeKm: 4635,  cruiseKmh: 811, eis: 1980 },
    'A220-300':  { seats: [130, 160], rangeKm: 6700,  cruiseKmh: 871, eis: 2016 },
    'A320ceo':   { seats: [150, 180], rangeKm: 6100,  cruiseKmh: 828, eis: 1988 },
    '737 MAX 8': { seats: [162, 178], rangeKm: 6570,  cruiseKmh: 839, eis: 2017 },
    'A320neo':   { seats: [165, 180], rangeKm: 6500,  cruiseKmh: 828, eis: 2016 },
    '757-200':   { seats: [200, 239], rangeKm: 7222,  cruiseKmh: 850, eis: 1983 },
    'A321neo':   { seats: [180, 220], rangeKm: 7400,  cruiseKmh: 828, eis: 2017 },
    'E175':      { seats: [76, 88],   rangeKm: 3706,  cruiseKmh: 870, eis: 2005 },
    'E195-E2':   { seats: [120, 146], rangeKm: 4917,  cruiseKmh: 870, eis: 2019 },
    'ATR 42':    { seats: [48, 50],   rangeKm: 1326,  cruiseKmh: 556, eis: 1985 },
    'ATR 72':    { seats: [70, 78],   rangeKm: 1528,  cruiseKmh: 511, eis: 1989 },
    '767-300ER': { seats: [218, 269], rangeKm: 11070, cruiseKmh: 851, eis: 1988 },
    '787-9':     { seats: [290, 296], rangeKm: 14140, cruiseKmh: 903, eis: 2014 },
    'A330-300':  { seats: [277, 300], rangeKm: 11750, cruiseKmh: 871, eis: 1994 },
    'A350-900':  { seats: [300, 350], rangeKm: 15000, cruiseKmh: 903, eis: 2015 },
    '777-300ER': { seats: [365, 396], rangeKm: 13650, cruiseKmh: 892, eis: 2004 },
    '747-400':   { seats: [410, 524], rangeKm: 13450, cruiseKmh: 913, eis: 1989 },
    'A380':      { seats: [471, 575], rangeKm: 15200, cruiseKmh: 903, eis: 2007 },
  };

  it('covers every type modelled on a real aircraft', () => {
    // A fictional type has no published spec to check, and says so in `basis`.
    const unchecked = AIRCRAFT_TYPES
      .filter((t) => !PUBLISHED[t.basis] && !t.basis.includes('fictional'))
      .map((t) => `${t.id} (${t.basis})`);
    expect(unchecked, 'add these to PUBLISHED or mark the basis fictional').toEqual([]);
  });

  it('carries the seat count, range and launch date of its basis', () => {
    for (const t of AIRCRAFT_TYPES) {
      const ref = PUBLISHED[t.basis];
      if (!ref) continue;
      const where = `${t.id} (${t.basis})`;
      expect(t.seats, `${where} seats`).toBeGreaterThanOrEqual(ref.seats[0]);
      expect(t.seats, `${where} seats`).toBeLessThanOrEqual(ref.seats[1]);
      expect(Math.abs(t.rangeKm - ref.rangeKm) / ref.rangeKm, `${where} range`).toBeLessThan(0.08);
      expect(Math.abs(t.cruiseKmh - ref.cruiseKmh) / ref.cruiseKmh, `${where} cruise`).toBeLessThan(0.1);
      expect(t.introYear, `${where} entry into service`).toBe(ref.eis);
    }
  });
});

describe('carriers are built around a manufacturer', () => {
  it('splits the field between the two full-line makers', () => {
    // Derived from seed and carrier id rather than stored, so it needs no save
    // migration. A first attempt seeded a PRNG with a weak mix of the two and took
    // one draw, which handed every rival in a game the same manufacturer — ids
    // differ by a character and that does not decorrelate.
    let aros = 0;
    let total = 0;
    for (let seed = 0; seed < 200; seed++) {
      for (const id of ['r1', 'r2', 'r3', 'r4', 'r5', 'r6']) {
        if (preferredMaker(seed, id) === 'Aros') aros += 1;
        total += 1;
      }
    }
    expect(aros / total).toBeGreaterThan(0.4);
    expect(aros / total).toBeLessThan(0.6);
  });

  it('is stable for a given seed and carrier', () => {
    expect(preferredMaker(7, 'r3')).toBe(preferredMaker(7, 'r3'));
    // ...and actually varies with both inputs.
    const bySeed = new Set([1, 2, 3, 4, 5, 6].map((s) => preferredMaker(s, 'r1')));
    const byCarrier = new Set(['a', 'b', 'c', 'd', 'e', 'f'].map((c) => preferredMaker(3, c)));
    expect(bySeed.size).toBe(2);
    expect(byCarrier.size).toBe(2);
  });

  it('charges more to fly outside the shop, and only for the full-line makers', () => {
    const aros = getAircraftType('AROSN4');
    const vanta = getAircraftType('VANTA11');
    const niche = getAircraftType('BOREAL300');
    expect(makerCostMultiplier(aros, 'Aros')).toBe(1);
    expect(makerCostMultiplier(aros, 'Vanta')).toBeGreaterThan(1);
    expect(makerCostMultiplier(vanta, 'Vanta')).toBe(1);
    // A niche builder is bought for a job nobody else covers — no commonality to
    // lose, so no penalty either way.
    expect(makerCostMultiplier(niche, 'Aros')).toBe(1);
    expect(makerCostMultiplier(niche, 'Vanta')).toBe(1);
    // And no preference at all costs nothing: this must never touch the player.
    expect(makerCostMultiplier(aros, null)).toBe(1);
  });

  it('gives both full-line makers a comparable next-generation narrowbody', () => {
    // The roster had a hole: Aros had the next-gen single-aisle and Vanta did not,
    // so after it launched there was no modern narrowbody but Aros's and every
    // carrier had to buy it. Measured, it was 53.5% of all aircraft-quarters.
    const a = getAircraftType('AROSN4');
    const v = getAircraftType('VANTA11');
    const perSeat = (t: typeof a): number => (100 * t.fuelBurnLPerKm) / t.seats;
    expect(Math.abs(perSeat(a) - perSeat(v)) / perSeat(a)).toBeLessThan(0.1);
    expect(Math.abs(a.seats - v.seats) / a.seats).toBeLessThan(0.1);
    // Peers, not clones: each has to be better at something or the choice is a
    // coin flip dressed up as a decision.
    expect(v.rangeKm).toBeGreaterThan(a.rangeKm);
    expect(perSeat(v)).toBeGreaterThan(perSeat(a));
  });
});

describe('the manufacturer preference reaches rivals and not the player', () => {
  it('gives a rival a shop and leaves the player without one', () => {
    // The unit test above checks `makerCostMultiplier` with a null preference and
    // passes whatever `conditionsFor` actually hands it — which for a long time
    // was a real manufacturer for the PLAYER too, an invisible 8% surcharge on
    // crew and maintenance for half the aircraft market, unchosen and unfindable.
    // This checks the integration, which is where the defect lived.
    let game = newGame(5, 'LON');
    for (let i = 0; i < 30; i++) game = endTurn(game);
    const route = {
      id: 'r', carrierId: 'player', from: 'LON', to: 'NYC',
      posture: 'match' as const, openedTurn: 0,
    };
    const me = getCarrier(game, game.playerCarrierId);
    const mine = conditionsFor(game, me, route, new Set(['Narrowbody']));
    expect(mine.preferredMaker, 'the player must have no shop').toBeNull();
    for (const type of AIRCRAFT_TYPES) {
      expect(makerCostMultiplier(type, mine.preferredMaker), `${type.id} costs the player extra`).toBe(1);
    }
    const rivals = game.carriers.filter((c) => !c.isPlayer && c.bankruptTurn === null);
    expect(rivals.length, 'no rivals had entered to check').toBeGreaterThan(0);
    for (const rival of rivals) {
      const theirs = conditionsFor(
        game, rival, { ...route, carrierId: rival.id }, new Set(['Narrowbody']),
      );
      expect(theirs.preferredMaker, `${rival.id} has no shop`).not.toBeNull();
    }
  });
});
