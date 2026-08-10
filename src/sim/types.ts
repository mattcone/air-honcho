/**
 * The shape of the world. Everything here is plain serializable data — no class
 * instances, no Dates, no functions — because GameState round-trips through
 * JSON.stringify on every autosave.
 */

export type CityId = string;
export type CarrierId = string;
export type RouteId = string;
export type AircraftTypeId = string;
export type TailId = string;

export type Region = 'NA' | 'LATAM' | 'EU' | 'MEA' | 'AFR' | 'SAS' | 'SEA' | 'EAS' | 'OCE';

/** Chosen at game start; scales traffic, disasters and the rival field. */
export type Difficulty = 'easy' | 'medium' | 'hard';

export interface City {
  readonly id: CityId;
  readonly name: string;
  readonly country: string;
  readonly region: Region;
  readonly lat: number;
  readonly lon: number;
  /** Metro population, millions. */
  readonly pop: number;
  /** Economic weight multiplier — a proxy for income and business-travel intensity. */
  readonly weight: number;
}

/** A model of aircraft the player can acquire. Static data, loaded from JSON. */
export interface AircraftType {
  readonly id: AircraftTypeId;
  readonly name: string;
  readonly maker: string;
  readonly klass: string;
  /**
   * The real class this type's figures were modelled on. Documentation, never
   * read by the sim — but it is what makes a number checkable against published
   * data, so it is typed rather than left floating in the JSON.
   */
  readonly basis: string;
  readonly seats: number;
  readonly rangeKm: number;
  readonly cruiseKmh: number;
  readonly turnaroundMin: number;
  readonly price: number;
  readonly leaseMonthly: number;
  readonly fuelBurnLPerKm: number;
  readonly maintPerBlockHour: number;
  readonly maintAgeSlope: number;
  readonly crewPerBlockHour: number;
  /** Year the type entered service (real launch for historical, target for future). */
  readonly introYear: number;
  /** How far the actual launch may slip from introYear, in years. 0 = fixed. */
  readonly introVariabilityYears: number;
}

/** One rival as dealt for a particular game. */
export interface PlannedRival {
  readonly id: string;
  readonly name: string;
  readonly color: string;
  readonly archetypeId: string;
  readonly entryTurn: number;
  readonly attentionMillions: number;
  /** Personality multipliers over the archetype's knobs, rolled per game. */
  readonly aggression: number;
  readonly thrift: number;
  readonly reach: number;
  /**
   * Fleet-planning accuracy as a multiplier on the aircraft size it aims for.
   * 1 is a sharp operator that flies the right-sized aircraft; above 1 it
   * chronically over-gauges (half-empty jets), below 1 it under-gauges (spills
   * traffic). This is why not every carrier converges on the same optimal type.
   */
  readonly gaugeBias: number;
}

/** A world event currently moving operating conditions. */
export interface ActiveEffect {
  readonly source: string;
  readonly kind: 'event';
  /** Turn it stops applying, or null if permanent. */
  readonly until: number | null;
  readonly effects: Readonly<Record<string, number>>;
  readonly scope?: {
    readonly regions?: readonly Region[];
    readonly aircraftKlass?: string;
  };
}

/** A technology program that has been paid for but has not landed yet. */
export interface TechInProgress {
  readonly nodeId: string;
  readonly completesTurn: number;
}

/** Fuel locked forward at an agreed price. */
export interface Hedge {
  readonly fraction: number;
  readonly pricePerL: number;
  readonly untilTurn: number;
}

export type Ownership = 'owned' | 'leased';

/** A single tail in a carrier's fleet. */
export interface Aircraft {
  readonly id: TailId;
  readonly typeId: AircraftTypeId;
  readonly ownership: Ownership;
  /** Turn the tail joined the fleet; age drives maintenance and depreciation. */
  readonly acquiredTurn: number;
  /** Turn it enters service. Ordered aircraft take quarters to arrive — until
   *  then it cannot be assigned, does not fly, and pays no lease or standing. */
  readonly deliversTurn: number;
  /** Turn of the last heavy maintenance visit, if any. Resets effective age. */
  overhauledTurn?: number;
  /** Current book value. Owned tails depreciate each quarter; leased are 0. */
  bookValue: number;
  /** Route this tail flies, or null if parked. */
  routeId: RouteId | null;
}

/** The only pricing lever the player gets. See pillar 1: no per-seat fares. */
export type PricingPosture = 'skim' | 'premium' | 'match' | 'undercut' | 'stimulate';

export interface Route {
  readonly id: RouteId;
  readonly carrierId: CarrierId;
  readonly from: CityId;
  readonly to: CityId;
  posture: PricingPosture;
  /** Turn the route opened, for age-based effects later. */
  readonly openedTurn: number;
}

export interface Carrier {
  readonly id: CarrierId;
  readonly name: string;
  readonly isPlayer: boolean;
  /** Hex color — one accent per carrier, per the visual direction. */
  readonly color: string;
  readonly homeCityId: CityId;
  /** Archetype driving this carrier's behavior, or null for the player. */
  readonly archetypeId: string | null;
  cash: number;
  fleet: Aircraft[];
  /**
   * Technology this carrier has delivered, and what it is still paying for.
   * Both belong to the carrier, not the world — you do not get the benefit of a
   * rival's investment, and they do not get yours.
   */
  tech: string[];
  techInProgress: TechInProgress[];
  /** Fuel this carrier locked forward, if any. Also strictly its own. */
  hedge: Hedge | null;
  /**
   * Cash moved between this carrier and its controller so far this quarter, in
   * either direction. Reset every turn alongside `stakeBought`, which it mirrors:
   * both exist so that a limit is per-quarter rather than per-click. Optional so
   * a v15 save loads without one; absent reads as none moved.
   */
  transferredThisQuarter?: number;
  /** Set on the turn the carrier ran out of money. */
  bankruptTurn: number | null;
  // --- Financial layer (Phase 4) ---
  /** Shares outstanding. Share price = equity / this. */
  shares: number;
  /**
   * Cumulative shares created by equity issuance (split-adjusted), never reset.
   * Bounds total issuance to an authorized ceiling, so raising equity is a finite
   * well and not an endless market-cap pump. Absent on pre-issuance saves (= 0).
   */
  issuedShares?: number;
  /** Outstanding debt principal. Interest is charged on it each quarter. */
  debt: number;
  /**
   * Stakes this carrier holds in others, by carrier id → shares owned. Building
   * a stake past the control threshold lets it force a buyout of the rest.
   */
  holdings: Record<CarrierId, number>;
  /**
   * Shares of each target this carrier has bought in the CURRENT quarter, by
   * carrier id. Reset every turn — it enforces the per-quarter purchase cap, so
   * building a controlling stake takes several quarters and can be seen coming.
   */
  stakeBought: Record<CarrierId, number>;
  /**
   * Share of this carrier's net income paid out to shareholders each quarter, in
   * [0, maxDividend]. A payout lifts the share price (income investors pay up) but
   * drains the company's cash — and a controller can crank a subsidiary's dividend
   * to pull its cash upward. Defaults to 0.
   */
  dividend: number;
  /** Quarters of post-acquisition integration drag still to run, if any. */
  integrationUntil: number | null;
  /** Set to the acquirer's id if this carrier was bought out rather than failed. */
  acquiredBy: CarrierId | null;
  /** How many government bailouts this carrier has taken in crises. */
  bailouts: number;
  /**
   * Chapter 11s survived. A carrier that fails with a network still worth flying
   * restructures instead of being wound up: creditors take most of the debt, the
   * fleet and route map shrink, and it emerges structurally cheaper than the
   * airlines that never failed. Capped, because a rival that cannot die is not a
   * rival. Absent on pre-v15 saves (= 0).
   */
  reorganisations?: number;
}

/**
 * Quarterly cash P&L for one carrier. Component fields sum to the net:
 * revenue − (fuel + crew + maintenance + handling + lease + standing + fixed + overhead)
 * − tax = netIncome.
 * Append-only; drives the P&L screens.
 */
export interface QuarterResult {
  readonly turn: number;
  readonly carrierId: CarrierId;
  readonly revenue: number;
  readonly fuel: number;
  readonly crew: number;
  readonly maintenance: number;
  readonly handling: number;
  readonly lease: number;
  readonly standing: number;
  readonly fixed: number;
  readonly overhead: number;
  /** Interest paid on debt this quarter. Below the operating line. */
  readonly interest: number;
  /**
   * A state bailout taken this quarter, booked as debt. Optional so old saves
   * load; absent reads as none.
   *
   * Recorded because it was invisible: the settlement quietly lifted cash to the
   * bailout cushion and doubled the carrier's debt, so a player watching their
   * balance stop at exactly $30M every quarter had no way to tell a rescue from
   * a bug. It is on the quarter so the briefing can say what happened.
   */
  readonly bailout?: number;
  /**
   * Dividends received this quarter on stakes held in other carriers. Below the
   * operating line, and folded into netIncome. Optional so old saves load; absent
   * reads as zero.
   */
  readonly dividendIncome?: number;
  /** Tax on a profitable quarter; zero when the quarter lost money. */
  readonly tax: number;
  readonly netIncome: number;
  readonly cashAfter: number;
}

/**
 * A route's economics for one quarter — every figure the player is entitled to
 * see, per the "must be legible" rule. Derived, never stored in GameState: the
 * UI recomputes it for display and the engine recomputes it to settle the turn.
 */
export interface RouteEconomics {
  readonly distanceKm: number;
  readonly aircraftCount: number;
  // Traffic and capacity are ROUTE TOTALS: both directions, per week. They are
  // directly comparable with each other, and any panel may show them side by
  // side. The sim sizes one direction internally and doubles on the way out —
  // do not mix the two conventions here again.
  //
  // The invariant that holds:
  //   paxCarriedWeekly <= capacityWeekly * loadCeiling
  //
  // What this file USED to claim, and what is actually true. The old line was
  //   paxCarriedWeekly + spilledWeekly === marketDemandWeekly * demandShare
  // and it has not been true since two later changes, either of which breaks it:
  //
  //  1. `demandShare` is the ATTRACTIVENESS share — frequency, posture, gauge,
  //     hub feed — and deliberately so, because the shares of the carriers on a
  //     market have to sum to one for the market table to make sense. The traffic
  //     a carrier actually draws is that share times `priceStimulation`, which is
  //     below one at Premium and above one at Undercut. So the product above is
  //     smaller than the traffic on an undercutting sector and LARGER on a premium
  //     one — the discrepancy takes both signs.
  //  2. A carrier also absorbs its rivals' overflow (`share.spillCapture`), which
  //     is traffic it never won on attractiveness at all.
  //
  // The real relationship, one-way, is
  //   carried + spilled === market * demandShare * priceStimulation + absorbed
  // and it is not worth restating as a testable identity here because both extra
  // terms are internal to `computeRouteEconomics`. Stated because a false invariant
  // in a types file is worse than none: it invites someone to "fix" working code.
  /** Passengers/week the whole market wants, both directions, before share. */
  readonly marketDemandWeekly: number;
  /** Round trips/week the assigned fleet can fly. */
  readonly frequencyWeekly: number;
  readonly departuresWeekly: number;
  /** Seats/week offered, both directions. */
  readonly capacityWeekly: number;
  readonly demandShare: number;
  /** Passengers/week actually carried, both directions. */
  readonly paxCarriedWeekly: number;
  readonly loadFactor: number;
  /** The most of the aircraft this carrier could fill, however much demand. */
  readonly loadCeiling: number;
  /** Passengers/week who chose this carrier and could not be seated. */
  readonly spilledWeekly: number;
  /** The fare actually charged, one-way, after the market-structure premium. */
  readonly fareOneWay: number;
  /** How much market structure lifted the fare: 1 on a fully contested route,
   *  up to 1 + monopolyPremium on one no rival serves. */
  readonly competitionMultiplier: number;
  // Quarterly money:
  /** TOTAL revenue — passengers plus belly cargo. Subtract `cargo` for the
   *  passenger line. Total, so that every margin taken against it is honest. */
  readonly revenue: number;
  /**
   * Belly freight, already included in `revenue`. Driven by scheduled capacity
   * and sector length rather than by passengers carried: the hold fills whether
   * or not the cabin does, which is what makes a widebody worth flying on a long
   * thin route.
   */
  readonly cargo: number;
  readonly fuel: number;
  readonly crew: number;
  readonly maintenance: number;
  readonly handling: number;
  /** Rent on leased tails assigned here (a cash cost). */
  readonly lease: number;
  /**
   * Depreciation on owned tails assigned here — book value times the quarterly
   * rate, the same write-down the balance sheet takes. The owned-aircraft
   * counterpart to `lease`, and the real Depreciation line of an income
   * statement. Non-cash: the purchase was paid up front, so this is excluded
   * from netCash. It exists so a route flown on owned metal reads honestly.
   */
  readonly ownership: number;
  readonly standing: number;
  readonly fixed: number;
  readonly overhead: number;
  /** Cash the route puts in the bank. What the company settles on. */
  readonly netCash: number;
  /** netCash after the ownership capital charge — the route's true contribution. */
  readonly netEconomic: number;
}

/** A liquidated carrier's aircraft, on the market at a distressed price. */
export interface DistressedLot {
  readonly typeId: AircraftTypeId;
  /** Aircraft still unsold in this lot. */
  count: number;
  /** Turn the estate disperses whatever is left. */
  readonly untilTurn: number;
  /** Fraction of list price. */
  readonly priceFraction: number;
  /** Whose fleet this was, for the market copy. */
  readonly fromName: string;
}

export interface GameState {
  /** Bumped whenever the save shape changes; see sim/save.ts for migrations. */
  readonly schemaVersion: number;
  readonly seed: number;
  /** Serialized PRNG state. Advances every turn, so saves resume mid-stream. */
  rngState: number;
  /** Monotonic counter for minting unique tail ids. */
  seq: number;
  /** Turn 0 is pre-first-quarter. One turn = one quarter. */
  turn: number;
  /** Spot price, USD per liter. Walks each quarter. */
  fuelPrice: number;
  /** Baseline share of the schedule operating this quarter, before events. */
  baseCompletion: number;
  /** World events currently in force. These hit every carrier alike. */
  events: ActiveEffect[];
  /**
   * Aircraft from carriers that were wound up rather than restructured, on the
   * market cheap until the estate disperses them. Absent on pre-v15 saves.
   */
  distressed?: DistressedLot[];
  readonly playerCarrierId: CarrierId;
  /** Which scenario this game is: present-day (2026) or the historical run (2000). */
  readonly scenario: 'present' | 'history';
  /** Difficulty chosen at game start. Scales world demand, the disaster rate, and
   *  the size, arrival rate and aggression of the rival field. Set once, never changes. */
  readonly difficulty: Difficulty;
  /** Calendar year of turn 0. Drives every date label and the aircraft timeline. */
  readonly startYear: number;
  /** How many quarters the game runs before the horizon closes. */
  readonly horizonTurns: number;
  /**
   * The cast for this game: who exists, which archetype they play, when they
   * show up and what personality they were dealt. Rolled once from the seed in
   * newGame, so the same seed always faces the same opponents.
   */
  readonly rivalPlan: PlannedRival[];
  /** Ids from the plan that have already entered. */
  enteredRivals: string[];
  carriers: Carrier[];
  routes: Route[];
  history: QuarterResult[];
  /** Highest equity value the player has ever reached — a hostile takeover needs
   *  the share price to have cratered from this peak, not merely to be small. */
  playerPeakEquity: number;
  /**
   * Turn each aircraft type enters service THIS game, keyed by type id. Historical
   * types are fixed; a future type's arrival is rolled from the seed and may land
   * past the horizon, meaning it never ships. An aircraft cannot be ordered before
   * its intro turn — the adoption race is who re-fleets to a new type first.
   */
  readonly aircraftIntro: Readonly<Record<string, number>>;
  /** Set once the game has ended: when, why, and whether the player won or lost. */
  gameOver: { readonly turn: number; readonly reason: string; readonly outcome: 'won' | 'lost' } | null;
}

export type Action =
  | { readonly type: 'OPEN_ROUTE'; readonly carrierId: CarrierId; readonly from: CityId; readonly to: CityId }
  | { readonly type: 'CLOSE_ROUTE'; readonly routeId: RouteId }
  | { readonly type: 'SET_POSTURE'; readonly routeId: RouteId; readonly posture: PricingPosture }
  | {
      readonly type: 'ACQUIRE_AIRCRAFT';
      readonly carrierId: CarrierId;
      readonly typeId: AircraftTypeId;
      readonly ownership: Ownership;
      /** Buy out of a wound-up carrier's estate: cheap, immediate, purchase only. */
      readonly distressed?: boolean;
    }
  | { readonly type: 'DISPOSE_AIRCRAFT'; readonly carrierId: CarrierId; readonly tailId: TailId }
  | { readonly type: 'OVERHAUL_AIRCRAFT'; readonly carrierId: CarrierId; readonly tailId: TailId }
  | { readonly type: 'ASSIGN_AIRCRAFT'; readonly carrierId: CarrierId; readonly tailId: TailId; readonly routeId: RouteId }
  | { readonly type: 'UNASSIGN_AIRCRAFT'; readonly carrierId: CarrierId; readonly tailId: TailId }
  | { readonly type: 'HEDGE_FUEL'; readonly carrierId: CarrierId; readonly fraction: number }
  | { readonly type: 'START_TECH'; readonly carrierId: CarrierId; readonly nodeId: string }
  // --- Financial layer (Phase 4) ---
  | { readonly type: 'BORROW'; readonly carrierId: CarrierId; readonly amount: number }
  | { readonly type: 'REPAY_DEBT'; readonly carrierId: CarrierId; readonly amount: number }
  | { readonly type: 'ISSUE_EQUITY'; readonly carrierId: CarrierId; readonly amount: number }
  | { readonly type: 'BUY_SHARES'; readonly carrierId: CarrierId; readonly targetId: CarrierId; readonly amount: number }
  /*
   * Direct a carrier you control to buy shares in a third one, with ITS money.
   *
   * Deliberately a separate action from BUY_SHARES rather than a flag on it. The
   * engine validates state, not callers, so "who is allowed to spend this treasury"
   * has to be a fact in the state: naming the controller makes the permission
   * checkable (`commands(controller, buyer)`) and leaves the plain BUY_SHARES path
   * the AI uses for itself completely untouched.
   */
  | {
      readonly type: 'DIRECT_BUY_SHARES';
      readonly controllerId: CarrierId;
      readonly buyerId: CarrierId;
      readonly targetId: CarrierId;
      readonly amount: number;
    }
  /** Move cash between a controller and a carrier it commands, in either direction. */
  | {
      readonly type: 'TRANSFER_CASH';
      readonly controllerId: CarrierId;
      readonly fromId: CarrierId;
      readonly toId: CarrierId;
      readonly amount: number;
    }
  | { readonly type: 'SELL_SHARES'; readonly carrierId: CarrierId; readonly targetId: CarrierId; readonly amount: number }
  /** Greenmail: buy one shareholder's entire stake in YOUR carrier and retire it. */
  | { readonly type: 'BUY_BACK_STAKE'; readonly carrierId: CarrierId; readonly holderId: CarrierId }
  | { readonly type: 'SET_DIVIDEND'; readonly carrierId: CarrierId; readonly targetId: CarrierId; readonly rate: number }
  | { readonly type: 'ACQUIRE_CARRIER'; readonly carrierId: CarrierId; readonly targetId: CarrierId; readonly withDebt: boolean };

/** Actions can be rejected; the UI shows `error` and the state is unchanged. */
export interface ActionResult {
  readonly state: GameState;
  readonly ok: boolean;
  readonly error?: string;
}
