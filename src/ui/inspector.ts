/**
 * The strip under the map. Shows the selected sector's economics, or the last
 * quarter's consolidated P&L when nothing is selected.
 *
 * Every figure the sim used to settle the quarter is shown here — that is the
 * "share price must be legible" rule applied to route economics: the player is
 * entitled to see the components, not just the answer.
 */
import type { CityId, GameState, PricingPosture, Route, RouteEconomics } from '../sim/types.ts';
import {
  marketKey,
  breakevenLoad, computeRouteEconomics, assignedTo, feedFactor, marketBoard, openingCostFor,
  rivalCapacityOf, rivalsOf, seatsUnder, stationOverheadFor,
  type MarketIndex,
} from '../sim/economics.ts';
import { getCarrier, turnLabel } from '../sim/engine.ts';
import { getCity, CONSTANTS } from '../sim/world.ts';
import { distanceKm } from '../sim/geo.ts';
import { marketCap, sharePrice } from '../sim/market.ts';
import { getArchetype } from '../sim/ai/archetype.ts';
import { canReach, getAircraftType, rotationsPerWeek } from '../sim/fleet.ts';
import { conditionsFor, klassesOf, techEffects } from '../sim/conditions.ts';
import { getTechNode } from '../sim/tech.ts';
import { usd, km, pct, rate, techSummary } from './format.ts';
import { cautionMark, costLine, el, figure, techPanel } from './techpanel.ts';
import { STRINGS } from './strings.ts';

export interface InspectorCallbacks {
  onSetPosture(routeId: string, posture: PricingPosture): void;
  onCloseRoute(routeId: string): void;
  onAssign(tailId: string, routeId: string): void;
  onUnassign(tailId: string): void;
  /** Pick one sector out on the map, or null to stop picking it out. */
  onHighlightRoute(routeId: string | null): void;
  /** Commit the proposed sector, paying to open it. */
  onOpenProspect(): void;
  /** Drop the proposal without opening anything. */
  onDiscardProspect(): void;
}

/*
 * Five notches, priciest first. Still one decision per sector — a posture, not a
 * fare box — but three could not express two strategies that exist in life and
 * now exist here: milking a monopoly that is turning away more people than it
 * carries, and buying a market that is thinner than the metal on it.
 *
 * Every posture is priced off the SAME anchor — what the sector will bear, from
 * distance and the two cities' economic weight — so the labels mean the same
 * thing whether or not anybody else is on the market. "Match" has never meant
 * "match a rival"; it means the market fare.
 */
const POSTURES: readonly { id: PricingPosture; label: string; hint: string }[] = [
  {
    id: 'skim',
    label: 'Skim',
    hint: 'The top of the market: fewest seats, highest fares, priciest to serve. Only worth it where you are already turning people away at Premium — it sheds a lot of traffic to lift the yield on what is left.',
  },
  {
    id: 'premium',
    label: 'Premium',
    hint: 'A premium cabin: fewer seats, much higher fares, and much more expensive to serve. Wins where fares are high and you cannot fill a dense cabin anyway.',
  },
  { id: 'match', label: 'Match', hint: 'Standard cabin, and the fare the market will bear.' },
  {
    id: 'undercut',
    label: 'Undercut',
    hint: 'High-density, no-frills: more seats, cheaper, cheap to serve. Wins where there are plenty of passengers to fill them.',
  },
  {
    id: 'stimulate',
    label: 'Stimulate',
    hint: 'Fares low enough to create traffic that was not travelling at all. The densest cabin and the cheapest seat, for a market with more capacity on it than passengers — you are buying the market, and it costs you.',
  },
];



export function renderInspector(
  panel: HTMLElement,
  state: GameState | null,
  index: MarketIndex | null,
  selectedRouteId: string | null,
  focusedCarrierId: string | null,
  highlightedRouteId: string | null,
  prospect: { from: CityId; to: CityId } | null,
  callbacks: InspectorCallbacks,
): void {
  panel.replaceChildren();

  if (!state) {
    panel.append(el('p', 'inspector-empty', 'Pick a home city on the map to start an airline.'));
    return;
  }

  const route = selectedRouteId ? state.routes.find((r) => r.id === selectedRouteId) : undefined;
  const focused = focusedCarrierId
    ? state.carriers.find((c) => c.id === focusedCarrierId)
    : undefined;
  if (prospect) {
    renderProspect(panel, state, index, prospect, callbacks);
  } else if (route && index) {
    renderRoute(panel, state, index, route, callbacks);
  } else if (focused && index) {
    renderCarrier(panel, state, index, focused, highlightedRouteId, callbacks);
  } else {
    renderConsolidated(panel, state);
  }
}

/**
 * A breakeven at or above 100% is unachievable — you cannot sell more seats than you
 * fly — so it is a verdict, not a number. Measured, these get genuinely silly: three
 * widebodies on London-Paris at Skim break even at 8,493%, because the fare per
 * passenger and the cost of carrying one are both $141 and the contribution per unit
 * of load collapses. Printing that figure would read as a bug; printing the turboprop's
 * 128% would suggest it is nearly reachable. Both are simply impossible.
 *
 * Returns the breakeven load when it is genuinely achievable (not null, and below
 * 100%), or null when it isn't. Callers test the result for null rather than
 * re-deriving the threshold, which lets a truthy check narrow the value honestly
 * instead of asserting past a lying predicate.
 */
function achievableBreakeven(be: number | null): number | null {
  return be !== null && be < 1 ? be : null;
}

/**
 * Why a sector does or does not pay — four outcomes, because two of them are
 * "never" for completely different reasons and the fix for each is different.
 *
 * `breakevenLoad` returns null only when the fare fails at the MARGIN: carrying one
 * more passenger costs more than they pay, so selling seats makes the loss worse. A
 * breakeven of 227% is not that — there the fare beats the marginal cost comfortably
 * and the aircraft simply cannot hold enough people to cover the cost of flying it.
 * Measured across 2,955 aircraft x sector x posture x count configurations, 914 of the
 * 1,170 unpayable ones are the second kind, so the marginal-fare explanation was the
 * wrong one for most of the sectors that showed it.
 */
type Breakeven =
  | { kind: 'idle' }
  | { kind: 'marginal' }
  | { kind: 'beyond-full'; load: number }
  | { kind: 'cargo' }
  | { kind: 'reachable'; load: number };

function classifyBreakeven(econ: RouteEconomics, posture: PricingPosture): Breakeven {
  if (econ.capacityWeekly <= 0 || econ.loadFactor <= 0) return { kind: 'idle' };
  const be = breakevenLoad(econ, posture);
  if (be === null) return { kind: 'marginal' };
  if (be <= 0) return { kind: 'cargo' };
  if (be >= 1) return { kind: 'beyond-full', load: be };
  return { kind: 'reachable', load: be };
}

/** "227% of its seats" reads as a typo past about double; "2.3 times" does not. */
function shortfall(load: number): string {
  return load >= 2
    ? `about ${load.toFixed(1)} times the seats it has`
    : `${pct(load)} of its seats`;
}

/** Attach a tooltip to a figure and hand it back, so branches stay one expression. */
function tip(node: HTMLElement, text: string): HTMLElement {
  node.title = text;
  return node;
}

/**
 * Break-even as a figure in the panel's own stats row.
 *
 * It used to be a separate block in its own type, printing three percentages in one
 * compressed line ("Breakeven load 76% - you fly at 86% (ceiling 88%)"). Beside the
 * `Load factor` figure it needs none of that: the two numbers sit next to each other in
 * the same row and the reader compares them without being told to. Uses the same
 * `figure()` as every other cell, so it inherits the row's type, spacing and alignment.
 *
 * The value goes red when the sector needs to fill more than it manages — which is
 * exactly when it is losing money, since
 * `netCash = contribution x (loadFactor - breakeven)`.
 */
function breakevenFigure(econ: RouteEconomics, posture: PricingPosture): HTMLElement {
  const be = classifyBreakeven(econ, posture);
  switch (be.kind) {
    case 'idle':
      return tip(
        figure('Break-even', '—'),
        'Nothing is being carried here yet, so there is no load to break even at.',
      );
    case 'marginal':
      return tip(
        figure('Break-even', 'never', true),
        'No load covers this sector: the fare does not cover the cost of carrying one more '
        + 'passenger, so every extra seat sold loses a little more. A different posture, a '
        + 'bigger aircraft or a longer sector is what changes it.',
      );
    case 'beyond-full':
      return tip(
        figure('Break-even', 'never', true),
        `Even a full cabin does not cover this sector — it would need to sell `
        + `${shortfall(be.load)}, and every seat is all there is. Each passenger does pay `
        + `their way; there are not enough of them to cover the cost of flying at all.`,
      );
    case 'cargo':
      return tip(
        figure('Break-even', 'covered'),
        'Freight alone covers this sector\u2019s costs, so the cabin is profit from the first '
        + 'passenger who boards.',
      );
    default:
      return tip(
        figure('Break-even', pct(be.load), be.load >= econ.loadFactor),
        'The share of seats that has to sell for this sector to cover every cost it carries — '
        + 'fuel, crew, maintenance, lease, ground handling, the cost of simply having the '
        + 'aircraft, and its share of the station and head office — after freight revenue is '
        + 'credited against them. Compare it with the load beside it: fill more than this and '
        + 'the sector pays, less and it does not.',
      );
  }
}

/**
 * What those two numbers mean, in a sentence.
 *
 * The figures give the arithmetic; this says what it amounts to, because "76% against
 * 86%" is only obvious once you already know the rule. `subject` is written to read as
 * the start of an English sentence — "One Aros N3 at Match", "At Skim, this sector".
 */
function verdictNote(
  econ: RouteEconomics,
  posture: PricingPosture,
  subject: string,
): HTMLElement {
  const be = classifyBreakeven(econ, posture);
  const fills = pct(econ.loadFactor);
  switch (be.kind) {
    case 'idle':
      return el('p', 'prospect-note', `${subject} is not carrying anyone yet.`);
    case 'marginal':
      return el('p', 'prospect-note is-negative',
        `${subject} cannot cover its costs at any load — the fare does not cover the cost of `
        + `carrying one more passenger, so filling seats loses more, not less.`);
    case 'beyond-full':
      return el('p', 'prospect-note is-negative',
        `${subject} cannot cover its costs even full — it would need ${shortfall(be.load)}.`);
    case 'cargo':
      return el('p', 'prospect-note',
        `${subject} pays for itself on freight alone, before a passenger boards.`);
    default: {
      if (be.load >= econ.loadFactor) {
        return el('p', 'prospect-note is-negative',
          `${subject} does not cover its costs: it needs to fill ${pct(be.load)} of its `
          + `seats and manages ${fills}.`);
      }
      const room = Math.round((econ.loadFactor - be.load) * 100);
      return el('p', 'prospect-note',
        `${subject} covers its costs${room < 5 ? ', but only just' : ''} — filling ${fills}, `
        + `where ${pct(be.load)} pays for it.`);
    }
  }
}

/**
 * A sector the player has proposed but not yet paid for.
 *
 * Two clicks on the map used to open a route outright. That was tolerable while
 * opening cost a rounding error; it is not now that a station somewhere new runs
 * to eight figures, and it was never really right — the gesture committed capital
 * without ever showing a number. So the pair is a proposal, this pane is where the
 * decision is put, and opening is a button.
 *
 * The station arithmetic is spelled out rather than summed, because it is the one
 * rule that should change how a player draws their network: sectors hanging off
 * cities you already serve are cheap, and sectors into fresh territory are not.
 */
function renderProspect(
  panel: HTMLElement,
  state: GameState,
  index: MarketIndex | null,
  prospect: { from: CityId; to: CityId },
  callbacks: InspectorCallbacks,
): void {
  const { from, to } = prospect;
  const player = getCarrier(state, state.playerCarrierId);
  const dist = distanceKm(getCity(from), getCity(to));
  const cost = openingCostFor(state.routes, player, from, to);

  /*
   * The market, priced through the sim rather than restated from the gravity model.
   *
   * Calling `marketDemandWeekly` directly gave a number that disagreed with the one
   * the sector shows the moment it opens, in two compounding ways: it is ONE-WAY
   * where `RouteEconomics` quotes both directions, and it is the raw model figure
   * before the difficulty and event demand multipliers. So the panel a player uses
   * to decide whether to open a sector was understating its market by about half.
   * Pricing an empty prospective route through `computeRouteEconomics` and reading
   * the figure back cannot drift from what the dossier prints, because it IS what
   * the dossier prints.
   */
  const probe: Route = {
    id: 'prospect', carrierId: player.id, from, to, posture: 'match', openedTurn: state.turn,
  };
  /*
   * Priced against the rivals ACTUALLY on this market, not as a monopoly.
   *
   * This panel only reads `marketDemandWeekly` below, and demand is settled before
   * the rival arguments enter the arithmetic — LON-PAR comes out to 274,016 whether
   * rivals are passed or not, so this change alone moves nothing a player sees today.
   * What the rival arguments actually move is `loadCeiling` (0.880 → 0.793 on that
   * same probe) and `netCash` (+0.8M → −0.6M) — figures this panel doesn't show yet
   * but forthcoming work will. Wiring the real rivals in now, ahead of that, means
   * the probe won't need re-plumbing later — pricing it against a monopoly would
   * quote a contested sector's ceiling and cash as better than they'll actually be.
   */
  const preview = computeRouteEconomics(
    probe, [], state.turn, conditionsFor(state, player, probe, klassesOf([])),
    index ? rivalsOf(index, probe) : 0,
    index ? rivalCapacityOf(index, probe) : 0,
    1, 0,
  );
  const demand = preview.marketDemandWeekly;

  const served = new Set<CityId>([player.homeCityId]);
  for (const r of state.routes) {
    if (r.carrierId !== player.id) continue;
    served.add(r.from);
    served.add(r.to);
  }
  const fresh = [from, to].filter((c) => !served.has(c));
  const affordable = player.cash >= cost;

  const head = el('div', 'inspector-head');
  const title = el('h2', 'inspector-title');
  title.textContent = `${from}–${to}`;
  const sub = el('p', 'inspector-sub');
  sub.textContent = `${getCity(from).name} – ${getCity(to).name} · ${km(dist)} km · not yet open`;
  head.append(title, sub);
  panel.append(head);

  /*
   * How this sector sits against the network — stated first, because it frames every
   * figure below it. Whether the two cities are already served is what decides both
   * the opening cost and the quarterly one, so the reader should know it before
   * meeting either number rather than being handed the explanation afterwards.
   */
  const note = el('p', 'prospect-note');
  note.textContent = fresh.length === 0
    ? 'You already serve both cities, so this sector opens cheaply and splits two stations that are already being paid for — it brings the station line down on your existing sectors there too.'
    : fresh.length === 1
      ? `${getCity(fresh[0]!).name} is new to your network. Opening a station there is the small part; paying for it every quarter afterwards is the real cost, and it stays yours alone until you put more sectors through it.`
      : 'Neither city is on your network, so this sector opens two stations and then pays for both on its own, every quarter, until something else flies through them.';
  panel.append(note);

  /*
   * Priced BEFORE the stats row is built, because break-even belongs in that row rather
   * than in a block of its own — one aircraft of whatever the player flies most, at
   * Match. The neutral posture on purpose: this says whether the sector CAN pay without
   * answering how to play it.
   */
  const counts = new Map<string, number>();
  for (const a of player.fleet) counts.set(a.typeId, (counts.get(a.typeId) ?? 0) + 1);
  /*
   * The commonest type THAT CAN REACH, not simply the commonest.
   *
   * Ranking on count alone and then testing range meant a fleet of narrowbodies plus
   * a couple of widebodies got no verdict at all on any long sector: the probe picked
   * the narrowbody because there were more of them, found it out of range, and gave
   * up — withholding the figures on exactly the sectors where the call is hardest and
   * the aircraft is least obvious. Count still decides between the types that qualify,
   * so the quote stays about metal the carrier actually operates.
   */
  const commonest = [...counts.entries()]
    .filter(([typeId]) => canReach(getAircraftType(typeId), dist))
    .sort((a, b) => b[1] - a[1])[0]?.[0];
  let probed: RouteEconomics | null = null;
  if (commonest) {
    const one = [{
      id: 'probe-tail', typeId: commonest, ownership: 'leased' as const,
      acquiredTurn: state.turn, deliversTurn: state.turn, bookValue: 0, routeId: probe.id,
    }];
    probed = computeRouteEconomics(
      probe, one, state.turn, conditionsFor(state, player, probe, klassesOf(one)),
      index ? rivalsOf(index, probe) : 0,
      index ? rivalCapacityOf(index, probe) : 0,
      1, 0,
    );
  }

  const stats = el('dl', 'figures');
  stats.append(figure('Market', `${Math.round(demand).toLocaleString('en-US')}/wk`));
  stats.append(figure('Distance', `${km(dist)} km`));
  stats.append(figure('Cost to open', usd(cost), !affordable));
  stats.append(figure('Cash', usd(player.cash)));
  if (probed) {
    stats.append(tip(
      figure('Would fill', pct(probed.loadFactor)),
      'The share of its seats one of these would actually sell here, given the traffic you would '
      + 'win against everyone already flying this market. It is the number break-even has to beat.',
    ));
    stats.append(breakevenFigure(probed, 'match'));
  }
  panel.append(stats);

  if (probed && commonest) {
    panel.append(verdictNote(probed, 'match', `One ${getAircraftType(commonest).name} at Match`));
  } else if (counts.size > 0) {
    /*
     * Say why the figures are missing rather than just omitting them. A panel that
     * silently drops two of its rows reads as a fault, and the reader is left to work
     * out that range is the reason — which is a real answer, and an actionable one.
     */
    const longest = Math.max(...[...counts.keys()].map((id) => getAircraftType(id).rangeKm));
    panel.append(el('p', 'prospect-note',
      `No load or break-even here: nothing you operate can fly ${km(dist)} km. The longest `
      + `range in your fleet is ${km(longest)} km, so this sector needs an aircraft you do `
      + `not have yet.`));
  }

  /*
   * The planning department: every type the player operates, ranked by headroom.
   *
   * Gated because ranking prospects precisely is a real advantage, where knowing a
   * sector is a trap is not — that is the free verdict above. Only types already
   * operated, never the whole roster: choosing what to buy is the decision the game
   * is about, and a catalogue would collapse it into a lookup.
   */
  if (player.tech.includes('network-planning') && counts.size > 0) {
    const table = el('table', 'fleet-compare');
    const thead = el('thead');
    const headRow = el('tr');
    for (const h of ['Aircraft', 'Breakeven', 'Ceiling', 'Headroom', 'Free']) {
      const th = el('th', undefined, h);
      th.setAttribute('scope', 'col');
      headRow.append(th);
    }
    thead.append(headRow);
    table.append(thead);
    const body = el('tbody');
    const rows = [...counts.keys()].map((typeId) => {
      const type = getAircraftType(typeId);
      if (!canReach(type, dist)) {
        return { type, be: null, ceiling: 0, loadFactor: 0, free: 0, reach: false };
      }
      const one = [{
        id: 'probe-tail', typeId, ownership: 'leased' as const,
        acquiredTurn: state.turn, deliversTurn: state.turn, bookValue: 0, routeId: probe.id,
      }];
      const e = computeRouteEconomics(
        probe, one, state.turn, conditionsFor(state, player, probe, klassesOf(one)),
        index ? rivalsOf(index, probe) : 0,
        index ? rivalCapacityOf(index, probe) : 0,
        1, 0,
      );
      return {
        type, be: breakevenLoad(e, 'match'), ceiling: e.loadCeiling, loadFactor: e.loadFactor,
        reach: true,
        free: player.fleet.filter((a) => a.typeId === typeId && a.routeId === null).length,
      };
    });
    // Best headroom first; unreachable and unable-to-pay rows sink to the bottom.
    // Headroom against the load actually flown — see `achievableBreakeven` on why
    // that is loadFactor and not loadCeiling.
    rows.sort((a, b) => {
      const aAchievable = a.reach ? achievableBreakeven(a.be) : null;
      const bAchievable = b.reach ? achievableBreakeven(b.be) : null;
      const ha = aAchievable === null ? -Infinity : a.loadFactor - aAchievable;
      const hb = bAchievable === null ? -Infinity : b.loadFactor - bAchievable;
      return hb - ha;
    });
    for (const r of rows) {
      const tr = el('tr');
      tr.append(el('td', undefined, `${r.type.name} · ${r.type.seats} st`));
      const achievable = achievableBreakeven(r.be);
      if (!r.reach) {
        const cell = el('td', 'compare-flat', 'out of range');
        cell.setAttribute('colspan', '4');
        tr.append(cell);
      } else if (achievable === null) {
        const cell = el('td', 'compare-flat is-negative', 'cannot pay at any load');
        cell.setAttribute('colspan', '4');
        tr.append(cell);
      } else if (achievable <= 0) {
        // Cargo alone covers it — the branch `classifyBreakeven` calls 'cargo'. A
        // negative breakeven rendered as "-12%" would look like a fault.
        const cell = el('td', 'compare-flat', 'pays before boarding');
        cell.setAttribute('colspan', '4');
        tr.append(cell);
      } else {
        const pays = achievable < r.loadFactor;
        tr.append(el('td', pays ? undefined : 'is-negative', pct(achievable)));
        tr.append(el('td', undefined, pct(r.ceiling)));
        tr.append(el('td', pays ? undefined : 'is-negative',
          pays ? `+${Math.round((r.loadFactor - achievable) * 100)}` : 'cannot pay'));
        tr.append(el('td', undefined, r.free > 0 ? String(r.free) : '—'));
      }
      body.append(tr);
    }
    table.append(body);
    panel.append(table);
    panel.append(el('p', 'prospect-note', 'At Match · types you operate · today’s competition.'));
  }

  /*
   * The cost, itemised. A single total cannot teach the rule; the split does.
   *
   * One list, not two. The opening lines and the quarterly line used to sit in separate
   * `prospect-costs` lists, which drew two hairlines back to back — the last row's
   * border-bottom against the next list's border-top — for no division the reader could
   * read anything into. They are all what this sector costs; one list, one rule between
   * rows.
   */
  const costs = el('ul', 'prospect-costs');
  const line = (label: string, amount: number): HTMLElement => {
    const li = el('li');
    li.append(el('span', 'prospect-cost-label', label));
    li.append(el('span', 'prospect-cost-value', usd(amount)));
    return li;
  };
  costs.append(line('Slots and launch marketing', CONSTANTS.routes.openingCost));
  for (const city of fresh) {
    costs.append(line(`Opening a station in ${getCity(city).name}`, CONSTANTS.routes.newStationCost));
  }

  /*
   * What it costs to KEEP, which is the larger question and the one a one-off
   * total hides. Quoted as the share this sector would actually bear, because
   * that is the number that changes with where you open: hang a sector off two
   * busy stations and it carries a fraction of each, open into empty territory
   * and it carries both outright.
   */
  const ongoing = stationOverheadFor(state.routes, player.id, from, to, false)
    + CONSTANTS.routes.quarterlyFixedCost;
  const runLine = el('li');
  runLine.append(el('span', 'prospect-cost-label', 'Then, every quarter'));
  runLine.append(el('span', 'prospect-cost-value', `${usd(ongoing)}/qtr`));
  costs.append(runLine);
  panel.append(costs);

  /*
   * The warning a new player most needs and could not get anywhere on this panel.
   *
   * Ground handling is charged per departure, and frequency is derived from the
   * aircraft rather than set by the player — so a short sector turns far more often
   * for the same fleet and pays the per-turn cost far more often. Measured on the
   * shipped economy with the strongest short-haul narrowbody: handling is 55% of
   * revenue at 261km, 48% at 343km, 28% at 932km and 15% at 2,392km, and the only
   * loss-making sector within 6,000km of London was the 261km one.
   *
   * The exact departures cannot be quoted here — nothing is assigned to the sector
   * yet, and frequency depends on what eventually flies it — so this states the rule
   * and the direction rather than inventing a figure.
   *
   * The threshold lives here rather than in constants.json because it decides when a
   * sentence appears, not how the game behaves; nothing in /sim reads it.
   */
  const HANDLING_WARN_KM = 800;
  if (dist < HANDLING_WARN_KM) {
    const short = el('p', 'prospect-note is-caution');
    short.append(cautionMark());
    short.append(document.createTextNode(dist < 400
      ? `At ${km(dist)} km this is a very short sector. Ground handling is charged on every ` +
        `departure, and a sector this short flies many departures a week — it is the line ` +
        `that sinks short routes, and filling the cabin does not fix it, because most of the ` +
        `cost is per departure rather than per passenger. Expect handling to take about half ` +
        `of what this sector earns. More distance, or a bigger aircraft on the same schedule, ` +
        `is what brings it down.`
      : `At ${km(dist)} km this is a short sector, so it will fly often and ground handling — ` +
        `charged per departure — will be a heavy line on it. It eases with distance: around a ` +
        `quarter of revenue near 900 km against roughly half of it under 300 km.`));
    panel.append(short);
  }

  const actions = el('div', 'prospect-actions');
  const open = el('button', 'wide-action wide-action--primary') as HTMLButtonElement;
  open.type = 'button';
  open.textContent = `Open sector — ${usd(cost)}`;
  open.disabled = !affordable;
  if (!affordable) open.title = 'Not enough cash.';
  open.addEventListener('click', () => callbacks.onOpenProspect());
  const drop = el('button', 'wide-action') as HTMLButtonElement;
  drop.type = 'button';
  drop.textContent = 'Discard';
  drop.addEventListener('click', () => callbacks.onDiscardProspect());
  actions.append(open, drop);
  panel.append(actions);
}

/**
 * One rival's network, in the pane under the map.
 *
 * There was no way to read a competitor's route map at all. Hovering an arc lit
 * their network, which only helps if you already know where to point, and the
 * annual-report sheet counts their sectors without saying where any of them are.
 * Knowing where a competitor flies — and which of it touches you — is squarely a
 * board-level question, so it belongs on the board.
 */
function renderCarrier(
  panel: HTMLElement,
  state: GameState,
  index: MarketIndex,
  carrier: GameState['carriers'][number],
  highlightedRouteId: string | null,
  callbacks: InspectorCallbacks,
): void {
  const routes = state.routes.filter((r) => r.carrierId === carrier.id);
  const mine = new Set(
    state.routes
      .filter((r) => r.carrierId === state.playerCarrierId)
      .map((r) => marketKey(r.from, r.to)),
  );

  const head = el('div', 'inspector-head');
  const title = el('h2', 'inspector-title');
  title.textContent = carrier.name;
  title.style.borderLeft = `3px solid ${carrier.color}`;
  title.style.paddingLeft = '9px';
  head.append(title);
  const sub = el('p', 'inspector-sub');
  sub.textContent = carrier.archetypeId
    ? `${getArchetype(carrier.archetypeId).name} · based at ${getCity(carrier.homeCityId).name}`
    : `Based at ${getCity(carrier.homeCityId).name}`;
  head.append(sub);
  panel.append(head);

  const overlap = routes.filter((r) => mine.has(marketKey(r.from, r.to))).length;
  const figures = el('dl', 'figures figures--ops');
  figures.append(figure('Worth', usd(marketCap(state, carrier))));
  figures.append(figure('Share price', rate(sharePrice(state, carrier))));
  figures.append(figure('Sectors', String(routes.length)));
  figures.append(figure('Aircraft', String(carrier.fleet.length)));
  const against = figure('Against you', overlap > 0 ? String(overlap) : '—');
  if (overlap > 0) against.classList.add('is-negative');
  against.title = 'Markets this carrier flies that you fly too.';
  figures.append(against);
  panel.append(figures);

  if (routes.length === 0) {
    panel.append(el('p', 'assign-empty', `${carrier.name} is not flying anything.`));
    return;
  }

  // Biggest sectors first: a network is read by where its weight sits.
  const rows = routes
    .map((route) => {
      const assigned = carrier.fleet.filter((t) => t.routeId === route.id);
      /*
       * What the sector earns THEM, priced exactly as their own books price it —
       * their technology, their cost base, and the rivals actually on the market
       * including you. This is the number that says whether a competitor can
       * afford to keep fighting you on a route, which is the whole reason to be
       * reading somebody else's network.
       */
      const econ = computeRouteEconomics(
        route, assigned, state.turn,
        conditionsFor(state, carrier, route, klassesOf(assigned)),
        rivalsOf(index, route), rivalCapacityOf(index, route),
        feedFactor(state.routes, carrier.id, route.from, route.to, route.id),
        stationOverheadFor(state.routes, carrier.id, route.from, route.to, true),
      );
      return {
        route,
        aircraft: assigned.length,
        km: distanceKm(getCity(route.from), getCity(route.to)),
        shared: mine.has(marketKey(route.from, route.to)),
        net: assigned.length > 0 ? econ.netCash : null,
      };
    })
    // Most profitable first: a network is read by where its money is, not by
    // where its metal happens to be parked.
    .sort((a, b) => (b.net ?? -Infinity) - (a.net ?? -Infinity) || b.km - a.km);

  const table = document.createElement('table');
  table.className = 'board-table';
  const head2 = document.createElement('thead');
  head2.innerHTML =
    '<tr><th scope="col">Sector</th><th scope="col" class="cell-num">km</th>' +
    '<th scope="col" class="cell-num">Aircraft</th><th scope="col">Posture</th>' +
    '<th scope="col" class="cell-num">Net/qtr</th><th scope="col"></th></tr>';
  table.append(head2);
  const body = document.createElement('tbody');
  for (const row of rows) {
    const tr = document.createElement('tr');
    const sector = document.createElement('th');
    sector.scope = 'row';
    sector.textContent = `${row.route.from}–${row.route.to}`;
    sector.title = `${getCity(row.route.from).name} – ${getCity(row.route.to).name}`;
    const dist = document.createElement('td');
    dist.className = 'cell-num';
    dist.textContent = km(row.km);
    const count = document.createElement('td');
    count.className = 'cell-num';
    // A sector with nothing on it is a sector they have opened and not filled.
    count.textContent = row.aircraft > 0 ? String(row.aircraft) : '—';
    const posture = document.createElement('td');
    // The label the dial uses, not the raw id: everywhere else in the interface
    // this reads "Undercut", and only here was it coming out "undercut".
    posture.textContent =
      POSTURES.find((o) => o.id === row.route.posture)?.label ?? row.route.posture;
    const net = document.createElement('td');
    net.className = 'cell-num';
    if (row.net === null) {
      net.textContent = '—';
      net.title = 'Nothing assigned, so the sector earns nothing either way.';
    } else {
      net.textContent = usd(row.net);
      net.classList.toggle('is-negative', row.net < 0);
      net.title = row.net < 0
        ? `${carrier.name} loses ${usd(-row.net)} a quarter flying this — it cannot keep that up forever.`
        : `${carrier.name} makes ${usd(row.net)} a quarter on this sector.`;
    }
    const flag = document.createElement('td');
    if (row.shared) {
      flag.textContent = 'you fly this';
      flag.className = 'is-negative';
    }
    tr.append(sector, dist, count, posture, net, flag);
    // Pick this sector out on the map. The list stays put so several can be
    // stepped through, which is how you actually read somebody's network.
    const picked = highlightedRouteId === row.route.id;
    tr.classList.add('is-pickable');
    tr.classList.toggle('is-picked', picked);
    tr.style.setProperty('--pick', carrier.color);
    tr.tabIndex = 0;
    tr.setAttribute('role', 'button');
    tr.setAttribute('aria-pressed', String(picked));
    tr.title = picked
      ? 'Stop picking this sector out'
      : `Show ${row.route.from}–${row.route.to} on the map`;
    const pick = (): void => callbacks.onHighlightRoute(picked ? null : row.route.id);
    tr.addEventListener('click', pick);
    tr.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      pick();
    });
    body.append(tr);
  }
  table.append(body);
  panel.append(table);
}

function renderConsolidated(panel: HTMLElement, state: GameState): void {
  const last = state.history.filter((h) => h.carrierId === state.playerCarrierId).at(-1);

  const head = el('div', 'inspector-head');
  head.append(el('h2', 'inspector-title', last ? `${turnLabel(last.turn - 1, state.startYear)} result` : 'No quarters flown'));
  if (!last) {
    /*
     * Before the first quarter is flown there are no results to show, but WHY there
     * are none differs: history hands over an airline already flying, so telling that
     * player to open a sector and put an aircraft on it describes work they inherited
     * done. The board it sits beside shows three sectors at 86% load.
     */
    const flying = state.routes.some((r) => r.carrierId === state.playerCarrierId);
    head.append(el('p', 'inspector-sub', flying
      ? 'Close the books to fly your first quarter and see what this airline earns.'
      : 'Open a sector, put an aircraft on it, then close the books.'));
    panel.append(head);
    return;
  }
  panel.append(head);

  /*
   * Same cost lines as the sector dossier, so they carry the same explanations —
   * a player reading "why did I lose money this quarter" is at least as likely to
   * be looking here as at one sector, and these had no notes at all.
   */
  const list = el('dl', 'figures');
  list.append(tip(figure('Revenue', usd(last.revenue)),
    'Everything the airline took this quarter: ticket revenue plus belly freight, across every sector.'));
  list.append(tip(costLine('Fuel', last.fuel),
    'Burn times sector length times the market fuel price, across the network. It scales with '
    + 'distance and aircraft size rather than with how full you fly, and hedging fixes the price '
    + 'on part of it in advance.'));
  list.append(tip(costLine('Crew', last.crew),
    'Flight and cabin crew for the hours flown. Bought locally, so it tracks the economic weight '
    + 'of the cities you fly out of.'));
  list.append(tip(costLine('Maintenance', last.maintenance),
    'Upkeep across the fleet. It climbs with airframe age along a flattening curve, so an old '
    + 'fleet costs more every quarter — heavy checks reset it, predictive maintenance bends it.'));
  list.append(tip(costLine('Handling', last.handling),
    'Ground costs in two parts: one charged on every departure, so short sectors that fly often '
    + 'pay it hardest; and one charged per passenger, which your fare posture '
    + 'multiplies — serving a Skim passenger costs about four and a half times a Match one. '
    + 'Neither half is fixed by filling seats, which is why a busy-looking airline can still '
    + 'lose money here.'));
  list.append(tip(costLine('Leases', last.lease),
    'Rent on every leased aircraft, owed whether it flies or sits. Owned aircraft cost you '
    + 'depreciation on the sector sheets instead of rent here.'));
  list.append(tip(costLine('Standing', last.standing),
    'The cost of keeping an aircraft at all, owned or leased — insurance, admin, parking — '
    + 'charged per seat every quarter, flying or not. Aircraft you have not assigned to anything still owe it.'));
  list.append(tip(costLine('Stations', last.fixed),
    'What it costs to keep each city on your network, plus a per-sector charge. A station costs '
    + 'the same whether one sector uses it or six, so more sectors through the cities you already '
    + 'serve is what brings this down.'));
  list.append(tip(costLine('Overhead', last.overhead),
    'Head office riding on what the airline spends flying — IT, sales, scheduling, admin. A flat '
    + 'uplift on the operating lines above, so it only falls when they do.'));
  // Interest is charged below the operating line and can dwarf every cost above
  // it on a leveraged carrier — show it whenever there is debt to service, so the
  // net reconciles with the lines above rather than leaving an unexplained gap.
  if (last.interest > 0) {
    const interest = costLine('Interest', last.interest);
    interest.title = 'The quarter\'s debt service. On a highly-geared airline this is often the largest single cost — pay debt down to shrink it.';
    list.append(interest);
  }
  if (last.dividendIncome && last.dividendIncome > 0) {
    const div = figure('Dividend income', usd(last.dividendIncome));
    div.title = 'Dividends collected this quarter on your stakes in other carriers.';
    list.append(div);
  }
  list.append(tip(costLine('Tax', last.tax),
    'Corporation tax on the quarter\u2019s profit. A loss-making quarter pays none.'));
  const net = figure('Net', usd(last.netIncome), last.netIncome < 0);
  net.classList.add('figure-total');
  list.append(net);
  panel.append(list);
}

function renderRoute(
  panel: HTMLElement,
  state: GameState,
  index: MarketIndex,
  route: Route,
  callbacks: InspectorCallbacks,
): void {
  const carrier = getCarrier(state, route.carrierId);
  const assigned = assignedTo(carrier, route.id);
  /*
   * The tail actually in service, not just the first one purchased.
   *
   * `assigned` is in fleet purchase order, not delivery order, so `assigned[0]`
   * can be a tail ordered but not yet delivered. Shared by the verdict label below
   * and the spill alert further down, so the two never name a different aircraft
   * for the same sector.
   */
  const flying = assigned.find((a) => state.turn >= a.deliversTurn) ?? assigned[0];
  const board = marketBoard(state, index, route);
  const feed = feedFactor(state.routes, carrier.id, route.from, route.to, route.id);
  const stationOverhead = stationOverheadFor(state.routes, carrier.id, route.from, route.to, true);
  const econ = computeRouteEconomics(
    route, assigned, state.turn, conditionsFor(state, carrier, route, klassesOf(assigned)),
    rivalsOf(index, route), rivalCapacityOf(index, route), feed, stationOverhead,
  );

  // --- Header: what this sector is, and the levers on it ---
  const head = el('div', 'inspector-head');
  const title = el('h2', 'inspector-title');
  title.textContent = `${route.from}–${route.to}`;
  const sub = el('p', 'inspector-sub');
  sub.textContent = `${getCity(route.from).name} – ${getCity(route.to).name} · ${km(econ.distanceKm)} km`;
  head.append(title, sub);

  const controls = el('div', 'inspector-controls');
  const postureGroup = el('div', 'posture');
  postureGroup.setAttribute('role', 'group');
  postureGroup.setAttribute('aria-label', 'Pricing posture');

  /*
   * What the notch under the cursor would actually do.
   *
   * The reason people ask for a fare box is not that they want to type 1,050
   * instead of 1,000 — it is that they cannot see the elasticity, so the buttons
   * feel like a vibe. Priced through the same `computeRouteEconomics` the quarter
   * settles on, so this is the real curve and not a rule of thumb. Still a
   * forecast: an event can wreck it, and the wording says so.
   */
  const preview = el('p', 'posture-preview');
  const previewFor = (posture: PricingPosture): RouteEconomics => {
    const hypothetical = { ...route, posture };
    return computeRouteEconomics(
      hypothetical, assigned, state.turn,
      conditionsFor(state, carrier, hypothetical, klassesOf(assigned)),
      rivalsOf(index, route), rivalCapacityOf(index, route), feed, stationOverhead,
    );
  };
  const describe = (posture: PricingPosture): string => {
    const e = previewFor(posture);
    const delta = e.netCash - econ.netCash;
    const move = posture === route.posture
      ? 'flying now'
      : `${delta >= 0 ? '+' : '−'}${usd(Math.abs(delta))} against it`;
    return `${usd(e.fareOneWay)} fare · ${Math.round(e.paxCarriedWeekly).toLocaleString('en-US')} pax/wk · ` +
      `${pct(e.loadFactor)} load · ${usd(e.netCash)} a quarter — ${move}`;
  };
  const restPreview = (): void => {
    preview.textContent = assigned.length > 0
      ? `Now: ${describe(route.posture)}`
      : 'Assign an aircraft to see what each posture would earn.';
  };

  for (const option of POSTURES) {
    const button = el('button', 'posture-option', option.label) as HTMLButtonElement;
    button.type = 'button';
    button.title = option.hint;
    button.setAttribute('aria-pressed', String(route.posture === option.id));
    button.classList.toggle('is-active', route.posture === option.id);
    button.addEventListener('click', () => callbacks.onSetPosture(route.id, option.id));
    // Focus as well as hover: this is the only place the elasticity is visible,
    // and it must not be mouse-only.
    const show = (): void => {
      if (assigned.length === 0) return;
      preview.textContent = `${option.label}: ${describe(option.id)}`;
    };
    button.addEventListener('mouseenter', show);
    button.addEventListener('focus', show);
    button.addEventListener('mouseleave', restPreview);
    button.addEventListener('blur', restPreview);
    postureGroup.append(button);
  }
  restPreview();
  const closeButton = el('button', 'drop-action', 'Close sector') as HTMLButtonElement;
  closeButton.type = 'button';
  closeButton.addEventListener('click', () => callbacks.onCloseRoute(route.id));
  controls.append(postureGroup, closeButton);
  head.append(controls);
  panel.append(head);
  /*
   * On its own line, OUTSIDE the header.
   *
   * Put inside it, the preview became another item in the header's flex row and
   * sat beside the buttons — so every time the text changed length the whole dial
   * slid sideways under the cursor. Measured: the buttons moved 32px between one
   * notch's preview and the next, which makes the control genuinely hard to use
   * and is exactly the kind of thing that reads as jank.
   */
  panel.append(preview);

  // --- Operating figures ---
  const ops = el('dl', 'figures figures--ops');
  const market = figure('Market', `${Math.round(econ.marketDemandWeekly).toLocaleString('en-US')}/wk`);
  market.title =
    'Passengers a week the whole city pair wants, both directions, before anyone competes for '
    + 'them. It comes from the two cities\u2019 size and wealth and the distance between them, and '
    + 'it is the ceiling every carrier on this sector is splitting.';
  ops.append(market);
  const shareFig = figure('Your share', pct(econ.demandShare));
  // When the carrier's network lifts this sector, say so — it is otherwise an
  // invisible reason two carriers on identical metal split a market unevenly.
  const shareBase =
    'Your slice of the market above, set by how attractive your service is against everyone '
    + 'else flying it: how often you go, your fare posture, the aircraft you use and the '
    + 'network feeding it. ';
  shareFig.title = feed > 1.005
    ? shareBase
      + `It includes a +${Math.round((feed - 1) * 100)}% hub-feed bonus: your other routes at `
      + `${route.from} and ${route.to} funnel connecting traffic onto this sector.`
    : shareBase
      + 'More frequency here would raise it, with diminishing returns.';
  ops.append(shareFig);
  /*
   * Judged at the precision the panel prints, not in raw floats. A load of 0.8799
   * against a ceiling of 0.8800 renders as "88%" and "88%", and the strict comparison
   * then captioned it "Below your ceiling of 88%" — words contradicting the two
   * numbers sitting beside them, which reads as a bug whichever one you believe.
   */
  const atCeiling = econ.capacityWeekly > 0
    && Math.round(econ.loadFactor * 100) >= Math.round(econ.loadCeiling * 100);
  const load = figure('Load factor', pct(econ.loadFactor));
  /*
   * Three states, not two. With nothing assigned the old text read "there is not
   * enough demand to fill the seats you are flying" beside `Seats/wk 0` — blaming the
   * market for an empty sector, which is exactly the state a player is in for the
   * first minute after opening one.
   */
  load.title = econ.capacityWeekly <= 0
    ? (assigned.length === 0
      ? 'Nothing is assigned, so there are no seats to fill. Put an aircraft on the sector and '
        + 'this becomes the share of its seats you sell.'
      // Assigned but still on order: the sector has metal promised to it and none of it
      // here yet, which is neither "empty" nor "flying badly".
      : 'Nothing assigned here has been delivered yet, so no seats are being flown. This '
        + 'becomes the share of them you sell once it arrives.')
    : atCeiling
      ? `Full — you are selling every seat the market lets you. ${pct(econ.loadCeiling)} is the `
        + 'ceiling here: nobody sells the last seat on every departure, and rivals flying this '
        + 'market push it lower still. Revenue management, dynamic pricing, network planning '
        + 'and a loyalty program each raise it.'
      : `Below your ceiling of ${pct(econ.loadCeiling)}: you are not winning enough traffic to `
        + 'fill the seats you fly. More frequency or a lower fare wins more of the market — '
        + 'and fewer seats would raise the percentage without carrying one extra passenger.';
  ops.append(load);
  // Break-even sits directly beside the load actually flown, so the comparison that
  // decides whether this sector pays is two adjacent cells rather than a sentence.
  if (assigned.length > 0) ops.append(breakevenFigure(econ, route.posture));
  const seats = figure('Seats/wk', Math.round(econ.capacityWeekly).toLocaleString('en-US'));
  seats.title =
    'Seats you are offering here each week, both directions: seats per departure times departures a week. This is '
    + 'what you are paying to fly whether or not anyone sits in it.';
  ops.append(seats);
  const trips = figure('Round trips', `${econ.frequencyWeekly.toFixed(1)}/wk`);
  trips.title = completionNote(
    assigned.map((a) => a.typeId), econ.distanceKm, econ.frequencyWeekly,
  );
  ops.append(trips);
  const fare = figure('Fare', usd(econ.fareOneWay));
  const premiumPct = Math.round((econ.competitionMultiplier - 1) * 100);
  fare.title = premiumPct >= 1
    ? `Includes a +${premiumPct}% premium for an uncontested market — real fares run highest where no rival competes. ` +
      `It erodes toward the competitive fare as rivals add capacity here.`
    : 'The competitive fare: rivals are flying enough capacity here that the market has priced out any monopoly premium.';
  ops.append(fare);
  const pax = figure('Passengers', `${Math.round(econ.paxCarriedWeekly).toLocaleString('en-US')}/wk`);
  pax.title =
    'Passengers you actually carried, both directions, after the market was split and anyone '
    + 'who could not be seated went to a rival instead. Seats offered minus this is what you flew empty.';
  ops.append(pax);
  // The single most actionable number on a full sector: traffic you won and had
  // to turn away for want of seats.
  if (econ.spilledWeekly > 1) {
    const spill = figure(
      'Turned away',
      `${Math.round(econ.spilledWeekly).toLocaleString('en-US')}/wk`,
      true,
    );
    spill.title =
      'Passengers who chose you and could not be seated. Put more aircraft on the sector, ' +
      'fly a bigger aircraft, or raise how full you can fly.';
    ops.append(spill);
  }
  panel.append(ops);
  // Nothing assigned is not a verdict — breakevenLoad returns null on zero
  // capacity, and printing "cannot pay" over an empty sector reads as a red flag
  // where there is simply nothing to judge yet.
  if (assigned.length > 0 && flying) {
    panel.append(verdictNote(
      econ, route.posture,
      `At ${POSTURES.find((o) => o.id === route.posture)?.label ?? route.posture}, this sector`,
    ));
  }

  /*
   * Spill is a prompt, not an instruction — and the instruction it used to give was
   * wrong twice over.
   *
   * It said "clearing it needs at least Nx the metal". Where each aircraft loses
   * money that is exactly backwards: measured on LON-PAR with widebodies, net runs
   * -0.4M, -1.4M, -2.9M, -5.1M, -7.8M as aircraft are added, and the alert fired at
   * one and two telling the player to add more. And even where the sector pays,
   * clearing the spill overshoots the peak: the same sector with narrowbodies peaks
   * at +1.6M on three or four and falls to +1.3M on five. CLAUDE.md §6 says profit
   * "peaks at a fleet size rather than scaling for ever" — the alert was arguing with
   * the design doc.
   *
   * The player's question is never "what clears the spill", it is "does one more
   * plane help". That is one extra pricing call, so it is answered exactly — priced
   * against the same conditions, rivals and feed as the figures printed above it,
   * not recomputed from scratch.
   */
  // `flying` in the guard, not asserted inside: every branch now clones it for the
  // probe, and carrying passengers already implies something is assigned and
  // delivered — so let the compiler know rather than insisting.
  if (flying && econ.spilledWeekly > econ.paxCarriedWeekly && econ.paxCarriedWeekly > 0) {
    const ratio = econ.spilledWeekly / econ.paxCarriedWeekly;
    const achievable = achievableBreakeven(breakevenLoad(econ, route.posture));
    // Against the load actually flown, not the ceiling — see `achievableBreakeven`.
    const cannotPay = achievable === null || achievable >= econ.loadFactor;
    const note = el('p', 'sector-flag');

    /*
     * Price one more aircraft — ALWAYS, including when the sector is losing money.
     *
     * This used to short-circuit on `cannotPay` and assert that "more aircraft deepen
     * the loss", which is the opposite of the truth often enough to matter: the
     * station charge and the sector fee are per-SECTOR, not per-aircraft, so a second
     * aircraft carries none of them and break-even falls as the fleet grows. Measured
     * on Mexico City-New York at Match: one aircraft loses $91K at a break-even of
     * 88.5% against 87.5% load, and two make $192K at 86.2% — the advice said to
     * shrink where the answer was to grow. And it fired precisely on sectors turning
     * traffic away, which is where adding capacity is most likely to be right.
     *
     * Clone from a tail that is actually FLYING, not just the first one assigned.
     * `assigned` is in purchase order, and a tail can be assigned before it arrives;
     * cloning one of those inherits its future `deliversTurn`, and the probe would
     * fly nothing and add zero capacity — making "one more would add about $0" look
     * like an answer when it is an artefact.
     */
    const extra = [...assigned, { ...flying, id: `${flying.id}-probe`, deliversTurn: state.turn }];
    const withMore = computeRouteEconomics(
      route, extra, state.turn,
      conditionsFor(state, carrier, route, klassesOf(extra)),
      rivalsOf(index, route), rivalCapacityOf(index, route), feed, stationOverhead,
    );
    const delta = withMore.netCash - econ.netCash;
    const name = getAircraftType(flying.typeId).name;
    const spills = `${STRINGS.sector.spilling} It turns away ${ratio.toFixed(1)}x what it carries`;

    if (!cannotPay) {
      note.textContent = delta > 0
        ? `${spills}. One more ${name} would add about ${usd(delta)} a quarter.`
        : `${spills}, but you are at the profitable size — another ${name} would cost about `
          + `${usd(-delta)} a quarter.`;
    } else if (delta > 0) {
      // Losing at this size, but growing into it: the fixed half of the cost base is
      // carried by the sector, so the next aircraft joins a cheaper one.
      note.textContent = `${spills}, and at this size it does not cover its costs — but the `
        + `station does not charge twice for a second aircraft. One more ${name} would add `
        + `about ${usd(delta)} a quarter`
        + (withMore.netCash > 0 ? ' and put the sector into profit.' : ', though it would still lose money.');
    } else {
      note.classList.add('is-negative');
      note.textContent = `${spills}, and each aircraft here loses money — breakeven `
        + `${achievable === null ? 'is unreachable' : pct(achievable)} against your load of `
        + `${pct(econ.loadFactor)} (ceiling ${pct(econ.loadCeiling)}). Another ${name} would `
        + `deepen it by about ${usd(-delta)} a quarter; try a cheaper posture, a different `
        + `aircraft, or a longer sector.`;
    }
    panel.append(note);
  }

  panel.append(competitionTable(state, board, route));
  panel.append(routePnl(econ, route.posture, {
    from: getCity(route.from).name,
    to: getCity(route.to).name,
    atFrom: state.routes.filter((r) => r.carrierId === carrier.id && (r.from === route.from || r.to === route.from)).length,
    atTo: state.routes.filter((r) => r.carrierId === carrier.id && (r.from === route.to || r.to === route.to)).length,
  }));
  panel.append(fleetRow(state, route, assigned, econ, callbacks));
}

/**
 * Who else flies this market and how they are doing on it.
 *
 * Figures for rivals are the real ones the sim settles, not estimates. Airlines
 * do not publish route-level accounts, but an operator can read a competitor's
 * schedule and aircraft off the departure board and get close — and a player who
 * cannot tell whether a rival is bleeding or thriving on a sector has no basis
 * for deciding whether to fight them or leave.
 */
/** "2x Aros N3" — or every type, when a carrier mixes gauge on one sector. */
function equipmentOf(typeIds: readonly string[]): string {
  const counts = new Map<string, number>();
  for (const id of typeIds) counts.set(id, (counts.get(id) ?? 0) + 1);
  return [...counts]
    .map(([id, n]) => `${n > 1 ? `${n}\u00d7 ` : ''}${getAircraftType(id).name}`)
    .join(' \u00b7 ');
}

/**
 * Round trips a fleet could fly if nothing were canceled. `frequencyWeekly` in
 * RouteEconomics is what actually operated, which is that figure times the
 * carrier's completion — so two carriers on identical metal fly different
 * schedules, and the difference is reliability they bought.
 */
function scheduledTrips(typeIds: readonly string[], dist: number): number {
  let total = 0;
  for (const id of typeIds) {
    const type = getAircraftType(id);
    if (canReach(type, dist)) total += rotationsPerWeek(type, dist);
  }
  return total;
}

/** "11.3 scheduled, 96% of it operated" — why an identical fleet flies less. */
function completionNote(typeIds: readonly string[], dist: number, operated: number): string {
  const scheduled = scheduledTrips(typeIds, dist);
  if (scheduled <= 0) return '';
  const rate = Math.min(1, operated / scheduled);
  return (
    `${scheduled.toFixed(1)} round trips scheduled, ${pct(rate)} of them operated. ` +
    `Weather, faults and air traffic control take the rest — predictive maintenance, ` +
    `an operations control center and in-house ground handling all buy it back.`
  );
}

/** A carrier's technology, resolved for display. */
function summariseTech(tech: readonly string[]): ReturnType<typeof techSummary> {
  return techSummary(tech, techEffects(tech), (id) => getTechNode(id).name, {
    loadCeiling: CONSTANTS.demand.maxLoadFactor,
    loadCeilingMax: CONSTANTS.demand.loadCeilingMax,
  });
}

/** Seats a carrier is offering per departure, for the equipment tooltip. */
function gaugeOf(typeIds: readonly string[], posture: PricingPosture): string {
  if (typeIds.length === 0) return '';
  const seats = typeIds.map((id) => Math.round(seatsUnder(getAircraftType(id), posture)));
  const low = Math.min(...seats);
  const high = Math.max(...seats);
  return low === high ? `${low} seats a departure` : `${low}-${high} seats a departure`;
}

function competitionTable(
  state: GameState,
  board: readonly {
    carrierId: string;
    econ: RouteEconomics;
    owned: number;
    leased: number;
    typeIds: readonly string[];
    routeId: string;
    netWithoutTech: number;
  }[],
  route: Route,
): HTMLElement {
  const wrap = el('div', 'market-board');
  wrap.append(el('span', 'assign-label', 'On this market'));

  /*
   * Carriers that have OPENED this market but are not flying it.
   *
   * The share table is built from the market index, which counts only aircraft
   * that exist and are delivered — correctly, since a carrier takes no traffic
   * until it flies. But that made an entrant invisible for the quarter or two
   * before its metal lands, measured at 3.5% of route-quarters, and since the map
   * now draws their announced sector as a dashed line the panel was contradicting
   * something the player could see. Entry is the earliest warning there is.
   */
  const key = marketKey(route.from, route.to);
  const onBoard = new Set(board.map((b) => b.carrierId));
  const incoming = state.carriers.filter(
    (c) =>
      c.id !== route.carrierId &&
      c.bankruptTurn === null &&
      !onBoard.has(c.id) &&
      state.routes.some((r) => r.carrierId === c.id && marketKey(r.from, r.to) === key),
  );
  const incomingNote = incoming.length > 0
    ? el('p', 'sector-incoming', STRINGS.sector.incoming(incoming.map((c) => c.name)))
    : null;

  /*
   * A sector nobody contests gets the SAME one-line row as a contested one.
   *
   * It used to take a branch of its own that printed the whole technology panel
   * inline — every delivered program and every effect it has, unfolded — so the
   * quietest sector on the board produced by far the tallest panel. The
   * technology is worth surfacing, but it is worth surfacing the way it already
   * is on a contested market: a figure in the Tech column, with the breakdown
   * behind the same expandable row. One design, not two.
   */
  if (board.length <= 1) {
    wrap.append(el('span', 'assign-empty', STRINGS.sector.uncontested));
  }
  if (incomingNote) wrap.append(incomingNote);
  // Nothing is flying, so there is no standing to tabulate — the dormant note
  // under the sector already says so.
  if (board.length === 0) return wrap;

  const table = document.createElement('table');
  table.className = 'board-table';
  const head = document.createElement('thead');
  head.innerHTML =
    '<tr><th scope="col">Carrier</th><th scope="col">Equipment</th>' +
    '<th scope="col">Held</th><th scope="col" class="cell-num">Tech</th>' +
    '<th scope="col" class="cell-num">Seats/wk</th>' +
    '<th scope="col" class="cell-num">Trips/wk</th><th scope="col" class="cell-num">Share</th>' +
    '<th scope="col" class="cell-num">Load</th><th scope="col" class="cell-num">Fare</th>' +
    '<th scope="col" class="cell-num">Metal</th><th scope="col" class="cell-num">Net</th></tr>';
  table.append(head);

  const body = document.createElement('tbody');
  for (const standing of board) {
    const carrier = state.carriers.find((c) => c.id === standing.carrierId);
    if (!carrier) continue;
    const isMine = standing.carrierId === route.carrierId;
    const row = document.createElement('tr');
    if (isMine) row.className = 'is-you';

    const name = document.createElement('th');
    name.scope = 'row';
    name.textContent = isMine ? 'You' : carrier.name;
    name.style.borderLeft = `3px solid ${carrier.color}`;
    name.style.paddingLeft = '7px';

    const e = standing.econ;
    const theirPosture =
      state.routes.find((r) => r.id === standing.routeId)?.posture ?? 'match';
    const tech = summariseTech(carrier.tech);
    const held =
      standing.owned > 0 && standing.leased > 0 ? `${standing.owned} own, ${standing.leased} lease`
      : standing.owned > 0 ? 'owned'
      : standing.leased > 0 ? 'leased'
      : '—';
    // Described rather than indexed: a positional `cells[7]` silently styles the
    // wrong column the moment one is inserted.
    const columns: { text: string; numeric?: boolean; title?: string; negative?: boolean }[] = [
      {
        // The count lives here rather than in a column of its own: "5x Aros N3"
        // already says how many, and the seats they add up to is the number that
        // actually explains a rival's traffic.
        text: equipmentOf(standing.typeIds) || '—',
        // Their posture, not yours: a premium cabin takes seats out of the same
        // airframe, which is half of why two carriers on one type differ.
        title: gaugeOf(standing.typeIds, theirPosture),
      },
      { text: held },
      {
        // What a rival has bought, and what it is worth to them. Nothing else on
        // the board explains two carriers on identical metal differing by ten
        // points of margin.
        text: tech.count > 0 ? String(tech.count) : '—',
        numeric: true,
        title: tech.detail,
      },
      { text: Math.round(e.capacityWeekly).toLocaleString('en-US'), numeric: true },
      {
        text: e.frequencyWeekly.toFixed(1),
        numeric: true,
        title: completionNote(standing.typeIds, e.distanceKm, e.frequencyWeekly),
      },
      { text: pct(e.demandShare), numeric: true },
      {
        text: e.capacityWeekly > 0 ? pct(e.loadFactor) : '—',
        numeric: true,
        // How full they can fly is bought, not given. Two carriers on the same
        // metal filling 88% and 93% is a technology gap, not luck.
        title:
          e.capacityWeekly > 0
            ? e.loadFactor >= e.loadCeiling - 1e-9
              ? `Full — ${pct(e.loadCeiling)} is their ceiling`
              : `Their ceiling is ${pct(e.loadCeiling)}`
            : '',
      },
      { text: usd(e.fareOneWay), numeric: true },
      // The cost of the metal: rent on leased tails, depreciation on owned ones.
      // A leased carrier pays a lessor; an owned one writes down its own asset.
      { text: e.lease > 0 ? usd(-e.lease) : e.ownership > 0 ? usd(-e.ownership) : '—', numeric: true },
      // Economic net — after depreciation — so an owned fleet does not read as
      // free money next to a leased rival.
      { text: usd(e.netEconomic), numeric: true, negative: e.netEconomic < 0 },
    ];
    const cells = columns.map((column) => {
      const td = document.createElement('td');
      td.className = column.numeric ? 'cell-num' : 'market-class';
      td.textContent = column.text;
      if (column.title) td.title = column.title;
      if (column.negative) td.classList.add('is-negative');
      return td;
    });

    row.append(name, ...cells);

    // A disclosure rather than a tooltip: what a rival's technology is worth has
    // to be readable next to everyone else's, and a title attribute can only be
    // seen one at a time — and never on a keyboard or a touch screen.
    const detail = document.createElement('tr');
    detail.className = 'board-detail';
    detail.hidden = true;
    const cell = document.createElement('td');
    cell.colSpan = cells.length + 1;
    cell.append(techPanel(tech, e.netCash - standing.netWithoutTech));
    detail.append(cell);

    row.classList.add('is-expandable');
    row.tabIndex = 0;
    row.setAttribute('role', 'button');
    row.setAttribute('aria-expanded', 'false');
    const toggle = (): void => {
      detail.hidden = !detail.hidden;
      row.setAttribute('aria-expanded', String(!detail.hidden));
      row.classList.toggle('is-open', !detail.hidden);
    };
    row.addEventListener('click', toggle);
    row.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      toggle();
    });

    body.append(row, detail);
  }
  table.append(body);
  wrap.append(table);
  // A third carrier can be on its way in while two are already fighting.
  if (incomingNote) wrap.append(incomingNote);
  return wrap;
}

function routePnl(
  econ: RouteEconomics,
  posture: PricingPosture,
  stations?: { from: string; to: string; atFrom: number; atTo: number },
): HTMLElement {
  const list = el('dl', 'figures');
  // Two revenue lines, the way an airline reports them. Folding freight into a
  // single "Revenue" would hide the reason a widebody is worth flying at all on a
  // long sector: the hold earns whether or not the cabin fills.
  if (econ.cargo > 0) {
    // Not "Passengers": this panel already shows a passenger COUNT a few lines
    // up, and the same word for a headcount and a revenue line reads as a bug.
    const pax = figure('Fares', usd(econ.revenue - econ.cargo));
    pax.title = 'Ticket revenue — what the passengers this sector carried paid.';
    list.append(pax);
    const freight = figure('Cargo', usd(econ.cargo));
    freight.title =
      'Belly freight. It rides on scheduled capacity and sector length, not on how ' +
      'full the cabin is — so it holds up on a thin route where the passenger side ' +
      'does not. Widebody holds earn roughly ten times a narrowbody\u2019s per seat.';
    list.append(freight);
  } else {
    const rev = figure('Revenue', usd(econ.revenue));
    rev.title = 'Ticket revenue — what the passengers this sector carried paid.';
    list.append(rev);
  }

  const fuel = costLine('Fuel', econ.fuel);
  fuel.title =
    'Burn times sector length times the market fuel price. It scales with distance and ' +
    'with how big the aircraft is, not with how full it is — an empty seat burns the same ' +
    'fuel as a sold one. Hedging fixes the price you pay on part of it.';
  list.append(fuel);

  const crew = costLine('Crew', econ.crew);
  crew.title =
    'Flight and cabin crew for the hours flown. Bought locally, so it tracks the economic ' +
    'weight of the cities at each end: the same aircraft on the same length of sector costs ' +
    'more crew out of an expensive market than a cheap one.';
  list.append(crew);

  const maint = costLine('Maintenance', econ.maintenance);
  maint.title =
    'Upkeep on the aircraft assigned here. It climbs with airframe age along a curve that ' +
    'flattens out, so an old fleet costs more to run every quarter — a heavy check resets ' +
    'the clock, and predictive maintenance in the technology tree bends the curve.';
  list.append(maint);

  /*
   * Two halves, and which one dominates depends on what the player is doing.
   *
   * A small aircraft on a short hop pays mostly the PER-DEPARTURE half. A premium
   * posture pays mostly the PER-PASSENGER half — `paxCost` runs 4.6x at Skim against
   * 1.0 at Match on a $22 base, so a Skim passenger costs about $101 to serve. That
   * second case is the one a player reported and the one the first version of this
   * note missed entirely, because it only explained the per-departure story.
   *
   * The posture point matters because it inverts with distance: the cost uplift is a
   * flat number of dollars a head, while the fare uplift scales with sector length.
   * On a 343km sector Skim earns +$61 a head and costs +$79; on a 5,570km one it
   * earns +$353 for the same +$79.
   */
  const handling = costLine('Handling', econ.handling);
  // Nothing is flying yet on a sector whose metal has not arrived, and "flies 0
  // departures a week" inside a sentence about turning often reads as a fault.
  const deps = Math.round(econ.departuresWeekly);
  /*
   * The per-passenger RATE is quoted for the posture this sector is actually on,
   * not as a general rule.
   *
   * The rule alone is what the first version said, and it is not enough: a player
   * on Skim reads "premium postures cost more per head", agrees, and still has no
   * idea he is paying $101 a passenger where Match pays $22. That gap is what cost
   * a player a route and had three separate observers — him, the author, and a
   * second model reading the figures — call an intentional mechanism a bug.
   */
  const perPax = CONSTANTS.fleet.distributionPerPax * CONSTANTS.posture.paxCost[posture];
  const matchPax = CONSTANTS.fleet.distributionPerPax;
  const label = POSTURES.find((o) => o.id === posture)?.label ?? posture;
  handling.title =
    `Ground costs, in two parts. One is charged on every departure — gate, ramp, ` +
    `landing — ${deps > 0 ? `and this sector flies ${deps} departures a week, so ` : 'so '}` +
    `short sectors that fly often pay it hardest. The other is charged per passenger, at a rate ` +
    `your posture sets: ${label} costs about $${Math.round(perPax)} a head to serve` +
    `${posture === 'match' ? '' : `, against $${Math.round(matchPax)} at Match`}. The pricier ` +
    `postures earn that back on long sectors, not on short ones.`;
  list.append(handling);

  const lease = costLine('Leases', econ.lease);
  lease.title =
    'Rent on the leased aircraft assigned here, owed every quarter whether the sector ' +
    'flies well or badly. It is the price of not tying up capital in the aircraft — owned ' +
    'aircraft show as depreciation instead, and handing a lease back early carries a fee.';
  list.append(lease);
  // Owned aircraft carry depreciation where leased ones carry rent. Only shown
  // when there is owned metal on the sector, so a fully-leased route reads clean.
  if (econ.ownership > 0) {
    const dep = costLine('Depreciation', econ.ownership);
    dep.title =
      'The book value your owned aircraft on this sector lose each quarter. Not a ' +
      'cash cost — you paid for them up front — but the real cost of the aircraft, and ' +
      'what a leased aircraft pays as rent instead. It is why owning is not free here.';
    list.append(dep);
  }
  const standing = costLine('Standing', econ.standing);
  standing.title =
    'The cost of keeping an aircraft at all, owned or leased — insurance, admin, parking — ' +
    'charged per seat every quarter, whether it flies or sits. A parked aircraft still owes it, so ' +
    'an aircraft you have not assigned quietly drains cash, and a bigger one owes more.';
  list.append(standing);

  const station = costLine('Station', econ.fixed);
  if (stations) {
    // The one cost line on this sheet a player can act on by changing the SHAPE of
    // the network rather than the sector. Worth saying how, in place.
    const share = (city: string, n: number): string =>
      n > 1 ? `${city} is split ${n} ways` : `${city} is carried by this sector alone`;
    station.title =
      `Your share of the standing cost at each end: ${share(stations.from, stations.atFrom)}, ` +
      `${share(stations.to, stations.atTo)}. A station costs the same whether one sector ` +
      `uses it or six, so putting more sectors through the cities you already serve is what ` +
      `brings this line down — on this sector and on every other one touching them.`;
  }
  list.append(station);
  const overhead = costLine('Overhead', econ.overhead);
  overhead.title =
    'Head office riding on what the sector spends flying — IT, sales, scheduling, admin. ' +
    'A flat uplift on the operating lines above, so it cannot be cut on its own: it falls ' +
    'only when the costs it sits on top of fall.';
  list.append(overhead);

  const net = figure('Sector net', usd(econ.netEconomic), econ.netEconomic < 0);
  net.classList.add('figure-total');
  net.title =
    'Everything above, added up: what this sector contributed this quarter. It carries no ' +
    'share of debt interest or tax — those are company-level, not the sector\u2019s doing.';
  if (econ.ownership > 0) {
    net.title =
      `Economic contribution: cash of ${usd(econ.netCash)} after ${usd(econ.ownership)} ` +
      `depreciation on the owned aircraft. The cash is what reaches the bank; this is ` +
      `what the route is worth once the aircraft is paying for itself.`;
  }
  list.append(net);
  return list;
}

/** Assigned tails, plus the parked ones that could fly this sector. */
function fleetRow(
  state: GameState,
  route: Route,
  assigned: readonly { id: string; typeId: string; ownership: string }[],
  econ: RouteEconomics,
  callbacks: InspectorCallbacks,
): HTMLElement {
  const carrier = getCarrier(state, route.carrierId);
  const row = el('div', 'assign-row');

  const onSector = el('div', 'assign-group');
  onSector.append(el('span', 'assign-label', 'On this sector'));
  if (assigned.length === 0) {
    onSector.append(el('span', 'assign-empty', 'Nothing assigned — this sector is dormant.'));
  }
  for (const tail of assigned) {
    const type = getAircraftType(tail.typeId);
    const chip = el('button', 'chip', `${type.name} · ${tail.id}`) as HTMLButtonElement;
    chip.type = 'button';
    chip.title = `Take ${tail.id} off ${route.from}–${route.to}`;
    chip.addEventListener('click', () => callbacks.onUnassign(tail.id));
    onSector.append(chip);
  }
  row.append(onSector);

  const parked = carrier.fleet.filter((a) => a.routeId === null);
  if (parked.length > 0) {
    const pool = el('div', 'assign-group');
    pool.append(el('span', 'assign-label', 'Parked'));
    for (const tail of parked) {
      const type = getAircraftType(tail.typeId);
      const chip = el('button', 'chip chip-add', `${type.name} · ${tail.id}`) as HTMLButtonElement;
      chip.type = 'button';
      const reachable = econ.distanceKm <= type.rangeKm;
      chip.disabled = !reachable;
      chip.title = reachable
        ? `Put ${tail.id} on ${route.from}–${route.to}`
        : `${type.name} range is ${km(type.rangeKm)} km — ${km(econ.distanceKm)} km is too far`;
      chip.addEventListener('click', () => callbacks.onAssign(tail.id, route.id));
      pool.append(chip);
    }
    row.append(pool);
  }

  return row;
}
