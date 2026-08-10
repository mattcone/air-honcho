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
  computeRouteEconomics, assignedTo, feedFactor, marketBoard, openingCostFor, rivalCapacityOf,
  rivalsOf, seatsUnder, stationOverheadFor,
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
import { costLine, el, figure, techPanel } from './techpanel.ts';
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
 * Five notches, dearest first. Still one decision per sector — a posture, not a
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
    hint: 'The top of the market: fewest seats, dearest fares, dearest to serve. Only worth it where you are already turning people away at Premium — it sheds a lot of traffic to lift the yield on what is left.',
  },
  {
    id: 'premium',
    label: 'Premium',
    hint: 'A premium cabin: fewer seats, much dearer, and much dearer to serve. Wins where fares are high and you cannot fill a dense cabin anyway.',
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
    renderProspect(panel, state, prospect, callbacks);
  } else if (route && index) {
    renderRoute(panel, state, index, route, callbacks);
  } else if (focused && index) {
    renderCarrier(panel, state, index, focused, highlightedRouteId, callbacks);
  } else {
    renderConsolidated(panel, state);
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
  const preview = computeRouteEconomics(
    probe, [], state.turn, conditionsFor(state, player, probe, klassesOf([])), 0, 0, 1, 0,
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

  const stats = el('dl', 'figures');
  stats.append(figure('Market', `${Math.round(demand).toLocaleString('en-US')}/wk`));
  stats.append(figure('Distance', `${km(dist)} km`));
  stats.append(figure('Cost to open', usd(cost), !affordable));
  stats.append(figure('Cash', usd(player.cash)));
  panel.append(stats);

  // The cost, itemised. A single total cannot teach the rule; the split does.
  const breakdown = el('ul', 'prospect-costs');
  const line = (label: string, amount: number): HTMLElement => {
    const li = el('li');
    li.append(el('span', 'prospect-cost-label', label));
    li.append(el('span', 'prospect-cost-value', usd(amount)));
    return li;
  };
  breakdown.append(line('Slots and launch marketing', CONSTANTS.routes.openingCost));
  for (const city of fresh) {
    breakdown.append(line(`Standing up ${getCity(city).name}`, CONSTANTS.routes.newStationCost));
  }
  panel.append(breakdown);

  /*
   * What it costs to KEEP, which is the larger question and the one a one-off
   * total hides. Quoted as the share this sector would actually bear, because
   * that is the number that changes with where you open: hang a sector off two
   * busy stations and it carries a fraction of each, open into empty territory
   * and it carries both outright.
   */
  const ongoing = stationOverheadFor(state.routes, player.id, from, to, false)
    + CONSTANTS.routes.quarterlyFixedCost;
  const running = el('ul', 'prospect-costs');
  const runLine = el('li');
  runLine.append(el('span', 'prospect-cost-label', 'Then, every quarter'));
  runLine.append(el('span', 'prospect-cost-value', `${usd(ongoing)}/qtr`));
  running.append(runLine);
  panel.append(running);

  const note = el('p', 'prospect-note');
  note.textContent = fresh.length === 0
    ? 'You already serve both cities, so this sector opens cheaply and splits two stations that are already being paid for — it brings the station line down on your existing sectors there too.'
    : fresh.length === 1
      ? `${getCity(fresh[0]!).name} is new to your network. Standing it up is the small part; carrying it every quarter afterwards is the real cost, and it stays yours alone until you put more sectors through it.`
      : 'Neither city is on your network, so this sector stands up two stations and then carries both on its own, every quarter, until something else flies through them.';
  panel.append(note);

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
        ? `${carrier.name} loses ${usd(-row.net)} a quarter flying this — it cannot hold it for ever.`
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
    head.append(el('p', 'inspector-sub', 'Open a sector, put an aircraft on it, then close the books.'));
    panel.append(head);
    return;
  }
  panel.append(head);

  const list = el('dl', 'figures');
  list.append(figure('Revenue', usd(last.revenue)));
  list.append(costLine('Fuel', last.fuel));
  list.append(costLine('Crew', last.crew));
  list.append(costLine('Maintenance', last.maintenance));
  list.append(costLine('Handling', last.handling));
  list.append(costLine('Leases', last.lease));
  list.append(costLine('Standing', last.standing));
  list.append(costLine('Stations', last.fixed));
  list.append(costLine('Overhead', last.overhead));
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
  list.append(costLine('Tax', last.tax));
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
  ops.append(figure('Market', `${Math.round(econ.marketDemandWeekly).toLocaleString('en-US')}/wk`));
  const shareFig = figure('Your share', pct(econ.demandShare));
  // When the carrier's network lifts this sector, say so — it is otherwise an
  // invisible reason two carriers on identical metal split a market unevenly.
  if (feed > 1.005) {
    shareFig.title =
      `Includes a +${Math.round((feed - 1) * 100)}% hub-feed bonus: your other routes at ` +
      `${route.from} and ${route.to} funnel connecting traffic onto this sector.`;
  }
  ops.append(shareFig);
  const atCeiling = econ.capacityWeekly > 0 && econ.loadFactor >= econ.loadCeiling - 1e-9;
  const load = figure('Load factor', pct(econ.loadFactor));
  load.title = atCeiling
    ? `Full. ${pct(econ.loadCeiling)} is as much of the aircraft as you can sell — ` +
      `revenue management, capacity planning and a loyalty program all raise it.`
    : 'Below your ceiling: there is not enough demand to fill the seats you are flying.';
  ops.append(load);
  ops.append(figure('Seats/wk', Math.round(econ.capacityWeekly).toLocaleString('en-US')));
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
  ops.append(figure('Passengers', `${Math.round(econ.paxCarriedWeekly).toLocaleString('en-US')}/wk`));
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
      'fly a bigger gauge, or raise how full you can fly.';
    ops.append(spill);
  }
  panel.append(ops);

  /*
   * Spill is the growth compass, and until now the number sat there in red saying
   * nothing. When a sector turns away more than it carries, the fleet answer is
   * the headline — that is under-gauged metal, not a pricing problem, and no
   * amount of posture fixes it. Stated in aircraft, because that is the decision.
   */
  if (econ.spilledWeekly > econ.paxCarriedWeekly && econ.paxCarriedWeekly > 0) {
    const ratio = econ.spilledWeekly / econ.paxCarriedWeekly;
    // Seats needed to clear it is (carried + spilled) / carried, which is 1 + the
    // ratio, not the ratio: at 6.6x turned away you need ~7.6x the metal, not
    // 6.6x. And it is a FLOOR either way, because more capacity wins more share
    // and so raises the demand it has to seat — hence "at least".
    const metal = Math.ceil(1 + ratio);
    const note = el('p', 'sector-flag');
    note.textContent =
      `${STRINGS.sector.spilling} It turns away ${ratio.toFixed(1)}x what it carries — ` +
      `short of seats, not of demand. Clearing it needs at least ${metal}x the metal ` +
      `that is on it now.`;
    panel.append(note);
  }

  panel.append(competitionTable(state, board, route));
  panel.append(routePnl(econ, {
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

function routePnl(econ: RouteEconomics, stations?: { from: string; to: string; atFrom: number; atTo: number }): HTMLElement {
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
    list.append(figure('Revenue', usd(econ.revenue)));
  }
  list.append(costLine('Fuel', econ.fuel));
  list.append(costLine('Crew', econ.crew));
  list.append(costLine('Maintenance', econ.maintenance));
  list.append(costLine('Handling', econ.handling));
  list.append(costLine('Leases', econ.lease));
  // Owned aircraft carry depreciation where leased ones carry rent. Only shown
  // when there is owned metal on the sector, so a fully-leased route reads clean.
  if (econ.ownership > 0) {
    const dep = costLine('Depreciation', econ.ownership);
    dep.title =
      'The book value your owned aircraft on this sector lose each quarter. Not a ' +
      'cash cost — you paid for them up front — but the real cost of the metal, and ' +
      'what a leased aircraft pays as rent instead. It is why owning is not free here.';
    list.append(dep);
  }
  list.append(costLine('Standing', econ.standing));
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
  list.append(costLine('Overhead', econ.overhead));
  const net = figure('Sector net', usd(econ.netEconomic), econ.netEconomic < 0);
  net.classList.add('figure-total');
  if (econ.ownership > 0) {
    net.title =
      `Economic contribution: cash of ${usd(econ.netCash)} after ${usd(econ.ownership)} ` +
      `depreciation on the owned aircraft. The cash is what reaches the bank; this is ` +
      `what the route is worth once the metal is paying for itself.`;
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
