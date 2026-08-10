/**
 * Rival carriers: entry, and one turn of decisions.
 *
 * There is a single brain here, not four. The archetypes differ by the knobs
 * they read from archetypes.json — posture, cash discipline, sector length,
 * fortress-hub or point-to-point, who they refuse to fight. That is what
 * CLAUDE.md means by "data-configured, decision logic in /sim/ai": adding a
 * fifth archetype should be a JSON entry, not a new code path.
 */
import archetypeData from '../../data/archetypes.json' with { type: 'json' };
import rivalData from '../../data/rivals.json' with { type: 'json' };
import type { Carrier, CarrierId, Difficulty, GameState, PlannedRival, PricingPosture } from '../types.ts';
import { applyAction, getCarrier } from '../engine.ts';
import type { Rng } from '../rng.ts';
import { CONSTANTS, difficultyMods, getCity } from '../world.ts';
import { assignedTo, marketKey } from '../economics.ts';
import {
  acquisitionCost, borrowingCapacity, controlledBy, controls, marketCap, sharePrice,
  trailingEarnings,
} from '../market.ts';
import {
  bestIncursion, bestNewSector, bestReinforcement, chooseHome, equip, expansionBar,
  hubDominance, marketIndex, maybeBorrow, maybeHedge, maybeInvestInTech, openSector, posturesFor,
  probe, pruneLosers, releaseIdle, renewFleet, retreat,
  type AiConfig, type Index,
} from './common.ts';

export interface Archetype extends AiConfig {
  readonly id: string;
  readonly name: string;
  readonly blurb: string;
  readonly posture: PricingPosture;
  readonly matchOnOverlap: boolean;
  readonly startingCash: number;
  /** Share of each quarter's profit this archetype pays out (0-1). */
  readonly dividend: number;
  readonly homeWeightMin: number;
  readonly homeWeightMax: number;
  readonly homePopMin: number;
}

interface RosterEntry {
  readonly id: string;
  readonly name: string;
  readonly color: string;
}

export const ARCHETYPES: readonly Archetype[] = Object.freeze(
  archetypeData.archetypes as unknown as Archetype[],
);
const ROSTER = rivalData.roster as unknown as RosterEntry[];
const DRAW = rivalData.draw;

const BY_ID = new Map(ARCHETYPES.map((a) => [a.id, a]));

/**
 * Knob overrides for the offline tuner (`npm run tune`) — archetype id -> partial
 * config. EMPTY in every real game and every test: a shipped game is pure data plus
 * deterministic code, and nothing sets this but the tuning script, which needs to
 * ask "what if this archetype planned further ahead?" without rewriting the JSON.
 */
let overrides: Readonly<Record<string, Readonly<Record<string, number>>>> = {};

export function setArchetypeOverrides(next: Record<string, Record<string, number>>): void {
  overrides = next;
}

export function clearArchetypeOverrides(): void {
  overrides = {};
}

export function getArchetype(id: string): Archetype {
  const found = BY_ID.get(id);
  if (!found) throw new Error(`Unknown archetype: ${id}`);
  const patch = overrides[id];
  return patch ? ({ ...found, ...patch } as Archetype) : found;
}

/**
 * Deal the cast for one game: who turns up, playing what, when, and with which
 * personality. Called once from newGame so the roll is stable and saved.
 *
 * Nothing here is fixed between games. A run might face three low-cost carriers
 * and no flag carrier, or a single very aggressive legacy hub arriving in year
 * two. That variety is the point — a player who has learned one cast should not
 * be able to coast on it.
 */
export function planRivals(rng: Rng, difficulty: Difficulty = 'medium'): PlannedRival[] {
  const mod = difficultyMods(difficulty);
  // Difficulty scales the cast size: a smaller field on easy, a bigger one on hard.
  // Clamped to a floor of 2 and the roster it can draw from.
  const dealt = Math.round(rng.int(DRAW.minRivals, DRAW.maxRivals) * mod.rivalCount);
  const count = Math.max(2, Math.min(dealt, ROSTER.length));
  const chosen = rng.shuffle(ROSTER).slice(0, count);

  // How fast the dealt cast arrives. rivalCount decides how MANY rivals a game
  // has; this decides when they show up, and without it every level queued them
  // on one schedule — so a bigger hard field simply arrived no sooner.
  const pace = Math.max(0.1, mod.entryPace);
  let turn = Math.max(1, Math.round(DRAW.firstEntryTurn / pace));
  return chosen.map((entry, i) => {
    const plan: PlannedRival = {
      id: entry.id,
      name: entry.name,
      color: entry.color,
      archetypeId: rng.pick(ARCHETYPES).id,
      entryTurn: turn,
      // Pillar 4: success attracts sharks. Scaled by pace because the trigger
      // reads PLAYER PROFIT, and a harder world makes the player poorer — so
      // without this the accelerator fired least exactly where it was wanted most.
      attentionMillions: (DRAW.attentionBaseMillions + i * DRAW.attentionStepMillions) / pace,
      // Hard makes every rival bolder; easy gentler. Scales incursion appetite and
      // loss tolerance through effectiveConfig.
      aggression: rng.float(DRAW.aggressionMin, DRAW.aggressionMax) * mod.aggression,
      thrift: rng.float(DRAW.thriftMin, DRAW.thriftMax),
      reach: rng.float(DRAW.reachMin, DRAW.reachMax),
      gaugeBias: 1 + rng.float(-DRAW.gaugeBiasSpread, DRAW.gaugeBiasSpread),
    };
    // The roll happens either way, so the stream stays in step across levels.
    turn += Math.max(1, Math.round(rng.int(DRAW.entryGapMin, DRAW.entryGapMax) / pace));
    return plan;
  });
}

/**
 * An archetype bent by one carrier's personality. Same strategy, different
 * temperament: how readily it picks a fight, how much cash it sits on, how far
 * it will fly.
 */
export function effectiveConfig(plan: PlannedRival, difficulty: Difficulty = 'medium'): Archetype {
  const base = getArchetype(plan.archetypeId);
  /*
   * The commit bar is an ABSOLUTE figure, so it has to move with the world it is
   * judging. Difficulty `yield` thins every carrier's revenue; against a fixed
   * dollar bar that quietly makes rivals PASSIVE in exactly the world meant to
   * make them fierce — measured, hard fielded fewer sectors by turn 40 than
   * medium once yield dropped to 0.9.
   *
   * Sign-aware for the same reason `minProjectedNetPerQuarter` already is below:
   * a flag carrier's bar is negative (it will buy share at a loss), and scaling a
   * negative the naive way raises it.
   */
  const yieldMod = difficultyMods(difficulty).yield;
  const scaleBar = (bar: number): number => (bar > 0 ? bar * yieldMod : bar / yieldMod);
  return {
    ...base,
    incursionAppetite: (base.incursionAppetite ?? 0) * plan.aggression,
    // A bolder carrier commits on a thinner projection — and where the archetype
    // is willing to buy share at a loss (the flag carrier), boldness means it
    // will stomach a DEEPER loss, not a shallower one. Dividing through would
    // have quietly made the most aggressive flag carriers the most cautious.
    minProjectedNetPerQuarter: scaleBar(
      base.minProjectedNetPerQuarter > 0
        ? base.minProjectedNetPerQuarter / plan.aggression
        : base.minProjectedNetPerQuarter * plan.aggression,
    ),
    // A thrifty carrier keeps more cash back, and that shows up as a shorter
    // technology program too — so two ULCCs in different games differ in how
    // far they take it, not only in which nodes they favour.
    ...(base.tech
      ? { tech: { ...base.tech, appetite: base.tech.appetite / plan.thrift } }
      : {}),
    reserveCash: base.reserveCash * plan.thrift,
    // The cash gate is absolute too, and it — not the commit bar, which is only
    // a few hundred thousand — is what actually throttles expansion. In a thinner
    // world a carrier banks slower, sits under a fixed gate longer, and expands
    // less: measured, the thing that made hard field FEWER sectors than medium.
    // The safety reserve is deliberately NOT scaled; a leaner world is a reason to
    // grow at a lower cash bar, not a reason to hold a smaller cushion.
    expandAboveCash: base.expandAboveCash * plan.thrift * yieldMod,
    maxSectorKm: base.maxSectorKm * plan.reach,
    playerFocus: DRAW.playerFocusMultiplier * plan.aggression,
    // How well it sizes its fleet. Carried straight through, so a poor planner
    // aims at the wrong-sized aircraft on every route it opens.
    gaugeBias: plan.gaugeBias,
  };
}

export function plannedRival(state: GameState, id: string): PlannedRival {
  const found = state.rivalPlan.find((r) => r.id === id);
  if (!found) throw new Error(`Unknown rival: ${id}`);
  return found;
}

/**
 * How much attention the player's success has attracted: trailing-year net
 * income. Pillar 4 — no difficulty slider, rivals arrive because you are worth
 * taking business from.
 */
export function playerAttention(state: GameState): number {
  const perYear = CONSTANTS.game.quartersPerYear;
  const recent = state.history
    .filter((h) => h.carrierId === state.playerCarrierId)
    .slice(-perYear);
  return Math.max(0, recent.reduce((sum, q) => sum + q.netIncome, 0));
}

/**
 * Bring in at most one rival per quarter, so the curve stays readable. A rival
 * is due either when the calendar reaches it or when the player has grown fat
 * enough to notice.
 */
export function admitRival(state: GameState, rng: Rng): GameState {
  const pending = state.rivalPlan.filter((r) => !state.enteredRivals.includes(r.id));
  if (pending.length === 0) return state;

  const attention = playerAttention(state);
  const due = pending.find(
    (r) => state.turn >= r.entryTurn || attention >= r.attentionMillions * 1e6,
  );
  if (!due) return state;
  return spawnCarrier(state, due, rng);
}

/**
 * Put one planned rival on the board: pick a home, deal it a clean balance sheet,
 * and open its first sector so it appears already flying. Shared by the scheduled
 * cast (`admitRival`) and the new startups that spin up mid-game.
 */
function spawnCarrier(state: GameState, plan: PlannedRival, rng: Rng): GameState {
  const archetype = effectiveConfig(plan, state.difficulty);
  const taken = new Set(state.carriers.map((c) => c.homeCityId));
  // Count the PLAYER too: a player's own region should draw neighbours like any
  // other, which is exactly where they most need to meet somebody.
  const regionLoad = new Map<string, number>();
  for (const c of state.carriers) {
    if (c.bankruptTurn !== null) continue;
    const region = getCity(c.homeCityId).region;
    regionLoad.set(region, (regionLoad.get(region) ?? 0) + 1);
  }
  const home = chooseHome(
    rng, taken, archetype.homeWeightMin, archetype.homeWeightMax, archetype.homePopMin, regionLoad,
  );

  const carrier: Carrier = {
    id: plan.id,
    name: plan.name,
    isPlayer: false,
    color: plan.color,
    homeCityId: home,
    archetypeId: archetype.id,
    cash: archetype.startingCash * difficultyMods(state.difficulty).rivalCapital,
    fleet: [],
    tech: [],
    techInProgress: [],
    hedge: null,
    bankruptTurn: null,
    shares: CONSTANTS.finance.startingShares,
    debt: 0,
    holdings: {},
    stakeBought: {},
    dividend: archetype.dividend,
    integrationUntil: null,
    acquiredBy: null,
    bailouts: 0,
  };

  const next = {
    ...state,
    carriers: [...state.carriers, carrier],
    enteredRivals: [...state.enteredRivals, plan.id],
  };
  const index = marketIndex(next);
  const pick = bestNewSector(next, index, carrier.id, archetype);
  return pick && pick.score > archetype.minProjectedNetPerQuarter
    ? openSector(next, carrier.id, pick, archetype)
    : next;
}

/**
 * New airlines spin up to fill the vacuum consolidation leaves. In reality a
 * thinned, profitable market draws low-cost startups — Breeze and Avelo entering
 * the secondary cities the merged majors walked away from. So once a carrier has
 * left the board and the survivors are making money, a fresh ULCC may enter from
 * the unused names, keeping the field from grinding down to a static duopoly.
 */
export function maybeSpawnEntrant(state: GameState, rng: Rng): GameState {
  const E = CONSTANTS.entrant;
  const mod = difficultyMods(state.difficulty);
  if (state.turn < E.minTurn) return state;

  // Wait for the scheduled cast to arrive before startups fill gaps — otherwise
  // an entrant and a late scheduled rival can both take a slot and overflow the
  // field. Every un-entered plan is a scheduled rival (entrants enter at once).
  if (state.rivalPlan.some((r) => !state.enteredRivals.includes(r.id))) return state;

  const used = new Set(state.rivalPlan.map((r) => r.id));
  const pool = ROSTER.filter((e) => !used.has(e.id));
  if (pool.length === 0) return state;

  const rivals = state.carriers.filter((c) => !c.isPlayer);
  const solvent = rivals.filter((c) => c.bankruptTurn === null);
  const gone = rivals.length - solvent.length;
  if (solvent.length >= Math.round(DRAW.maxRivals * mod.rivalCount)) return state; // the field is already full

  // A collapsed market is exactly where real low-cost startups appear: after a
  // shock guts the field, the survivors abandon routes and a Breeze or an Avelo
  // moves into the vacuum. When the rivals between them fly almost nothing, an
  // entrant may bootstrap the market even if nobody is currently profitable.
  const rivalRoutes = state.routes.filter((r) => r.carrierId !== state.playerCarrierId).length;
  const vacuum = rivalRoutes <= E.vacuumRoutes;
  if (!vacuum) {
    if (gone === 0) return state; // no vacancy to fill yet
    // A market worth entering: at least a third of the survivors turn a profit.
    // (Was half — loosened so failures and consolidation refill and the field
    // stays near its cap rather than thinning out, especially through a crisis.)
    const profitable = solvent.filter((c) => trailingEarnings(state, c.id) > 0).length;
    if (solvent.length > 0 && profitable * 3 < solvent.length) return state;
  }

  if (!rng.chance(E.chancePerQuarter * mod.entrantChance)) return state;

  const entry = rng.pick(pool);
  const plan: PlannedRival = {
    id: entry.id,
    name: entry.name,
    color: entry.color,
    archetypeId: 'ulcc', // startups are low-cost, point-to-point in secondary cities
    entryTurn: state.turn,
    attentionMillions: 0,
    aggression: rng.float(DRAW.aggressionMin, DRAW.aggressionMax),
    thrift: rng.float(DRAW.thriftMin, DRAW.thriftMax),
    reach: rng.float(DRAW.reachMin, DRAW.reachMax),
    gaugeBias: 1 + rng.float(-DRAW.gaugeBiasSpread, DRAW.gaugeBiasSpread),
  };
  return spawnCarrier({ ...state, rivalPlan: [...state.rivalPlan, plan] }, plan, rng);
}

/**
 * Reprice each sector within the archetype's band, once a quarter.
 *
 * Two rules, in order. A carrier with `matchOnOverlap` drops to matching the
 * moment somebody contests a sector and returns to its identity posture when the
 * market clears — that is the legacy hub's character and it is not up for
 * negotiation. Otherwise the carrier picks the best posture in its band at
 * today's conditions.
 *
 * Without this, a band bought nothing: `posturesFor` is only consulted when a
 * sector is OPENED, so a route priced at undercut in year two was still priced at
 * undercut in year twenty-five however much the market underneath it had moved.
 * Measured before it existed: skim and stimulate on 0.00% of rival route-quarters
 * even after the archetypes were given bands containing them.
 *
 * Priced with `probe` — today's conditions, not the planning horizon — because
 * this is a decision the carrier revisits every quarter, not a commitment.
 *
 * Every quarter, same as the player can. An annual staggered review was built
 * first, on the belief that probing the band cost about half of headless runtime.
 * It does not: 8.71s against 8.78s over six games, indistinguishable. The 50%
 * figure came from timing a run with repricing disabled, which is not the same
 * work minus a probe — it is a different, smaller game, because the AI then flies
 * different routes. Reverted, because the only remaining argument for an annual
 * review was that it made rivals slower to respond than the player, which is the
 * opposite of what this field needs.
 */
function repriced(state: GameState, index: Index, carrierId: CarrierId, cfg: Archetype): GameState {
  const band = posturesFor(cfg);
  let s = state;
  for (const route of s.routes) {
    if (route.carrierId !== carrierId) continue;
    const contested = (index.get(marketKey(route.from, route.to)) ?? []).some(
      (p) => p.carrierId !== carrierId,
    );
    let wanted: PricingPosture;
    /*
     * A Territorial that has taken the place starts charging for it.
     *
     * This is the third beat of the loop and the one that makes it read as the
     * board game rather than as another expansionist: build the set, then put the
     * rent up. It only applies on its own hub and only once it holds most of the
     * sectors there — below that it is still buying properties and keeps matching,
     * because a premium fare on a market it has not cornered just hands share to
     * whoever else is standing on it.
     *
     * Deliberately ahead of `matchOnOverlap`: a monopolist does not drop to match
     * because somebody turned up. Having the city is exactly what lets it not.
     */
    const owns = cfg.cornerHub === true
      && (route.from === getCarrier(s, carrierId).homeCityId || route.to === getCarrier(s, carrierId).homeCityId)
      && hubDominance(s, carrierId, route.from === getCarrier(s, carrierId).homeCityId ? route.from : route.to)
         >= CONSTANTS.ai.cornerRentThreshold;
    if (owns) {
      wanted = 'premium';
    } else if (cfg.matchOnOverlap && contested) {
      wanted = 'match';
    } else if (band.length <= 1) {
      wanted = band[0] ?? cfg.posture;
    } else {
      const tails = assignedTo(getCarrier(s, carrierId), route.id);
      // Nothing flying means nothing to price; leave it where it is.
      if (tails.length === 0) continue;
      const net = new Map<PricingPosture, number>();
      let best: PricingPosture = route.posture;
      let bestNet = -Infinity;
      for (const posture of band) {
        const value = probe(s, index, { ...route, posture }, tails);
        net.set(posture, value);
        if (value > bestNet) { bestNet = value; best = posture; }
      }
      wanted = best;
      /*
       * Predation: on a sector it shares, a carrier will give up a slice of the
       * profit to sit underneath the competition instead of on top of the margin.
       *
       * This is the one axis difficulty never touched. Contested sectors on hard
       * were priced at undercut 41.9% of the time against easy's 42.5% — the same
       * game — so a hard rival met on a route behaved exactly like a gentle one,
       * whatever else the difficulty knobs were doing to it.
       *
       * Only where the cheaper fare is still PROFITABLE. A rival that prices
       * itself into a loss it cannot fund is not ruthless, it is dead, and the
       * carriers this is meant to make frightening are the ones with the balance
       * sheet to keep it up. It also means squeezing a wolf onto thin margins
       * stops the squeezing, which is the counterplay.
       */
      const predation = difficultyMods(s.difficulty).predation ?? 0;
      if (predation > 0 && bestNet > 0) {
        const floor = bestNet * (1 - predation);
        // Cheapest first, so the first that clears the floor is the deepest cut
        // this carrier can afford. Ordered by the fare table rather than by the
        // order the band happens to be written in.
        const byFare = [...band].sort(
          (a, b) => CONSTANTS.posture.fare[a] - CONSTANTS.posture.fare[b],
        );
        for (const posture of byFare) {
          if ((net.get(posture) ?? -Infinity) >= floor) { wanted = posture; break; }
        }
      }
    }
    if (route.posture === wanted) continue;
    const result = applyAction(s, { type: 'SET_POSTURE', routeId: route.id, posture: wanted });
    if (result.ok) s = result.state;
  }
  return s;
}

/** One rival's quarter: renew, reprice, then either retreat or grow. */
/**
 * A roll-up artist grows by buying rivals, not routes. It runs a campaign in the
 * open: a slice of a weak competitor's shares a quarter, funded from cash, until
 * it holds a controlling stake — then it folds the rest in with debt, which is
 * what makes the roll-up powerful and fragile at once. Because the stake is built
 * over several quarters, the target (and everyone reading the board) sees it
 * coming. It will not bite something bigger than itself, and it leaves the player
 * to the hostile-takeover mechanic.
 */
function maybeAcquire(state: GameState, carrierId: CarrierId, cfg: Archetype, rng: Rng): GameState {
  if (!cfg.acquisitive) return state;
  const buyer = getCarrier(state, carrierId);
  // One deal at a time: a carrier still digesting its last acquisition does not
  // reach for another. This alone stops a roll-up swallowing the whole field.
  if (buyer.integrationUntil !== null && buyer.integrationUntil > state.turn) return state;

  // Merger review. Once the board is down to a handful of carriers the competition
  // authority blocks any further deal, which is what stops a long game consolidating
  // to a single survivor (§9). The player is exempt — clearing the board is one of
  // their win conditions.
  /*
   * Counted by effective control, not by the company register.
   *
   * The floor used to count solvent carriers, which is the same thing only while
   * consolidation happens by MERGER. Once a carrier can hold a majority of another
   * and simply keep it — and direct its treasury at a third — a field of ten where
   * one house commands four of them is a field of six as far as competition goes,
   * and the register still reads ten. Reviewing deals against the register would
   * let a pyramid consolidate the board without ever tripping a review, because a
   * pyramid never merges anything. Nobody is exploiting this today (measured: no AI
   * carrier controls two others, because it merges the moment it can) — this closes
   * it before the roll-up is taught to build one.
   */
  const commanded = new Set<CarrierId>();
  for (const c of state.carriers) {
    if (c.bankruptTurn !== null) continue;
    for (const owned of controlledBy(state, c)) commanded.add(owned.id);
  }
  const field = state.carriers.filter(
    (c) => c.bankruptTurn === null && !commanded.has(c.id),
  ).length;
  if (field - 1 < CONSTANTS.finance.minCarriersAfterMerger) return state;

  // Cheap early-out — the common case. With no stake in play and no new-campaign
  // roll this quarter there is nothing to do, so skip the whole scan (this runs for
  // every acquisitive carrier every turn on fields of hundreds of routes).
  const hasStakes = Object.keys(buyer.holdings).length > 0;
  const stock = difficultyMods(state.difficulty).stockActivity;
  const opening = rng.chance(CONSTANTS.finance.dealChancePerQuarter * (cfg.acquisitionAppetite ?? 1) * stock);
  if (!hasStakes && !opening) return state;

  const withRoutes = new Set(state.routes.map((r) => r.carrierId));
  // A stake can be built in anyone flying, the player included. Folding a target
  // in outright is rival-only, though — a controlled PLAYER is seized through the
  // hostile-takeover path in the engine, not merged here.
  const stakeable = (t: Carrier): boolean => t.bankruptTurn === null && withRoutes.has(t.id);
  const foldable = (t: Carrier): boolean => stakeable(t) && !t.isPlayer;
  const stake = (t: Carrier): number => (buyer.holdings[t.id] ?? 0) / t.shares;

  // 1. Any RIVAL it already controls, fold in — the payoff, funded with debt where
  //    cash falls short (half its headroom, so a buyout never max-levers it).
  const owned = hasStakes ? state.carriers.find((t) => foldable(t) && controls(buyer, t)) : undefined;
  if (owned) {
    const cost = acquisitionCost(state, buyer, owned);
    // The deal assumes the target's debt as well as buying its shares — see the
    // enterprise-value test in ACQUIRE_CARRIER. Weighing only the share price let
    // a rival lever itself into insolvency on a cheap, heavily indebted carrier.
    if (buyer.cash + borrowingCapacity(state, buyer) * 0.5 >= cost + Math.max(0, owned.debt)) {
      const res = applyAction(state, { type: 'ACQUIRE_CARRIER', carrierId, targetId: owned.id, withDebt: true });
      return res.ok ? res.state : state;
    }
    return state; // hold the controlling stake until it can fund the rest
  }

  // 2. Continue any raid already under way — committed, even if the target's
  //    earnings have ticked up since (you do not abandon a half-built stake).
  let target = hasStakes
    ? state.carriers
        .filter((t) => t.id !== carrierId && stakeable(t) && stake(t) > 0)
        .sort((a, b) => stake(b) - stake(a))[0]
    : undefined;

  // 3. Or, now and then, open a new campaign on the cheapest weak bolt-on:
  //    underperforming (poor return on its own value, or losing money) and well
  //    under the buyer's size, so healthy rivals — and a strong player — stay off
  //    the menu (§9). The player is fair game only once it is genuinely weak.
  if (!target) {
    if (!opening) return state;
    const buyerCap = marketCap(state, buyer);
    const ceiling = buyerCap * CONSTANTS.finance.acquisitionMaxTargetFraction;
    let cheapest: Carrier | null = null;
    let cheapestCap = Infinity;
    for (const t of state.carriers) {
      if (t.id === carrierId || !stakeable(t)) continue;
      const cap = marketCap(state, t);
      if (cap <= 0 || cap > ceiling || cap >= cheapestCap) continue;
      if (trailingEarnings(state, t.id) >= cap * CONSTANTS.finance.acquisitionWeakReturn) continue;
      cheapest = t;
      cheapestCap = cap;
    }
    target = cheapest ?? undefined;
  }
  if (!target) return state;

  // Buy a quarter's slice, from cash above the reserve — and, mid-raid, borrow the
  // shortfall (bounded by half its headroom) to keep the campaign moving. Debt to
  // buy control is exactly what makes a roll-up powerful and fragile.
  let s = state;
  const price = sharePrice(s, target);
  const chunkCost = target.shares * CONSTANTS.finance.stakePurchaseCapPerQuarter * price;
  const cashAvail = buyer.cash - cfg.reserveCash;
  if (cashAvail < chunkCost) {
    const need = Math.min(chunkCost - Math.max(0, cashAvail), borrowingCapacity(s, buyer) * 0.5);
    if (need > 0) {
      const borrowed = applyAction(s, { type: 'BORROW', carrierId, amount: need });
      if (borrowed.ok) s = borrowed.state;
    }
  }
  const funds = getCarrier(s, carrierId).cash - cfg.reserveCash;
  if (funds <= 0) return state;
  const res = applyAction(s, { type: 'BUY_SHARES', carrierId, targetId: target.id, amount: funds });
  return res.ok ? res.state : state;
}

/**
 * An opportunistic minority stake. A cash-rich carrier that is NOT a roll-up puts
 * surplus money to work in a profitable rival — or in the player. Unlike the
 * roll-up's campaign this stays below the control threshold: an investment and a
 * signal, not a takeover. It is what makes the share register a live market rather
 * than a formality, and it means a strong player draws real interest in its shares
 * (pillar 4 — success attracts sharks). Only the roll-up pushes a stake to control.
 */
function maybeTakeStake(state: GameState, carrierId: CarrierId, cfg: Archetype, rng: Rng): GameState {
  if (cfg.acquisitive) return state; // the roll-up runs its own, harder campaign
  const buyer = getCarrier(state, carrierId);
  if (buyer.bankruptTurn !== null) return state;
  // Difficulty drives the whole M&A layer: on hard, carriers speculate more often
  // and let their cash run lower to do it — a feeding frenzy; on easy, a quiet register.
  const stock = difficultyMods(state.difficulty).stockActivity;
  // Only surplus above the operating reserve is put into stock — the bar drops as
  // the stock market heats up, so more carriers qualify to buy.
  const surplus = buyer.cash - (cfg.reserveCash * CONSTANTS.finance.stakeReserveMultiple) / stock;
  if (surplus <= 0) return state;
  if (!rng.chance(CONSTANTS.finance.stakeInterestPerQuarter * stock)) return state;

  const ceiling = CONSTANTS.finance.stakeCeiling;
  const withRoutes = new Set(state.routes.map((r) => r.carrierId));
  // Single pass — marketCap and trailingEarnings are dear, so each is read at most
  // once per candidate. A worthwhile position: solvent, flying, profitable, and not
  // already held up to the financial ceiling. The player is fair game.
  let best: Carrier | null = null;
  let bestYield = 0;
  for (const t of state.carriers) {
    if (t.id === carrierId || t.bankruptTurn !== null || !withRoutes.has(t.id)) continue;
    if ((buyer.holdings[t.id] ?? 0) / t.shares >= ceiling) continue;
    const te = trailingEarnings(state, t.id);
    if (te <= 0) continue;
    const cap = marketCap(state, t);
    if (cap <= 0) continue;
    const yield_ = te / cap; // best value first: most earnings per dollar of cap
    if (yield_ > bestYield) {
      bestYield = yield_;
      best = t;
    }
  }
  if (!best) return state;

  const price = sharePrice(state, best);
  if (price <= 0) return state;
  // Spend the surplus, but never buy past the financial ceiling — the per-quarter
  // slice is capped again inside BUY_SHARES.
  const roomShares = Math.max(0, ceiling * best.shares - (buyer.holdings[best.id] ?? 0));
  const spend = Math.min(surplus, roomShares * price);
  if (spend <= 0) return state;
  const res = applyAction(state, { type: 'BUY_SHARES', carrierId, targetId: best.id, amount: spend });
  return res.ok ? res.state : state;
}

/**
 * A house spends its subsidiaries' treasuries on the campaign it is already running.
 *
 * This is the pyramid from the other side of the table, and without it the whole
 * structure was a lever only the player could pull: command a treasury at a fraction
 * of the exposure, keep buying with money that is not yours, and no rival can answer
 * — `maybeDefend` only dilutes, and gives up entirely once a raider is past the
 * control threshold. A power the AI cannot use is not a strategy, it is a cheat code
 * with extra steps.
 *
 * Deliberately its own step rather than part of `maybeAcquire`, for two reasons that
 * both bit a first attempt. The merger review returns early once the field is at the
 * antitrust floor — but buying shares is not a merger, and the moment a house is
 * blocked from folding anything in is exactly the moment its subsidiaries persist
 * and matter. And it cannot live in `maybeTakeStake`, which returns immediately for
 * acquisitive carriers and caps everyone else at 40%, below the control line: that
 * version was correct code in the one function that can never have a subsidiary to
 * spend, and measured 0 pyramids in 20 games.
 *
 * Narrow on purpose. A subsidiary spends only its surplus over the same reserve its
 * parent keeps, and buys the target its parent is ALREADY accumulating — no second
 * search, because the point is concentrating a house's buying power rather than
 * giving every subsidiary its own brain.
 */
export function maybeDirectSubsidiaries(
  state: GameState,
  carrierId: CarrierId,
  cfg: Archetype,
): GameState {
  const parent = getCarrier(state, carrierId);
  if (parent.bankruptTurn !== null) return state;
  const subs = controlledBy(state, parent).filter((c) => !c.isPlayer);
  if (subs.length === 0) return state;

  // The campaign already under way: the biggest stake it holds that is not yet
  // control. Nothing under way means nothing for a subsidiary to reinforce.
  let target: Carrier | null = null;
  let bestStake = 0;
  for (const t of state.carriers) {
    if (t.id === carrierId || t.bankruptTurn !== null || t.shares <= 0) continue;
    const held = (parent.holdings[t.id] ?? 0) / t.shares;
    if (held <= 0 || held > CONSTANTS.finance.controlThreshold) continue;
    if (held > bestStake) {
      bestStake = held;
      target = t;
    }
  }
  if (!target) return state;

  let next = state;
  for (const sub of subs) {
    if (sub.id === target.id) continue; // never buy into itself
    const live = getCarrier(next, sub.id);
    const spare = live.cash - cfg.reserveCash;
    if (spare <= 0) continue;
    const price = sharePrice(next, target);
    if (price <= 0) continue;
    const held = live.holdings[target.id] ?? 0;
    const room = Math.max(0, CONSTANTS.finance.stakeCeiling * target.shares - held);
    const outlay = Math.min(spare, room * price);
    if (outlay <= 0) continue;
    const res = applyAction(next, {
      type: 'DIRECT_BUY_SHARES',
      controllerId: carrierId,
      buyerId: sub.id,
      targetId: target.id,
      amount: outlay,
    });
    if (res.ok) next = res.state;
  }
  return next;
}

/**
 * A board fights a hostile raid while control is still in the balance. Once an
 * OUTSIDE holder's stake reaches the defence threshold — heading for control — the
 * carrier issues equity to dilute them, turning a quiet accumulation into a war of
 * attrition. It costs the carrier its own dilution but raises cash to fight with,
 * and it stops anyone (the player included) quietly ending up owning the whole
 * field. Not every quarter, so a determined raider still makes progress — it just
 * pays for every point. But once a raider is PAST control the board is theirs, and
 * it will not issue stock to dilute its own controller: the fight is over.
 */
export function maybeDefend(state: GameState, carrierId: CarrierId, rng: Rng): GameState {
  const carrier = getCarrier(state, carrierId);
  if (carrier.shares <= 0) return state;
  let topRaider = 0;
  for (const holder of state.carriers) {
    if (holder.id === carrierId) continue;
    topRaider = Math.max(topRaider, (holder.holdings[carrierId] ?? 0) / carrier.shares);
  }
  if (topRaider < CONSTANTS.finance.takeoverDefenseThreshold) return state;
  if (topRaider > CONSTANTS.finance.controlThreshold) return state; // controlled — no self-dilution
  if (!rng.chance(CONSTANTS.finance.takeoverDefenseChance)) return state;
  const amount = marketCap(state, carrier) * CONSTANTS.finance.maxEquityRaiseFraction;
  const res = applyAction(state, { type: 'ISSUE_EQUITY', carrierId, amount });
  return res.ok ? res.state : state;
}

export function decideRival(state: GameState, carrierId: CarrierId, rng: Rng): GameState {
  const carrier = getCarrier(state, carrierId);
  if (carrier.bankruptTurn !== null || !carrier.archetypeId) return state;
  const cfg = effectiveConfig(plannedRival(state, carrierId), state.difficulty);

  let s = maybeHedge(state, carrierId);
  s = maybeDefend(s, carrierId, rng);
  s = maybeInvestInTech(s, carrierId, cfg);
  s = maybeAcquire(s, carrierId, cfg, rng);
  s = maybeDirectSubsidiaries(s, carrierId, cfg);
  s = maybeTakeStake(s, carrierId, cfg, rng);
  s = maybeBorrow(s, carrierId, cfg);
  s = renewFleet(s, carrierId, cfg);
  s = releaseIdle(s, carrierId);

  let index = marketIndex(s);
  s = repriced(s, index, carrierId, cfg);
  s = pruneLosers(s, marketIndex(s), carrierId, cfg);
  index = marketIndex(s);

  if (getCarrier(s, carrierId).cash < cfg.reserveCash) return retreat(s, index, carrierId);

  /*
   * How many growth moves this carrier may make this quarter.
   *
   * This is the PACE of the field, and it is a separate thing from `aggression`.
   * Aggression only lowers the bar a move has to clear; it cannot make a carrier
   * move twice. With a hard ceiling of one move per quarter, a harsher world made
   * rivals expand SLOWER — thinner demand meant more turns failed the bar, against
   * an unchanged ceiling — so hard opened fewer routes than easy and put less
   * metal on them, which is exactly backwards.
   *
   * Each pass is judged against the board the previous pass just changed, and the
   * loop stops the moment cash runs short or nothing clears the bar. A big number
   * buys a fast field, not a reckless one.
   */
  /*
   * How fast a carrier may grow is set by the money behind it, not by a quota.
   *
   * This was a flat count — every carrier got the same number of moves a quarter
   * whatever its balance sheet. Measured, that was the binding constraint on the
   * whole field: across 703 carrier-quarters where a rival sat on more than $150M,
   * **700 had a profitable move already identified** and only 3 had nothing worth
   * doing — and 653 of those 700 were stopped by the quota rather than by any cash
   * gate. The median pile was $250M. The rivals were not playing badly; they were
   * rate-limited, which is also why every behavioural knob tried against them
   * measured flat while raising this count was the one change that moved anything.
   *
   * Now a carrier reckons what it can commit — cash above its own reserve, divided
   * by what one sector and its aeroplane tie up — and difficulty scales the
   * appetite rather than the allowance. A house with $400M expands like one with
   * $400M; a house with $40M still gets its one move, because the loop below
   * already refuses anything it cannot fund or that fails to clear its bar.
   */
  const deployable = Math.max(0, getCarrier(s, carrierId).cash - cfg.reserveCash);
  const funded = Math.floor(deployable / CONSTANTS.ai.capitalPerGrowthMove)
    * difficultyMods(s.difficulty).growthActions;
  const passes = Math.max(
    1,
    Math.min(CONSTANTS.ai.maxGrowthMovesPerQuarter, Math.round(funded)),
  );
  for (let pass = 0; pass < passes; pass++) {
    const cash = getCarrier(s, carrierId).cash;
    if (cash < cfg.reserveCash || cash < expansionBar(s, carrierId, cfg)) break;

    // Three ways to grow: a virgin sector, more metal on one it flies, or muscling
    // into a market someone else has proven. Whichever projects best wins.
    const fresh = bestNewSector(s, index, carrierId, cfg);
    const raid = bestIncursion(s, index, carrierId, cfg);
    const more = bestReinforcement(s, index, carrierId, cfg);

    const before = s;
    const options: { value: number; act: () => GameState }[] = [];
    if (fresh) options.push({ value: fresh.score, act: () => openSector(before, carrierId, fresh, cfg) });
    if (raid) options.push({ value: raid.score, act: () => openSector(before, carrierId, raid, cfg) });
    if (more) options.push({ value: more.gain, act: () => equip(before, carrierId, more.typeId, more.route.id, cfg) });

    /*
     * A carrier with more than one move a quarter spends its FIRST on contesting
     * someone, if any contest clears its bar.
     *
     * Ranking a raid against a virgin sector on projected profit alone means the
     * raid essentially never wins: an empty market is worth more than a shared
     * one by construction, and the harder the setting the truer that gets, because
     * contestPressure makes a contested route emptier. Scaling the raid's score
     * cannot fix it either — measured, playerFocus 1.9 -> 3.0 -> 4.5 moved the
     * share of games where anyone was on the player's markets by nothing at all.
     *
     * So the appetite gets a slot rather than a multiplier. A rival that can only
     * move once a quarter (easy, medium) is unaffected and still takes its best
     * option; a hard-setting carrier opens the quarter by picking a fight and
     * spends what is left growing.
     */
    let pick = options.sort((a, b) => b.value - a.value)[0];
    /*
     * A carrier is limited by AIRCRAFT, not by demand, so on pure projected cash a
     * thin monopoly beats a share of a dense market almost every time — which is
     * why 97.9% of served markets held exactly one carrier. Real trunk routes carry
     * three to five airlines precisely because the strategic value of being ON them
     * exceeds the cash difference against some quiet pair nobody contests.
     *
     * So a carrier with moves to spare spends its first TWO on contesting, when a
     * contest clears its bar and is worth at least a third of the best alternative.
     * Under a third and it is a genuinely bad fight, which is a different thing from
     * a cheaper one — reserving the slot for ANY viable raid cost the field two
     * carriers over a run.
     */
    const worthTheFight =
      raid !== null &&
      raid.score >= cfg.minProjectedNetPerQuarter &&
      raid.score >= (pick?.value ?? 0) * 0.35;
    if (pass < 2 && passes > 1 && raid && worthTheFight) {
      pick = { value: raid.score, act: () => openSector(before, carrierId, raid, cfg) };
    }
    if (!pick || pick.value < cfg.minProjectedNetPerQuarter) break;
    s = pick.act();
    // The move just made changed who is on which market; the next pass has to see
    // that, or a carrier would open the same sector twice over.
    index = marketIndex(s);
  }
  return s;
}

/** Every rival takes its turn, in roster order for determinism. */
export function runRivals(state: GameState, rng: Rng): GameState {
  let s = admitRival(state, rng);
  s = maybeSpawnEntrant(s, rng);
  for (const rival of s.rivalPlan) {
    if (!s.enteredRivals.includes(rival.id)) continue;
    if (!s.carriers.some((c) => c.id === rival.id)) continue;
    s = decideRival(s, rival.id, rng);
  }
  return s;
}
