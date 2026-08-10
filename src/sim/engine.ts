/**
 * Turn resolution. The only two entry points into the sim are `applyAction` and
 * `endTurn`; both take a state and return a new one. The UI never mutates state.
 *
 * All balance figures live in constants.json — this file must stay free of magic
 * numbers (enforced by tests/purity.test.ts). The quarter's arithmetic lives in
 * economics.ts; here we only orchestrate.
 */
import type {
  Action,
  ActionResult,
  Aircraft,
  Carrier,
  CarrierId,
  CityId,
  Difficulty,
  GameState,
  QuarterResult,
  Route,
  TailId,
} from './types.ts';
import { Rng } from './rng.ts';
import { cityDistanceKm, getCity, hasCity, CONSTANTS, difficultyMods } from './world.ts';
import {
  aircraftAvailable, ageYears, canReach, deliveryQuarters, getAircraftType, hasAircraftType,
  leaseBreakFee, overhaulCost, rollAircraftIntro,
} from './fleet.ts';
import {
  buildMarketIndex, computeCarrierQuarter, computeRouteEconomics, feedFactor, marketKey,
  openingCostFor, rivalCapacityOf, rivalsOf, stationOverheadFor,
} from './economics.ts';
import {
  drawEvent, eventGroup, isCrisisActive, pruneEffects, rollCompletion, scheduledEvent, walkFuelPrice,
} from './events.ts';
import {
  acquisitionCost, borrowingCapacity, commands, controls, dominancePressure, equity,
  equityIssueDiscount, equityRaiseCeiling, marketCap, money, sharePrice, trailingEarnings,
} from './market.ts';
import { conditionsFor, klassesOf, marketFuelPrice } from './conditions.ts';
import { seasonalDemandFactor } from './demand.ts';
import { getTechNode, hasTechNode, landDeliveries, techStatus } from './tech.ts';
import { getArchetype, planRivals, runRivals } from './ai/archetype.ts';

export const SCHEMA_VERSION = 16;

/**
 * Copy-on-write clone for the action path.
 *
 * Only three things are ever mutated in place: a carrier, a tail in its fleet,
 * and a route. Everything else — history, the rival plan, the entered-rival list
 * — is replaced wholesale rather than edited, so those arrays can be shared with
 * the previous state instead of copied.
 *
 * This used to be `structuredClone`, which deep-copied the entire game including
 * a history that grows to hundreds of quarterly records. With rivals each taking
 * several actions a turn, that single call was 74% of a headless game's runtime.
 *
 * INVARIANT: never mutate `history`, `rivalPlan` or `enteredRivals` in place.
 * Assign a fresh array instead. tests/purity.test.ts enforces this.
 */
function clone(state: GameState): GameState {
  return {
    ...state,
    carriers: state.carriers.map((c) => ({
      ...c,
      fleet: c.fleet.map((a) => ({ ...a })),
      // tech, techInProgress and hedge are always replaced wholesale, never
      // edited, so they can be shared like history and the rival plan.
    })),
    routes: state.routes.map((r) => ({ ...r })),
  };
}

function routeId(carrierId: CarrierId, from: CityId, to: CityId): string {
  // City pair is unordered — a route is a market, not a direction.
  const [a, b] = from < to ? [from, to] : [to, from];
  return `${carrierId}:${a}-${b}`;
}

export interface NewGameOptions {
  readonly scenario?: 'present' | 'history';
  readonly difficulty?: Difficulty;
}

export function newGame(
  seed: number,
  playerHomeCityId: CityId,
  playerName = 'Air Honcho',
  options: NewGameOptions = {},
): GameState {
  const scenario = options.scenario ?? 'present';
  const difficulty = options.difficulty ?? 'medium';
  const mods = difficultyMods(difficulty);
  const { startYear, horizonTurns } = CONSTANTS.scenarios[scenario];
  if (!hasCity(playerHomeCityId)) throw new Error(`Unknown home city: ${playerHomeCityId}`);

  const player: Carrier = {
    id: 'player',
    name: playerName,
    isPlayer: true,
    color: '#1b3a6b',
    homeCityId: playerHomeCityId,
    archetypeId: null,
    cash: CONSTANTS.game.startingCash * mods.startingCash,
    fleet: [],
    tech: [],
    techInProgress: [],
    hedge: null,
    transferredThisQuarter: 0,
    bankruptTurn: null,
    shares: CONSTANTS.finance.startingShares,
    debt: 0,
    holdings: {},
    stakeBought: {},
    dividend: 0,
    integrationUntil: null,
    acquiredBy: null,
    bailouts: 0,
  };

  return {
    schemaVersion: SCHEMA_VERSION,
    seed,
    rngState: Rng.fromSeed(seed).save(),
    seq: 0,
    turn: 0,
    fuelPrice: CONSTANTS.game.startingFuelPricePerL,
    baseCompletion: CONSTANTS.events.completionMean,
    events: [],
    distressed: [],
    playerCarrierId: player.id,
    // Dealt from a stream derived from the seed, so planning the cast does not
    // perturb the main RNG the quarters run on.
    scenario,
    difficulty,
    startYear,
    horizonTurns,
    rivalPlan: planRivals(Rng.fromSeed(seed ^ 0x9e3779b9), difficulty),
    enteredRivals: [],
    carriers: [player],
    routes: [],
    history: [],
    playerPeakEquity: player.cash,
    aircraftIntro: rollAircraftIntro(seed, startYear),
    gameOver: null,
  };
}

export function getCarrier(state: GameState, id: CarrierId): Carrier {
  const carrier = state.carriers.find((c) => c.id === id);
  if (!carrier) throw new Error(`Unknown carrier: ${id}`);
  return carrier;
}

export function findTail(carrier: Carrier, tailId: TailId): Aircraft | undefined {
  return carrier.fleet.find((a) => a.id === tailId);
}

function reject(state: GameState, error: string): ActionResult {
  return { state, ok: false, error };
}

export function applyAction(state: GameState, action: Action): ActionResult {
  if (state.gameOver) return reject(state, 'The game has ended.');

  switch (action.type) {
    case 'OPEN_ROUTE': {
      const { carrierId, from, to } = action;
      if (from === to) return reject(state, 'A route needs two different cities.');
      if (!hasCity(from) || !hasCity(to)) return reject(state, 'Unknown city.');

      const distance = cityDistanceKm(from, to);
      if (distance < CONSTANTS.routes.minDistanceKm) {
        return reject(
          state,
          `${getCity(from).name}–${getCity(to).name} is only ${Math.round(distance)} km; ` +
            `the ground wins below ${CONSTANTS.routes.minDistanceKm} km.`,
        );
      }

      const id = routeId(carrierId, from, to);
      // Guard by market, not by id: a route absorbed in an acquisition keeps the
      // old owner's id prefix, so an id check alone would let the carrier open a
      // second route on a market it already serves.
      const market = marketKey(from, to);
      if (state.routes.some((r) => r.carrierId === carrierId && marketKey(r.from, r.to) === market)) {
        return reject(state, 'You already fly this route.');
      }

      const carrier = getCarrier(state, carrierId);
      // Station-aware: a city this carrier has never served costs what it costs to
      // stand a station up there, so opening away from the network is a real
      // commitment rather than a rounding error against one quarter's profit.
      const cost = openingCostFor(state.routes, carrier, from, to);
      if (carrier.cash < cost) {
        const millions = (cost / 1e6).toFixed(1);
        return reject(
          state,
          `Opening ${getCity(from).name}–${getCity(to).name} costs $${millions}M — ` +
            'more cash than you have. Sectors between cities you already serve cost far less.',
        );
      }

      const next = clone(state);
      getCarrier(next, carrierId).cash -= cost;
      next.routes.push({ id, carrierId, from, to, posture: 'match', openedTurn: state.turn });
      return { state: next, ok: true };
    }

    case 'CLOSE_ROUTE': {
      const route = state.routes.find((r) => r.id === action.routeId);
      if (!route) return reject(state, 'No such route.');
      const next = clone(state);
      // Park any tails that were flying it before the route disappears.
      for (const tail of getCarrier(next, route.carrierId).fleet) {
        if (tail.routeId === action.routeId) tail.routeId = null;
      }
      next.routes = next.routes.filter((r) => r.id !== action.routeId);
      return { state: next, ok: true };
    }

    case 'SET_POSTURE': {
      const next = clone(state);
      const route = next.routes.find((r) => r.id === action.routeId);
      if (!route) return reject(state, 'No such route.');
      route.posture = action.posture;
      return { state: next, ok: true };
    }

    case 'ACQUIRE_AIRCRAFT': {
      const { carrierId, typeId, ownership } = action;
      if (!hasAircraftType(typeId)) return reject(state, 'Unknown aircraft type.');
      const type = getAircraftType(typeId);
      if (!aircraftAvailable(state, typeId)) {
        return reject(state, `The ${type.name} has not entered service yet.`);
      }
      const carrier = getCarrier(state, carrierId);

      /*
       * A wound-up carrier's fleet, going cheap while the estate is selling.
       *
       * Buying from it is a purchase, not a lease — the estate wants cash, not a
       * lessee — and the aircraft is already built, so it arrives NOW rather than
       * after the usual build slot. That immediacy is most of the appeal: a rival
       * folding is a chance to grow faster than the order book allows.
       */
      const lot = action.distressed === true
        ? (state.distressed ?? []).find((l) => l.typeId === typeId && l.count > 0)
        : undefined;
      if (action.distressed === true && !lot) {
        return reject(state, `That distressed lot has been sold or the estate has dispersed it.`);
      }
      if (lot && ownership !== 'owned') {
        return reject(state, 'A distressed fleet is sold outright — the estate is not writing leases.');
      }

      const upfront = lot
        ? type.price * lot.priceFraction
        : ownership === 'owned' ? type.price : type.leaseMonthly * CONSTANTS.fleet.leaseDepositMonths;
      if (carrier.cash < upfront) {
        return reject(
          state,
          ownership === 'owned'
            ? `Buying a ${type.name} costs more cash than you hold.`
            : `You can't cover the lease deposit on a ${type.name}.`,
        );
      }
      // Lessors will not extend unlimited leases against a thin balance sheet.
      // Total annual lease commitments are capped at a multiple of equity.
      if (ownership === 'leased') {
        const annualLease = (tail: { typeId: string; ownership: string }): number =>
          tail.ownership === 'leased' ? getAircraftType(tail.typeId).leaseMonthly * 12 : 0;
        const committed = carrier.fleet.reduce((sum, t) => sum + annualLease(t), 0);
        const cap = CONSTANTS.finance.maxLeaseToEquity * Math.max(0, equity(state, carrier));
        if (committed + type.leaseMonthly * 12 > cap) {
          return reject(
            state,
            `Lessors won't extend more lease credit against your balance sheet — ` +
              `you are at the limit of what your equity supports. Grow your equity or buy.`,
          );
        }
      }

      const next = clone(state);
      const buyer = getCarrier(next, carrierId);
      buyer.cash -= upfront;
      next.seq += 1;
      if (lot) {
        const claim = (next.distressed ?? []).find(
          (l) => l.typeId === lot.typeId && l.untilTurn === lot.untilTurn && l.fromName === lot.fromName,
        );
        if (claim) claim.count -= 1;
      }
      buyer.fleet.push({
        id: `AC-${next.seq}`,
        typeId,
        ownership,
        acquiredTurn: state.turn,
        // Already built: an aircraft out of an estate flies the quarter you buy it.
        deliversTurn: lot ? state.turn : state.turn + deliveryQuarters(type),
        bookValue: ownership === 'owned' ? (lot ? upfront : type.price) : 0,
        routeId: null,
      });
      return { state: next, ok: true };
    }

    case 'DISPOSE_AIRCRAFT': {
      const carrier = getCarrier(state, action.carrierId);
      const tail = findTail(carrier, action.tailId);
      if (!tail) return reject(state, 'No such aircraft.');

      const type = getAircraftType(tail.typeId);
      const breakFee =
        tail.ownership === 'leased' ? leaseBreakFee(type, tail.acquiredTurn, state.turn) : 0;
      if (breakFee > carrier.cash) {
        return reject(
          state,
          `That ${type.name} is still inside its lease term; the break fee is more cash than you hold.`,
        );
      }

      const next = clone(state);
      const owner = getCarrier(next, action.carrierId);
      const target = findTail(owner, action.tailId)!;
      if (target.ownership === 'owned') {
        owner.cash += target.bookValue * CONSTANTS.fleet.saleValueFraction;
      } else {
        owner.cash -= breakFee;
      }
      owner.fleet = owner.fleet.filter((a) => a.id !== action.tailId);
      return { state: next, ok: true };
    }

    case 'OVERHAUL_AIRCRAFT': {
      const carrier = getCarrier(state, action.carrierId);
      const tail = findTail(carrier, action.tailId);
      if (!tail) return reject(state, 'No such aircraft.');
      if (tail.ownership !== 'owned') {
        return reject(state, 'Only aircraft you own can be overhauled; a lessor handles its own.');
      }
      // An airframe whose clock is already at zero has nothing to reset, so a
      // second visit is a full maintenance bill for no gain whatsoever. The rule
      // lives here rather than only on the button: the sim owns what is legal.
      if (ageYears(tail, state.turn) <= 0) {
        return reject(
          state,
          `That ${getAircraftType(tail.typeId).name} is freshly overhauled — there is nothing to reset.`,
        );
      }
      const cost = overhaulCost(getAircraftType(tail.typeId));
      if (carrier.cash < cost) return reject(state, 'Not enough cash for a heavy maintenance visit.');

      const next = clone(state);
      const owner = getCarrier(next, action.carrierId);
      owner.cash -= cost;
      findTail(owner, action.tailId)!.overhauledTurn = state.turn;
      return { state: next, ok: true };
    }

    case 'ASSIGN_AIRCRAFT': {
      const carrier = getCarrier(state, action.carrierId);
      const tail = findTail(carrier, action.tailId);
      if (!tail) return reject(state, 'No such aircraft.');
      const route = state.routes.find((r) => r.id === action.routeId);
      if (!route || route.carrierId !== action.carrierId) return reject(state, 'No such route.');

      const type = getAircraftType(tail.typeId);
      const distance = cityDistanceKm(route.from, route.to);
      if (!canReach(type, distance)) {
        return reject(
          state,
          `A ${type.name} can't reach ${getCity(route.to).name} — ${Math.round(distance)} km ` +
            `exceeds its ${type.rangeKm.toLocaleString('en-US')} km range.`,
        );
      }

      const flying = carrier.fleet.filter((a) => a.routeId === route.id).length;
      if (flying >= CONSTANTS.routes.maxAircraftPerRoute) {
        return reject(state, `A sector takes at most ${CONSTANTS.routes.maxAircraftPerRoute} aircraft.`);
      }

      const next = clone(state);
      findTail(getCarrier(next, action.carrierId), action.tailId)!.routeId = action.routeId;
      return { state: next, ok: true };
    }

    case 'HEDGE_FUEL': {
      const { carrierId, fraction } = action;
      const max = CONSTANTS.events.hedgeMaxFraction;
      if (!(fraction > 0) || fraction > max) {
        return reject(state, `You can lock between nothing and ${Math.round(max * 100)}% of next year's fuel.`);
      }
      const holder = getCarrier(state, carrierId);
      if (holder.hedge && state.turn < holder.hedge.untilTurn) {
        return reject(state, 'A hedge is already running; it has to expire before you write another.');
      }
      const next = clone(state);
      // The counterparty charges a premium over spot to carry the risk, so a
      // hedge is insurance rather than a free bet on the price going up.
      //
      // Priced off the MARKET price, not the bare walk. A running fuel event is
      // part of what the world is trading at, and the counterparty can see it
      // too. Pricing off `state.fuelPrice` let a carrier wait for an oil spike
      // and only then buy fuel a third below the market — risk-free arbitrage
      // that inverted the mechanic, since a hedge is a bet made before you know.
      getCarrier(next, carrierId).hedge = {
        fraction,
        pricePerL: marketFuelPrice(state) * CONSTANTS.events.hedgePremium,
        untilTurn: state.turn + CONSTANTS.events.hedgeQuarters,
      };
      return { state: next, ok: true };
    }

    case 'START_TECH': {
      const { carrierId, nodeId } = action;
      if (!hasTechNode(nodeId)) return reject(state, 'No such program.');
      const node = getTechNode(nodeId);
      const carrier = getCarrier(state, carrierId);
      const status = techStatus(carrier, node);
      if (status === 'delivered') return reject(state, `${node.name} is already in service.`);
      if (status === 'in-progress') return reject(state, `${node.name} is already under way.`);
      if (status === 'locked') {
        return reject(state, `${node.name} needs ${getTechNode(node.requires!).name} first.`);
      }
      if (carrier.cash < node.cost) return reject(state, `Not enough cash to fund ${node.name}.`);

      const next = clone(state);
      const funder = getCarrier(next, carrierId);
      funder.cash -= node.cost;
      funder.techInProgress = [
        ...funder.techInProgress,
        { nodeId, completesTurn: state.turn + node.quarters },
      ];
      return { state: next, ok: true };
    }

    case 'UNASSIGN_AIRCRAFT': {
      const carrier = getCarrier(state, action.carrierId);
      if (!findTail(carrier, action.tailId)) return reject(state, 'No such aircraft.');
      const next = clone(state);
      findTail(getCarrier(next, action.carrierId), action.tailId)!.routeId = null;
      return { state: next, ok: true };
    }

    case 'BORROW': {
      const { carrierId, amount } = action;
      if (!(amount > 0)) return reject(state, 'Enter an amount to borrow.');
      const carrier = getCarrier(state, carrierId);
      const capacity = borrowingCapacity(state, carrier);
      if (amount > capacity + 1) {
        return reject(
          state,
          `Lenders will extend at most ${money(capacity)} more against your assets.`,
        );
      }
      const next = clone(state);
      const c = getCarrier(next, carrierId);
      c.cash += amount;
      c.debt += amount;
      return { state: next, ok: true };
    }

    case 'REPAY_DEBT': {
      const { carrierId, amount } = action;
      if (!(amount > 0)) return reject(state, 'Enter an amount to repay.');
      const carrier = getCarrier(state, carrierId);
      const pay = Math.min(amount, carrier.debt);
      if (pay <= 0) return reject(state, 'You have no debt to repay.');
      if (carrier.cash < pay) return reject(state, 'Not enough cash to repay that much.');
      const next = clone(state);
      const c = getCarrier(next, carrierId);
      c.cash -= pay;
      c.debt -= pay;
      return { state: next, ok: true };
    }

    case 'ISSUE_EQUITY': {
      const { carrierId, amount } = action;
      if (!(amount > 0)) return reject(state, 'Enter an amount to raise.');
      const carrier = getCarrier(state, carrierId);
      const price = sharePrice(state, carrier);
      if (price <= 0) return reject(state, 'Your shares are worthless; no one will buy an issue.');
      const fin = CONSTANTS.finance;
      // Authorized-share ceiling: like a real charter, only so many shares may ever
      // be issued. Cumulative issuance can't push past this fraction of the float,
      // so equity is a finite well — you can't print market cap forever, and a
      // raided board's defensive dilution eventually runs dry.
      const issued = carrier.issuedShares ?? 0;
      const headroomShares = (fin.authorizedIssuanceFraction * carrier.shares - issued) / (1 - fin.authorizedIssuanceFraction);
      if (headroomShares <= 0) {
        return reject(state, 'You have issued all your authorized shares; raising more would need a shareholder vote the board will not call.');
      }
      // Bound by both the per-quarter cap and the authorized headroom. Shared with
      // the treasury panel, which has to quote this same figure as its maximum —
      // two copies of a ceiling is how a dialog comes to promise what the engine
      // will not honour.
      const max = equityRaiseCeiling(state, carrier);
      if (amount > max + 1) {
        return reject(state, `You can raise at most ${money(max)} in new equity right now.`);
      }
      const next = clone(state);
      const c = getCarrier(next, carrierId);
      // New shares clear a little below market — an issue is never free money.
      // Priced by how big the raise is, not a flat haircut — see equityIssueDiscount.
      const newShares = amount / (price * equityIssueDiscount(amount, marketCap(state, carrier)));
      c.shares += newShares;
      c.issuedShares = issued + newShares;
      c.cash += amount;
      return { state: next, ok: true };
    }

    /*
     * A carrier you command buys into a third one, out of its own treasury.
     *
     * The whole appeal of a holding structure is that this is NOT your money: hold
     * a majority of A, have A take a majority of B, and you direct B while owning a
     * fraction of it. The permission is the only new rule — everything downstream is
     * the ordinary share purchase, so the per-quarter cap, the free float and the
     * price all behave exactly as they do when you buy for yourself.
     */
    case 'DIRECT_BUY_SHARES': {
      const { controllerId, buyerId, targetId, amount } = action;
      const controller = getCarrier(state, controllerId);
      const buyer = getCarrier(state, buyerId);
      if (controller.bankruptTurn !== null) return reject(state, 'Your airline has failed.');
      if (buyer.bankruptTurn !== null) return reject(state, `${buyer.name} has failed.`);
      if (!commands(state, controller, buyer)) {
        return reject(state, `You do not control ${buyer.name}, so you cannot spend its money.`);
      }
      if (buyerId === targetId) return reject(state, 'A carrier cannot buy its own shares here.');
      // Delegated verbatim: one implementation of what a share purchase is.
      return applyAction(state, { type: 'BUY_SHARES', carrierId: buyerId, targetId, amount });
    }

    /*
     * Cash moves between a controller and a carrier it commands.
     *
     * Pulling cash UP is the historical move and it is meant to be available — the
     * 1990 game made a whole strategy of looting a subsidiary's treasury. It is also
     * already priced without any special rule: cash sits in `standaloneEquity`, so a
     * dollar out of a subsidiary is a dollar off its equity and your holding falls by
     * your share of that. You keep the dollar; the minority holders eat their
     * fraction. That is the trick, correctly modelled, and it needs bounding rather
     * than balancing — hence a reserve the subsidiary keeps and a per-quarter cap.
     *
     * Pushing cash DOWN matters just as much: a subsidiary too poor to buy aircraft
     * is a subsidiary that never grows into the thing you bought it for.
     */
    case 'TRANSFER_CASH': {
      const { controllerId, fromId, toId, amount } = action;
      if (fromId === toId) return reject(state, 'Choose two different carriers.');
      if (!(amount > 0)) return reject(state, 'Enter an amount to move.');
      const controller = getCarrier(state, controllerId);
      const from = getCarrier(state, fromId);
      const to = getCarrier(state, toId);
      if (controller.bankruptTurn !== null) return reject(state, 'Your airline has failed.');
      if (from.bankruptTurn !== null || to.bankruptTurn !== null) {
        return reject(state, 'A failed carrier has no treasury to move.');
      }
      /*
       * DIRECT control, not command — and this is the line that makes the whole
       * structure honest.
       *
       * Command follows the chain, so you may direct a grandchild's investments.
       * Cash may not, and the reason is arithmetic rather than taste: a stake is
       * valued at the target's STANDALONE worth, which excludes what IT holds. So
       * your stake in A is priced without A's stake in B — B's value never reaches
       * your books at all — and draining B therefore cost you exactly nothing.
       * Measured: pulling $70M from a direct subsidiary moved equity +$28M, correctly
       * giving up your own 60% of what you took, while the same pull from a
       * GRANDCHILD moved it +$70M. Free money, repeatable every quarter, bounded
       * only by how much cash sat anywhere in the chain.
       *
       * Restricting cash to edges you directly own prices every transfer against a
       * holding you actually carry. It also says something true: a pyramid buys you
       * control cheaply and extracting the cash is the hard part, which is exactly
       * why the real ones ran on dividends, management fees and related-party deals
       * — and why regulators watch those and not the org chart.
       */
      const upward = toId === controllerId && controls(controller, from);
      const downward = fromId === controllerId && controls(controller, to);
      if (!upward && !downward) {
        const commanded = commands(state, controller, upward ? from : fromId === controllerId ? to : from);
        return reject(
          state,
          commanded
            ? 'You command that carrier through another one, but its cash belongs to its direct owner. Move it a step at a time, or own it outright.'
            : 'You can only move cash between your airline and one you control outright.',
        );
      }
      const fin = CONSTANTS.finance;
      const subsidiary = upward ? from : to;
      const cap = Math.max(0, subsidiary.cash) * fin.subsidiaryTransferCapPerQuarter;
      const moved = subsidiary.transferredThisQuarter ?? 0;
      const headroom = Math.max(0, cap - moved);
      if (headroom <= 0) {
        return reject(state, `${subsidiary.name} has moved its limit for this quarter.`);
      }
      // Pulling up leaves the subsidiary its reserve; pushing down is limited only
      // by what the controller actually holds.
      const available = upward
        ? Math.max(0, from.cash - fin.subsidiaryReserve)
        : Math.max(0, from.cash);
      const pay = Math.min(amount, headroom, available);
      if (pay <= 0) {
        return reject(
          state,
          upward
            ? `${from.name} must keep ${money(fin.subsidiaryReserve)} to keep flying.`
            : 'Not enough cash to move that much.',
        );
      }
      const next = clone(state);
      getCarrier(next, fromId).cash -= pay;
      getCarrier(next, toId).cash += pay;
      const sub = getCarrier(next, subsidiary.id);
      sub.transferredThisQuarter = moved + pay;
      return { state: next, ok: true };
    }

    case 'BUY_SHARES': {
      const { carrierId, targetId, amount } = action;
      if (carrierId === targetId) return reject(state, 'A carrier cannot buy its own shares here.');
      if (!(amount > 0)) return reject(state, 'Enter an amount to invest.');
      const buyer = getCarrier(state, carrierId);
      const target = getCarrier(state, targetId);
      if (target.bankruptTurn !== null) return reject(state, 'That carrier has failed.');
      const price = sharePrice(state, target);
      if (price <= 0) return reject(state, 'That carrier has no share value to buy.');
      if (buyer.cash < amount) return reject(state, 'Not enough cash for that stake.');
      const held = buyer.holdings[targetId] ?? 0;
      // Only the public float is for sale — shares no carrier already holds — so
      // the stakes across every carrier can never sum past the shares that exist.
      let heldByAll = 0;
      for (const c of state.carriers) heldByAll += c.holdings[targetId] ?? 0;
      const buyable = Math.max(0, target.shares - heldByAll);
      // No one may accumulate more than a set slice of a carrier a quarter — so a
      // controlling stake is built over several turns, in the open, not in a click.
      const boughtThisQuarter = buyer.stakeBought[targetId] ?? 0;
      const quarterCap = Math.max(0, target.shares * CONSTANTS.finance.stakePurchaseCapPerQuarter - boughtThisQuarter);
      if (quarterCap <= 0) {
        return reject(state, `You have bought your quarter's limit of ${target.name}. You can buy more next quarter.`);
      }
      const shares = Math.min(amount / price, buyable, quarterCap);
      if (shares <= 0) return reject(state, 'No shares available to buy.');
      const next = clone(state);
      const b = getCarrier(next, carrierId);
      b.cash -= shares * price;
      b.holdings = { ...b.holdings, [targetId]: held + shares };
      b.stakeBought = { ...b.stakeBought, [targetId]: boughtThisQuarter + shares };
      return { state: next, ok: true };
    }

    case 'SELL_SHARES': {
      const { carrierId, targetId, amount } = action;
      if (!(amount > 0)) return reject(state, 'Enter an amount to sell.');
      const seller = getCarrier(state, carrierId);
      const target = getCarrier(state, targetId);
      const held = seller.holdings[targetId] ?? 0;
      if (held <= 0) return reject(state, 'You hold no stake to sell.');
      const price = sharePrice(state, target);
      const shares = price > 0 ? Math.min(amount / price, held) : held;
      const next = clone(state);
      const s = getCarrier(next, carrierId);
      s.cash += shares * price;
      const remaining = held - shares;
      const holdings = { ...s.holdings };
      if (remaining >= 1) holdings[targetId] = remaining;
      else delete holdings[targetId];
      s.holdings = holdings;
      return { state: next, ok: true };
    }

    case 'BUY_BACK_STAKE': {
      // Greenmail: pay one shareholder a premium for their whole stake in you and
      // retire the shares. The surgical answer to a raid — expensive, and it makes
      // every OTHER holder's slice of the smaller company bigger.
      const { carrierId, holderId } = action;
      if (carrierId === holderId) return reject(state, 'A carrier cannot buy its stake back from itself.');
      const carrier = getCarrier(state, carrierId);
      const holder = getCarrier(state, holderId);
      const heldShares = holder.holdings[carrierId] ?? 0;
      if (heldShares <= 0) return reject(state, `${holder.name} holds none of your stock.`);
      const price = sharePrice(state, carrier);
      if (price <= 0) return reject(state, 'Your shares are worthless; there is nothing to buy back.');
      const cost = heldShares * price * CONSTANTS.finance.greenmailPremium;
      if (carrier.cash < cost) {
        return reject(state, `Buying out ${holder.name} would cost ${money(cost)} — more cash than you have.`);
      }
      const next = clone(state);
      const c = getCarrier(next, carrierId);
      const h = getCarrier(next, holderId);
      c.cash -= cost;
      h.cash += cost;
      const stripped = { ...h.holdings };
      delete stripped[carrierId];
      h.holdings = stripped;
      // Retired, not held: a company cannot own itself, and shares returned to the
      // float would simply let the raider buy back in at market having sold high.
      c.shares = Math.max(1, c.shares - heldShares);
      return { state: next, ok: true };
    }

    case 'SET_DIVIDEND': {
      const { carrierId, targetId, rate } = action;
      if (!(rate >= 0) || rate > CONSTANTS.finance.maxDividend) {
        return reject(state, 'That dividend is outside the permitted range.');
      }
      const setter = getCarrier(state, carrierId);
      const target = getCarrier(state, targetId);
      if (target.bankruptTurn !== null) return reject(state, 'That carrier has failed.');
      // You may set your own dividend, or that of a carrier you control.
      if (carrierId !== targetId && !controls(setter, target)) {
        return reject(state, `You must control ${target.name} — a majority stake — to set its dividend.`);
      }
      const next = clone(state);
      getCarrier(next, targetId).dividend = rate;
      return { state: next, ok: true };
    }

    case 'ACQUIRE_CARRIER': {
      const { carrierId, targetId, withDebt } = action;
      if (carrierId === targetId) return reject(state, 'A carrier cannot acquire itself.');
      const acquirer = getCarrier(state, carrierId);
      const target = getCarrier(state, targetId);
      if (target.bankruptTurn !== null) return reject(state, 'That carrier has already failed.');
      // A buyout is the culmination of a campaign, not an opening move: you must
      // already hold a controlling stake, built up over quarters, before you can
      // force the rest of the shares to sell.
      if (!controls(acquirer, target)) {
        return reject(state, `You must hold a controlling stake in ${target.name} before taking it over — keep buying its shares.`);
      }
      const cost = acquisitionCost(state, acquirer, target);
      /*
       * You must be able to carry the WHOLE enterprise, not just buy the equity.
       *
       * The merge assumes the target's debt in full, and this test used to weigh
       * only the price of its shares. A carrier deep in debt has a low market cap
       * — that is what the debt does to it — so it was cheap to buy and ruinous to
       * own, and nothing looked at the ruinous half. Observed: a carrier holding
       * $1.7bn in cash bought one, came out the far side owing $3.6bn, was
       * insolvent inside the quarter, and went straight into a restructuring that
       * wrote off 70% of the debt it had just taken on. Buying badly was a way to
       * shed debt.
       */
      const assumed = Math.max(0, target.debt);
      const fundable = acquirer.cash + (withDebt ? borrowingCapacity(state, acquirer) : 0);
      if (fundable < cost + assumed) {
        return reject(
          state,
          assumed > 0
            ? `Taking ${target.name} costs ${money(cost)} and assumes ${money(assumed)} of its debt; ` +
              `you can raise ${money(fundable)}${withDebt ? '' : ' in cash (try funding with debt)'}.`
            : `Taking ${target.name} costs ${money(cost)}; you can raise ${money(fundable)}${
                withDebt ? '' : ' in cash (try funding with debt)'
              }.`,
        );
      }
      return { state: mergeCarrier(clone(state), carrierId, targetId, withDebt), ok: true };
    }
  }
}

/**
 * Fold `targetId` into `carrierId`: pay out every other shareholder at the deal
 * price, move the target's routes, fleet, cash, debt and stakes across, and set
 * the acquirer's integration clock running. The target is marked acquired.
 */
function mergeCarrier(
  next: GameState,
  carrierId: CarrierId,
  targetId: CarrierId,
  withDebt: boolean,
): GameState {
  const acquirer = getCarrier(next, carrierId);
  const target = getCarrier(next, targetId);
  /*
   * The same figure `acquisitionCost` quotes, dominance premium included.
   *
   * That premium was added to the quote and not to the payment, so a dominant buyer
   * was TESTED against the higher price and CHARGED the lower one — the affordability
   * check and the till disagreeing, which is the same two-places-one-number fault
   * this file has now been bitten by three times. Minority holders are paid at the
   * raised price too, which is the point of it: they are the holdouts extracting it.
   */
  const dealValue = marketCap(next, target)
    * CONSTANTS.finance.acquisitionPremium
    * dominancePressure(next, acquirer);

  // Pay every OTHER carrier holding the target for their stake, at the deal price.
  for (const holder of next.carriers) {
    if (holder.id === carrierId || holder.id === targetId) continue;
    const held = holder.holdings[targetId] ?? 0;
    if (held <= 0 || target.shares <= 0) continue;
    holder.cash += (held / target.shares) * dealValue;
    const h = { ...holder.holdings };
    delete h[targetId];
    holder.holdings = h;
  }
  // The acquirer pays for everything it does not already own.
  const ownFraction = target.shares > 0 ? (acquirer.holdings[targetId] ?? 0) / target.shares : 0;
  const cost = dealValue * (1 - ownFraction);
  const fromDebt = withDebt ? Math.max(0, cost - acquirer.cash) : 0;
  acquirer.cash += fromDebt;
  acquirer.debt += fromDebt;
  acquirer.cash -= cost;

  // Absorb the target's balance sheet and network.
  acquirer.cash += target.cash;
  acquirer.debt += target.debt;
  acquirer.fleet = [...acquirer.fleet, ...target.fleet];
  // You buy the target's technology too — its revenue-management systems, its
  // booking app, its loyalty program. The integration drag is the cost of
  // bolting them on. Delivered programs are the union; the target's in-flight
  // ones carry over unless the acquirer is already running or holding them.
  acquirer.tech = [...new Set([...acquirer.tech, ...target.tech])];
  const alreadyHave = new Set([...acquirer.techInProgress.map((t) => t.nodeId), ...acquirer.tech]);
  acquirer.techInProgress = [
    ...acquirer.techInProgress,
    ...target.techInProgress.filter((t) => !alreadyHave.has(t.nodeId)),
  ];
  for (const [id, shares] of Object.entries(target.holdings)) {
    if (id === carrierId) continue; // the target's stake in us simply retires
    acquirer.holdings = { ...acquirer.holdings, [id]: (acquirer.holdings[id] ?? 0) + shares };
  }
  const h = { ...acquirer.holdings };
  delete h[targetId];
  acquirer.holdings = h;

  // Move the target's routes to the acquirer. Where the acquirer already flies a
  // market, fold the target's tails onto the existing route and drop the
  // duplicate — otherwise the carrier would appear twice on that market and
  // compete with itself in the share split.
  const acquirerMarket = new Map<string, string>();
  for (const r of next.routes) {
    if (r.carrierId === carrierId) acquirerMarket.set(marketKey(r.from, r.to), r.id);
  }
  const keptRoutes: typeof next.routes = [];
  for (const r of next.routes) {
    if (r.carrierId !== targetId) {
      keptRoutes.push(r);
      continue;
    }
    const existing = acquirerMarket.get(marketKey(r.from, r.to));
    if (existing) {
      // Duplicate market: fold this route's tails onto the one already flown, drop it.
      for (const tail of acquirer.fleet) if (tail.routeId === r.id) tail.routeId = existing;
    } else {
      const moved = { ...r, carrierId };
      keptRoutes.push(moved);
      acquirerMarket.set(marketKey(moved.from, moved.to), moved.id);
    }
  }
  next.routes = keptRoutes;
  acquirer.integrationUntil = next.turn + CONSTANTS.finance.integrationQuarters;

  // The target leaves the board — bought, not bankrupt.
  target.bankruptTurn = next.turn;
  target.acquiredBy = carrierId;
  target.cash = 0;
  target.fleet = [];
  target.holdings = {};
  target.debt = 0;
  return next;
}

/**
 * Chapter 11: the carrier survives, smaller and cheaper.
 *
 * Creditors take most of the debt, the worst sectors close and the leases behind
 * them are rejected, and what emerges runs on a permanently lower cost base. It
 * does NOT get its bankruptTurn set — it never left the board.
 */
function reorganise(next: GameState, carrier: Carrier, own: readonly Route[]): void {
  const fin = CONSTANTS.finance;
  carrier.reorganisations = (carrier.reorganisations ?? 0) + 1;
  carrier.debt *= fin.reorgDebtKept;
  carrier.cash = fin.reorgCashCushion;
  carrier.techInProgress = [];
  carrier.hedge = null;
  carrier.dividend = 0;
  // Stakes in other carriers are sold to fund the emergence — the estate has no
  // business holding equity while it is shedding debt.
  carrier.holdings = {};
  carrier.stakeBought = {};

  // Shrink the network first: keep the best sectors, drop the rest. Ranked on the
  // same appraisal the carrier itself plans with, so what survives is what it
  // would have chosen to keep.
  const index = buildMarketIndex(next);
  const scored = own
    .map((route) => {
      const assigned = carrier.fleet.filter((t) => t.routeId === route.id);
      const econ = computeRouteEconomics(
        route, assigned, next.turn,
        conditionsFor(next, carrier, route, klassesOf(assigned)),
        rivalsOf(index, route), rivalCapacityOf(index, route),
        feedFactor(next.routes, carrier.id, route.from, route.to, route.id),
        stationOverheadFor(next.routes, carrier.id, route.from, route.to, true),
      );
      return { route, net: econ.netCash };
    })
    .sort((a, b) => b.net - a.net);
  const keepRoutes = Math.max(1, Math.round(scored.length * fin.reorgRoutesKept));
  const kept = new Set(scored.slice(0, keepRoutes).map((r) => r.route.id));
  next.routes = next.routes.filter((r) => r.carrierId !== carrier.id || kept.has(r.id));

  // Then the fleet. Oldest metal goes back to the lessors first — it is the
  // dearest to maintain and the easiest lease to walk away from.
  const keepTails = Math.max(1, Math.round(carrier.fleet.length * fin.reorgFleetKept));
  carrier.fleet = [...carrier.fleet]
    .sort((a, b) => ageYears(a, next.turn) - ageYears(b, next.turn))
    .slice(0, keepTails)
    .map((tail) => (tail.routeId !== null && kept.has(tail.routeId) ? tail : { ...tail, routeId: null }));
}

/**
 * Chapter 7: the carrier is wound up, and its aircraft go on the market cheap.
 *
 * The old behaviour for every failure. It is now the branch for a carrier with no
 * network left to reorganise around — and the fleet no longer evaporates.
 */
function liquidate(next: GameState, carrier: Carrier): void {
  carrier.bankruptTurn = next.turn;
  next.routes = next.routes.filter((r) => r.carrierId !== carrier.id);

  // The estate sells the metal. Grouped by type, because a lot is what a buyer
  // shops for — not eleven individual tails.
  const byType = new Map<string, number>();
  for (const tail of carrier.fleet) byType.set(tail.typeId, (byType.get(tail.typeId) ?? 0) + 1);
  const lots = next.distressed ?? [];
  for (const [typeId, count] of byType) {
    lots.push({
      typeId,
      count,
      untilTurn: next.turn + CONSTANTS.finance.distressedQuarters,
      priceFraction: CONSTANTS.finance.distressedDiscount,
      fromName: carrier.name,
    });
  }
  next.distressed = lots;

  carrier.fleet = [];
  carrier.techInProgress = [];
  carrier.hedge = null;
  // Its stakes are liquidated too — released back to each target's float so they
  // never sterilize the shares available to buy or catch a dividend a defunct
  // holder can do nothing with. Matches how an acquired carrier is wiped.
  carrier.holdings = {};
  carrier.stakeBought = {};
  carrier.dividend = 0;
}

export function endTurn(state: GameState): GameState {
  if (state.gameOver) return state;

  const rng = new Rng(state.rngState);

  // Rivals move before the quarter is settled, so the player sees the result of
  // their decisions in the same books they close.
  let next = clone(runRivals(state, rng));
  next.turn += 1;

  // The world moves before anyone's books are settled.
  next.fuelPrice = walkFuelPrice(next.fuelPrice, rng);
  next.baseCompletion = rollCompletion(rng);
  next.events = pruneEffects(next.events, next.turn);
  // The estate does not hold an unsold fleet for ever. Without this the lots
  // accumulated for the whole game — 27 of them still listed at the horizon on
  // hard — and rode along in every autosave.
  next.distressed = (next.distressed ?? []).filter(
    (lot) => lot.count > 0 && next.turn < lot.untilTurn,
  );
  // History mode fires real events on their real dates, on top of the deck.
  const scripted = scheduledEvent(next);
  if (scripted && !next.events.some((e) => e.source === scripted.source)) {
    // A scripted historical beat wins its axis: a random oil glut lingering into
    // the 2008 spike is cleared, not left to run alongside it.
    const g = eventGroup(scripted.source);
    if (g !== undefined) next.events = next.events.filter((e) => eventGroup(e.source) !== g);
    next.events = [...next.events, scripted];
  }
  const drawn = drawEvent(next, rng);
  if (drawn) next.events = [...next.events, drawn];

  // Each carrier takes delivery of its own programs.
  for (const carrier of next.carriers) {
    const landed = landDeliveries(carrier, next.turn);
    carrier.techInProgress = landed.techInProgress;
    carrier.tech = landed.tech;
  }

  // One demand shock per market, not per route: two carriers sharing a city pair
  // must see the same quarter as each other. Season and noise are folded into
  // the same number because they are the same shape — a multiplier on a market
  // for one quarter — and because both must land here rather than in
  // `conditionsFor`, so that carriers appraise routes on annual economics and
  // then live through the actual season.
  const shock = new Map<string, number>();
  for (const route of next.routes) {
    const key = marketKey(route.from, route.to);
    if (shock.has(key)) continue;
    const season = seasonalDemandFactor(getCity(route.from), getCity(route.to), next.turn);
    const noise = Math.max(0, 1 + rng.normal(0, CONSTANTS.demand.noiseStdDev));
    shock.set(key, season * noise);
  }

  // Priced once, before anyone settles, so every carrier is judged against the
  // same board rather than against a market that shifts as we iterate.
  const index = buildMarketIndex(next);
  const crisisActive = isCrisisActive(next);

  // Collected and appended once. clone() shares the history array with the
  // previous state, so it must be replaced rather than pushed to — and doing
  // that per carrier would copy the whole run of quarters every time.
  const quarters: QuarterResult[] = [];

  for (const carrier of next.carriers) {
    if (carrier.bankruptTurn !== null) continue;

    const result = computeCarrierQuarter(
      carrier,
      next.routes,
      next,
      (route) => shock.get(marketKey(route.from, route.to)) ?? 1,
      index,
    );

    carrier.cash += result.netIncome;

    // Owned tails depreciate; leased tails carry no book value.
    for (const tail of carrier.fleet) {
      if (tail.ownership === 'owned' && next.turn >= tail.deliversTurn) {
        tail.bookValue *= 1 - CONSTANTS.fleet.depreciationPerQuarter;
      }
    }

    let bailoutTaken = 0;

    if (carrier.cash < 0) {
      // In a declared crisis the state steps in: a carrier that would fail
      // instead takes a bailout loan — enough to keep flying, but added to its
      // debt. This is what stopped COVID from wiping the whole industry out; it
      // is survivable but scarring. Available a limited number of times.
      // ...and only once the MARKET has said no. A state rescue is a last resort,
      // not a standing overdraft: a carrier with borrowing headroom left should be
      // using it. Without this the backstop fired on any crisis quarter, and since
      // recessions became crisis-eligible (2026-07-29) that is most quarters — so
      // a player's cash simply stopped at the bailout cushion, quarter after
      // quarter, and the loss condition quietly stopped existing. Pillar 5.
      const marketWillLend = borrowingCapacity(next, carrier) > 0;
      if (crisisActive && !marketWillLend && carrier.bailouts < CONSTANTS.finance.maxBailouts) {
        // Bring cash up to a small cushion, and book it as debt.
        const grant = -carrier.cash + CONSTANTS.finance.bailoutCushion;
        carrier.cash += grant;
        carrier.debt += grant;
        carrier.bailouts += 1;
        bailoutTaken = grant;
      } else {
        /*
         * Chapter 11 or Chapter 7 — restructure, or be wound up.
         *
         * A failing carrier used to simply evaporate, and a substantial one: at
         * the moment of failure the median rival held 19 aircraft, flew 12 routes
         * and owed $707M. All of it left the world at once, which is neither how
         * airlines fail nor an interesting thing to have happen.
         *
         * A carrier with a network still worth flying restructures. Creditors take
         * most of the debt, the fleet and the route map shrink, and it emerges
         * structurally CHEAPER than the airlines that never failed — the perverse
         * dynamic the US industry actually runs on, and the reason a fare war is
         * not a free way to remove somebody. Anything else is wound up, and its
         * aircraft go on the market at a distressed price.
         */
        const survivors = next.routes.filter((r) => r.carrierId === carrier.id);
        const used = carrier.reorganisations ?? 0;
        /*
         * RIVALS ONLY. The player running out of money is the end of the game.
         *
         * Pillar 5 says bankruptcy is a real end state, and letting the player
         * restructure removes it: a CEO who loses the company has lost. Without
         * this exclusion the player emerged from insolvency with 70% of the debt
         * forgiven, a cash cushion and a permanent cost advantage — verified, and
         * it is precisely the failure the bailout backstop above already carries a
         * comment about. The state rescue is the player's second chance, and it is
         * capped at three for the same reason.
         */
        const worthSaving =
          !carrier.isPlayer &&
          survivors.length >= CONSTANTS.finance.reorgMinRoutes &&
          carrier.fleet.length > 0 &&
          used < CONSTANTS.finance.maxReorganisations;
        if (worthSaving) reorganise(next, carrier, survivors);
        else liquidate(next, carrier);
      }
    }

    // Recorded AFTER the rescue, so the quarter shows the cash the bank actually
    // ended with and the briefing can report what the state put in.
    quarters.push({
      ...result,
      cashAfter: carrier.cash,
      ...(bailoutTaken > 0 ? { bailout: bailoutTaken } : {}),
    });
  }

  // Dividends move cash after the operating quarter is settled. Fold what each
  // carrier RECEIVED into its record — as its own line and into net income, so the
  // P&L reconciles with the cash that actually landed — and refresh cashAfter now
  // that both the payout and the receipts have moved.
  const dividends = payDividends(next, quarters);
  const settled = quarters.map((q) => {
    const income = dividends.gross.get(q.carrierId) ?? 0;
    const dividendTax = dividends.tax.get(q.carrierId) ?? 0;
    return {
      ...q,
      dividendIncome: income,
      // Gross into income, the tax into the tax line: the quarter still reconciles
      // as revenue - costs - interest - tax + dividends, and the cash that landed is
      // the difference. Netting it off the income line instead would have quietly
      // broken that identity, which the settlement harness checks every turn.
      tax: q.tax + dividendTax,
      netIncome: q.netIncome + income - dividendTax,
      cashAfter: getCarrier(next, q.carrierId).cash,
    };
  });
  next.history = [...next.history, ...settled];
  applyStockSplits(next);
  // A fresh quarter for the per-quarter stake-purchase and transfer limits.
  for (const carrier of next.carriers) {
    carrier.stakeBought = {};
    carrier.transferredThisQuarter = 0;
  }
  next.rngState = rng.save();

  return concludeTurn(next);
}

/**
 * Distribute declared dividends. A carrier pays a share of the quarter's profit to
 * its shareholders: the in-game holders take their slice in cash, the public
 * float's share leaves the game. It never pays more than it earned or more than it
 * holds, so it cannot bankrupt itself — but it does drain the balance sheet, which
 * is the price of using the dividend to prop a share price, and the mechanism by
 * which a controller pulls a subsidiary's cash upward.
 */
/**
 * What share of a dividend received escapes tax, by how much of the payer is held.
 *
 * The US dividends-received deduction, used at its real thresholds because the
 * important one — 80%, above which a group files as a single company and cash moves
 * untaxed — is precisely what a 51% controller cannot reach. That is the mechanism
 * economists credit with ending the American pyramid, ahead of any prohibition: the
 * structure was not banned so much as taxed at every layer on the way up.
 *
 * It also puts a decision where there was none. Control costs half a company; not
 * leaking costs four fifths of one. A player who wants the cash rather than only the
 * command has to buy their way out of the tax, and a deep chain held at the cheap
 * end pays for its depth every time it moves money.
 */
function dividendDeduction(ownership: number): number {
  const fin = CONSTANTS.finance;
  if (ownership >= fin.dividendDeductionBands.consolidated) return fin.dividendDeduction.consolidated;
  if (ownership >= fin.dividendDeductionBands.affiliate) return fin.dividendDeduction.affiliate;
  return fin.dividendDeduction.minority;
}

/** Dividends received per carrier, and the tax each owes on them. */
export interface DividendReceipts {
  readonly gross: Map<CarrierId, number>;
  readonly tax: Map<CarrierId, number>;
}

function payDividends(next: GameState, quarters: readonly QuarterResult[]): DividendReceipts {
  const received = new Map<CarrierId, number>();
  const taxed = new Map<CarrierId, number>();
  for (const record of quarters) {
    const payer = getCarrier(next, record.carrierId);
    if (payer.bankruptTurn !== null || payer.dividend <= 0 || record.netIncome <= 0 || payer.shares <= 0) continue;
    // Paid out of operating profit only (record.netIncome is pre-dividend), so
    // dividends never cascade within a quarter.
    const payout = Math.min(record.netIncome * payer.dividend, Math.max(0, payer.cash));
    if (payout <= 0) continue;
    payer.cash -= payout;
    for (const holder of next.carriers) {
      if (holder.id === payer.id) continue;
      const held = holder.holdings[payer.id] ?? 0;
      if (held > 0) {
        const ownership = held / payer.shares;
        const slice = ownership * payout;
        // Only the undeducted part is taxable, and only a carrier in profit on the
        // quarter pays anything — the operating line is taxed on the same rule.
        const taxable = slice * (1 - dividendDeduction(ownership));
        const tax = Math.max(0, taxable) * CONSTANTS.game.corporateTaxRate;
        holder.cash += slice - tax;
        received.set(holder.id, (received.get(holder.id) ?? 0) + slice);
        taxed.set(holder.id, (taxed.get(holder.id) ?? 0) + tax);
      }
    }
  }
  return { gross: received, tax: taxed };
}

/**
 * Split any stock that has run high. Doubling the shares and every stake in the
 * carrier halves the price and changes no one's ownership fraction or the
 * company's value — it just keeps prices legible, and reads as a mark of success.
 */
function applyStockSplits(next: GameState): void {
  const base = CONSTANTS.finance.splitFactor;
  const threshold = CONSTANTS.finance.splitPriceThreshold;
  for (const carrier of next.carriers) {
    if (carrier.bankruptTurn !== null || carrier.shares <= 0) continue;
    // A split changes shares and price but not value, so market cap is computed
    // once and the whole multiplier worked out from it — no per-split revaluation.
    const cap = marketCap(next, carrier);
    let price = cap / carrier.shares;
    let factor = 1;
    while (price > threshold) {
      price /= base;
      factor *= base;
    }
    if (factor === 1) continue;
    carrier.shares *= factor;
    // The authorized ratio (issued / float) is untouched by a split.
    if (carrier.issuedShares) carrier.issuedShares *= factor;
    for (const holder of next.carriers) {
      const held = holder.holdings[carrier.id];
      if (held) holder.holdings = { ...holder.holdings, [carrier.id]: held * factor };
    }
  }
}

/**
 * After the quarter is settled, decide whether the game has ended: bankruptcy, a
 * hostile takeover of the player, victory by clearing the board, or the horizon.
 */
function concludeTurn(next: GameState): GameState {
  const player = getCarrier(next, next.playerCarrierId);

  if (player.bankruptTurn !== null) {
    next.gameOver = { turn: next.turn, reason: 'Bankrupt. The receivers have the keys.', outcome: 'lost' };
    return next;
  }

  // Track the player's high-water equity — a hostile takeover needs the share
  // price to have fallen from a real peak, not merely to be modest.
  const playerCap = marketCap(next, player);
  const peak = Math.max(next.playerPeakEquity, playerCap);
  next.playerPeakEquity = peak;

  const fin = CONSTANTS.finance;

  // A rival that has quietly built a CONTROLLING stake in the player takes it
  // outright — the accumulation you watched cross the halfway line (and could have
  // fought by issuing shares) is now a majority owner. Past the early-game grace
  // only; a rival only ever reaches this on a player that let itself go weak and
  // small (that is the bar to open the campaign), so a strong player is never here.
  {
    /*
     * NOT graced, unlike the distressed-predator path below.
     *
     * The early-game grace exists so a young carrier is not seized for having a
     * low share price, which is a thing that can happen to it rather than a thing
     * it did. Someone buying a MAJORITY is not that: the per-quarter cap means it
     * takes at least six quarters, every one of them is reported in the briefing
     * from 10% upward and in danger tone past 40%, and there are three answers to
     * it — buy the block back, issue equity and dilute them, or lift the price out
     * of reach. Graced, it produced the worst outcome available: a rival holding
     * 53% of the player, the briefing warning that a controlling stake "would let
     * it take you over", and the game carrying on for eight years as though
     * ownership were an opinion.
     *
     * Any solvent rival holding a majority, whatever kind of airline it is.
     *
     * This used to require `acquisitive`, which made who owns you depend on the
     * owner's personality: a carrier could hold 75% of the player and the game
     * would carry on, because buying rivals was not in its character. Ownership
     * is not a character trait. Today no non-acquisitive carrier can get there —
     * `stakeCeiling` caps a speculator at 40%, under the 50% control line — so
     * this is a correctness fix rather than a behaviour change, and it stops the
     * loss condition depending on a constant a long way away from it.
     *
     * The `acquisitive` test still belongs on the DISTRESSED-predator path below:
     * who goes hunting for a wounded carrier genuinely is a matter of character.
     */
    /*
     * ...except a carrier the player themselves commands.
     *
     * Once a controlling stake let the player spend a subsidiary's treasury, the
     * subsidiary could be pointed at the player's own stock — and a majority held
     * by a company you own ended the game with "your rival took you over". You do
     * not lose control of your airline to something you already control. Parking
     * your own shares in a subsidiary is in fact a defence, because it takes them
     * off the float where a genuine raider could reach them.
     */
    const controller = next.carriers.find(
      (c) =>
        !c.isPlayer &&
        c.bankruptTurn === null &&
        controls(c, player) &&
        !commands(next, player, c),
    );
    if (controller) {
      const merged = mergeCarrier(next, controller.id, player.id, true);
      merged.gameOver = {
        turn: merged.turn,
        reason: `${controller.name} amassed a controlling stake and took over your airline.`,
        outcome: 'lost',
      };
      return merged;
    }
  }

  // Hostile takeover: once past the early game, a much larger rival will swallow
  // a player whose value has cratered from its peak while it bleeds money. Pillar
  // 5 — let your share price collapse and a shark eats you.
  const lastQuarter = next.history.filter((h) => h.carrierId === player.id).at(-1);
  const cratered = playerCap < peak * fin.craterFraction;
  // Genuinely collapsed: past the early game, worth a fraction of its peak, and
  // bleeding both over the year and in the latest quarter — not just a soft patch.
  const distressed =
    next.turn >= fin.hostileGraceTurns &&
    cratered &&
    trailingEarnings(next, player.id) < 0 &&
    (lastQuarter?.netIncome ?? 0) < 0;
  if (distressed) {
    // Only a roll-up artist hunts a wounded carrier — it is the archetype whose
    // whole game is buying rivals. Others let the market do its work.
    const predator = next.carriers.find(
      (c) =>
        !c.isPlayer &&
        c.bankruptTurn === null &&
        c.archetypeId !== null &&
        getArchetype(c.archetypeId).acquisitive === true &&
        marketCap(next, c) >= playerCap * fin.hostileSizeMultiple &&
        c.cash + borrowingCapacity(next, c) >= acquisitionCost(next, c, player),
    );
    if (predator) {
      const merged = mergeCarrier(next, predator.id, player.id, true);
      merged.gameOver = {
        turn: merged.turn,
        reason: `${predator.name} seized your airline in a hostile takeover.`,
        outcome: 'lost',
      };
      return merged;
    }
  }

  const rivalsLeft = next.carriers.filter((c) => !c.isPlayer && c.bankruptTurn === null).length;
  const allEntered = next.enteredRivals.length >= next.rivalPlan.length;
  if (allEntered && rivalsLeft === 0) {
    next.gameOver = {
      turn: next.turn,
      reason: 'Every rival is gone — bankrupted or bought. The skies are yours.',
      outcome: 'won',
    };
    return next;
  }

  if (next.turn >= next.horizonTurns) {
    const solvent = next.carriers.filter((c) => c.bankruptTurn === null);
    const topCap = Math.max(...solvent.map((c) => marketCap(next, c)));
    const won = marketCap(next, player) >= topCap - 1;
    next.gameOver = {
      turn: next.turn,
      reason: won
        ? 'The horizon closes with you the most valuable carrier in the sky.'
        : 'The horizon closes; a rival finished worth more than you.',
      outcome: won ? 'won' : 'lost',
    };
  }

  return next;
}

/** Net worth: cash plus the book value of owned aircraft. */
export function netWorth(carrier: Carrier): number {
  return carrier.fleet.reduce((sum, a) => sum + a.bookValue, carrier.cash);
}

/** Turn number → display label, e.g. turn 5 → "Q2 2027". Turn count is the only clock. */
export function turnLabel(turn: number, startYear: number = CONSTANTS.game.startYear): string {
  const { quartersPerYear } = CONSTANTS.game;
  const year = startYear + Math.floor(turn / quartersPerYear);
  const quarter = (turn % quartersPerYear) + 1;
  return `Q${quarter} ${year}`;
}
