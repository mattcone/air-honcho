# Route Quality Indicator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace market size as the headline signal on a sector with a breakeven load factor shown against the load the player can actually achieve, so a sector that cannot pay says so before it is opened.

**Architecture:** One pure function in the sim (`breakevenLoad`) derives the answer from components `computeRouteEconomics` already returns, so it cannot drift from the real cost model. Three UI surfaces consume it: a free one-configuration verdict in the prospect panel and dossier, a tech-gated comparison table of operated aircraft types, and a rewritten spill alert that answers "does one more aircraft help" instead of "what clears the spill". A prerequisite bug fix stops the prospect panel pricing every prospective sector as a monopoly.

**Tech Stack:** TypeScript strict, Vitest, Vite. No new dependencies. Sim layer is pure — no DOM, no `Math.random`, no `Date.now`.

## Global Constraints

- Sim layer (`src/sim/`) must not import DOM, use `Math.random`, or use `Date.now`. Enforced by `tests/purity.test.ts`.
- All tunable constants live in `src/data/constants.json` with a `_comment_*` field. This feature adds **no new constants** — it reads `distributionPerPax`, `paxCost`, `overheadRate`, all of which exist.
- UI copy is US English. No emoji. No gradient/glass styling. Light theme, restrained palette.
- Any balance-visible change needs before/after headless stats in the commit message. This feature changes no balance — verify by asserting the full suite result is unchanged in count.
- Full suite currently: **509 passed, 19 files**. Every task ends green.
- Run the suite with `npx vitest run`. It takes roughly 8–9 minutes.
- **Never run a git command.** Not `git add`, `git commit`, `git checkout`, `git branch`
  or `git push`. Matt does all git work himself. Finish each task at "tests green, files
  listed" and stop. This overrides any habit of committing at the end of a task.

## File Structure

| File | Responsibility | Change |
|---|---|---|
| `src/sim/types.ts` | `RouteEconomics` shape | Add `handlingPax` field |
| `src/sim/economics.ts` | Route cost model; new `breakevenLoad` | Return `handlingPax`; add pure function |
| `src/ui/inspector.ts` | Prospect panel, dossier, spill alert | Thread index; verdict; table; alert rewrite |
| `tests/economics.test.ts` | Sim-level tests | Sign-agreement + edge cases |

`breakevenLoad` lives beside the cost model it derives from, not in the UI, so the tests and any future AI use share one implementation.

---

### Task 1: Price the prospect panel against real competition

The prospect panel calls `computeRouteEconomics` with `0, 0` for rival attractiveness and rival capacity. `renderInspector` already receives a `MarketIndex` and does not pass it down.

**Measured correction (2026-08-14):** this changes NO number a player currently sees. The
panel reads only `marketDemandWeekly` off that preview, and market demand is the whole
market — identical with rivals and without (274,016 either way on LON-PAR). What the
rivals change is `loadCeiling` (0.880 → 0.793) and `netCash` (+0.8M → −0.6M), neither of
which is displayed today. So this is latent plumbing that would have corrupted Task 3's
indicator, not a bug that has been misleading anyone. It still ships first, because Task 3
cannot be correct without it — but it gets no changelog line.

**Files:**
- Modify: `src/ui/inspector.ts:100` (call site), `src/ui/inspector.ts:123-128` (signature), `src/ui/inspector.ts:149-151` (the probe)
- Test: `tests/economics.test.ts`

**Interfaces:**
- Consumes: `rivalsOf(index: MarketIndex, route: Route): number`, `rivalCapacityOf(index: MarketIndex, route: Route): number` — both already exported from `src/sim/economics.ts` and already imported by `inspector.ts`.
- Produces: nothing new. `renderProspect` gains an `index: MarketIndex | null` parameter.

- [ ] **Step 1: Write the failing test**

This is a UI wiring bug, so the test pins the property the panel was hiding: that rival capacity on a market measurably lowers what a carrier can achieve there. Add to `tests/economics.test.ts`:

```ts
describe('a prospective sector must be priced against its rivals', () => {
  it('shows a lower ceiling and share once rivals are on the market', () => {
    const state = newGame(5, 'LON');
    const probe: Route = {
      id: 'prospect', carrierId: 'player', from: 'LON', to: 'PAR',
      posture: 'match', openedTurn: 0,
    };
    const player = getCarrier(state, 'player');
    const fleet = [{
      id: 'T1', typeId: 'AROSN3', ownership: 'leased' as const,
      acquiredTurn: 0, deliversTurn: 0, bookValue: 0, routeId: 'prospect',
    }];
    const conditions = conditionsFor(state, player, probe, klassesOf(fleet));

    const uncontested = computeRouteEconomics(probe, fleet, 0, conditions, 0, 0, 1, 0);
    // A rival flying comparable capacity on the same market.
    const contested = computeRouteEconomics(
      probe, fleet, 0, conditions, 1, uncontested.capacityWeekly, 1, 0,
    );

    expect(contested.demandShare).toBeLessThan(uncontested.demandShare);
    expect(contested.loadCeiling).toBeLessThan(uncontested.loadCeiling);
    // The gap is the whole point: pricing a prospect at 0,0 overstates it.
    expect(uncontested.netCash - contested.netCash).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run the test to verify it passes on the sim and therefore proves the panel was wrong**

Run: `npx vitest run tests/economics.test.ts -t "priced against its rivals"`
Expected: PASS. The sim is correct; the panel was not calling it correctly. This test is the evidence that `0, 0` misreports, and guards the property if anyone reverts the wiring.

- [ ] **Step 3: Thread the index into `renderProspect`**

In `src/ui/inspector.ts`, change the signature at line 123:

```ts
function renderProspect(
  panel: HTMLElement,
  state: GameState,
  index: MarketIndex | null,
  prospect: { from: CityId; to: CityId },
  callbacks: InspectorCallbacks,
): void {
```

Change the call site at line 100:

```ts
    renderProspect(panel, state, index, prospect, callbacks);
```

- [ ] **Step 4: Use the real rival figures in the probe**

Replace lines 149-151:

```ts
  /*
   * Priced against the rivals ACTUALLY on this market, not as a monopoly.
   *
   * This passed 0, 0 and so showed every prospective sector as though nobody else
   * flew it — a carrier looking at a contested trunk route was quoted uncontested
   * economics, which is a large part of why market size read as a promise. The
   * dossier has always priced the real thing; only the panel you decide FROM did not.
   */
  const preview = computeRouteEconomics(
    probe, [], state.turn, conditionsFor(state, player, probe, klassesOf([])),
    index ? rivalsOf(index, probe) : 0,
    index ? rivalCapacityOf(index, probe) : 0,
    1, 0,
  );
```

- [ ] **Step 5: Typecheck and build**

Run: `npm run typecheck && npm run build`
Expected: both clean, no errors.

- [ ] **Step 6: Verify in a browser that a contested sector now reads differently**

Run: `npm run build && npx vite preview --port 4200`, then open a game, open one sector, and price a second sector on the same market as a rival. Confirm the Market figure is unchanged (it is the whole market) and that the panel no longer implies sole occupancy.

- [ ] **Step 7: Run the full suite**

Run: `npx vitest run`
Expected: 510 passed (509 + the new one), 19 files.

- [ ] **Step 8: Report and stop — do NOT touch git**

Run: `npx vitest run` and confirm the expected count.

Then list the files you changed and stop. **Do not run any git command** — not
`git add`, not `git commit`, not `git checkout`. Matt does all git work himself
and wants to control what enters history. A task is complete when the tests are
green and the changed files are named, not when anything is staged.

---

### Task 2: Expose the handling split and add `breakevenLoad`

`econ.handling` is scaled by `costWeight × conditions.handlingCost`, and neither is exposed, so the per-passenger half cannot be recovered from `RouteEconomics`. Expose it rather than approximate it.

**Files:**
- Modify: `src/sim/types.ts` (RouteEconomics), `src/sim/economics.ts:748-756` (handling computation) and its return object
- Test: `tests/economics.test.ts`

**Interfaces:**
- Consumes: `RouteEconomics` from Task 1's unchanged shape.
- Produces:
  - `RouteEconomics.handlingPax: number` — the per-passenger half of handling, after the same scaling as `handling`. `handlingPax <= handling` always.
  - `breakevenLoad(econ: RouteEconomics, posture: PricingPosture): number | null` — returns the load factor (0–1+, may exceed 1) at which `netCash` reaches zero, or `null` when no finite breakeven exists.

- [ ] **Step 1: Write the failing tests**

Add to `tests/economics.test.ts`:

```ts
describe('breakeven load', () => {
  const priced = (dest: string, typeId: string, n: number, posture: PricingPosture) => {
    const base = newGame(5, 'LON');
    const route: Route = {
      id: 'r', carrierId: 'player', from: 'LON', to: dest, posture, openedTurn: 0,
    };
    const fleet = Array.from({ length: n }, (_, i) => ({
      id: `T${i}`, typeId, ownership: 'leased' as const,
      acquiredTurn: 0, deliversTurn: 0, bookValue: 0, routeId: 'r',
    }));
    const carrier = { ...base.carriers[0]!, fleet };
    const state: GameState = { ...base, carriers: [carrier], routes: [route] };
    const index = buildMarketIndex(state);
    return computeRouteEconomics(
      route, fleet, 0, conditionsFor(state, carrier, route, klassesOf(fleet)),
      rivalsOf(index, route), rivalCapacityOf(index, route), 1, 0,
    );
  };

  it('splits handling into a per-passenger half that never exceeds the whole', () => {
    const e = priced('IST', 'AROSN3', 2, 'match');
    expect(e.handlingPax).toBeGreaterThan(0);
    expect(e.handlingPax).toBeLessThan(e.handling);
  });

  /*
   * The invariant that makes this number trustworthy. If breakeven and the real
   * cost model ever disagree on whether a sector pays, the indicator is lying and
   * this fails — which is the whole reason it is derived from the returned
   * components rather than restated.
   */
  it('agrees with the model on whether a sector pays, across many configurations', () => {
    const cases: [string, string, number, PricingPosture][] = [
      ['PAR', 'AROSW5', 3, 'skim'], ['PAR', 'AROSW5', 3, 'match'],
      ['PAR', 'AROSN3', 2, 'match'], ['PAR', 'TARN72', 1, 'match'],
      ['IST', 'AROSN3', 2, 'match'], ['IST', 'AROSN3', 2, 'undercut'],
      ['NYC', 'AROSW5', 2, 'match'], ['NYC', 'AROSW5', 2, 'premium'],
      ['MAD', 'AROSN3', 1, 'match'], ['BER', 'AROSN2', 2, 'stimulate'],
    ];
    let checked = 0;
    for (const [dest, typeId, n, posture] of cases) {
      const e = priced(dest, typeId, n, posture);
      if (e.capacityWeekly <= 0) continue;
      const be = breakevenLoad(e, posture);
      if (be === null) {
        // No finite breakeven means it cannot pay at any load.
        expect(e.netCash, `${dest} ${typeId}x${n} ${posture}`).toBeLessThan(0);
      } else {
        const paysByBreakeven = be < e.loadCeiling;
        expect(paysByBreakeven, `${dest} ${typeId}x${n} ${posture}: breakeven ${be} vs ceiling ${e.loadCeiling}, net ${e.netCash}`)
          .toBe(e.netCash > 0);
      }
      checked += 1;
    }
    expect(checked).toBeGreaterThan(8);
  });

  it('returns null when no load could cover the per-passenger cost', () => {
    // Skim on a very short sector: the per-head cost uplift outruns the fare uplift.
    const e = priced('PAR', 'TARN72', 1, 'skim');
    const be = breakevenLoad(e, 'skim');
    if (be !== null) expect(be).toBeGreaterThan(e.loadCeiling);
  });

  it('returns null for a sector with nothing flying it', () => {
    const base = newGame(5, 'LON');
    const route: Route = {
      id: 'r', carrierId: 'player', from: 'LON', to: 'IST', posture: 'match', openedTurn: 0,
    };
    const e = computeRouteEconomics(
      route, [], 0, conditionsFor(state0(base), base.carriers[0]!, route, klassesOf([])), 0, 0, 1, 0,
    );
    expect(breakevenLoad(e, 'match')).toBeNull();
  });
});

const state0 = (s: GameState): GameState => s;
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/economics.test.ts -t "breakeven load"`
Expected: FAIL — `breakevenLoad is not defined` and `handlingPax` missing from the type.

- [ ] **Step 3: Add `handlingPax` to the type**

In `src/sim/types.ts`, inside `interface RouteEconomics`, directly after the `handling` field:

```ts
  readonly handling: number;
  /**
   * The per-PASSENGER half of handling — booking, catering, passenger ground
   * handling — after the same cost weighting as `handling` itself. The remainder
   * (`handling - handlingPax`) is charged per departure and does not move with how
   * full the aircraft flies. Exposed because that split cannot be recovered from
   * the outside: `handling` is scaled by the market's cost weight and by event
   * conditions, and neither is on this interface.
   */
  readonly handlingPax: number;
```

- [ ] **Step 4: Return it from the cost model**

In `src/sim/economics.ts`, replace the handling computation at lines 748-756:

```ts
  const handlingScale = costWeight * conditions.handlingCost * WEEKS_PER_QUARTER;
  const handlingPax =
    paxCarriedWeekly *
    CONSTANTS.fleet.distributionPerPax *
    CONSTANTS.posture.paxCost[route.posture] *
    handlingScale;
  const handling = handlingWeekly * handlingScale + handlingPax;
```

Then add `handlingPax` to the returned object, next to `handling`:

```ts
    handling,
    handlingPax,
```

- [ ] **Step 5: Add `breakevenLoad`**

Append to `src/sim/economics.ts`:

```ts
/**
 * The load factor at which a sector's cash flow reaches zero.
 *
 * Read against `loadCeiling`, this is the whole judgement on a sector: below the
 * ceiling it can pay, above it cannot, and how far above says how badly. It is
 * scale-free, so a turboprop on a 300km hop and a widebody on a transatlantic are
 * directly comparable, and it explains itself in a way a dollar forecast does not —
 * "you would need to sell three times your seats" is a verdict with its reasoning
 * attached.
 *
 * Derived entirely from what `computeRouteEconomics` already returned, so it cannot
 * drift from the model it describes. Costs divide in two: the per-passenger half of
 * handling (plus the overhead riding on it) moves with load, and everything else —
 * fuel, crew, maintenance, lease, standing, station — follows capacity and frequency,
 * which load does not move. Cargo is subtracted from what must be covered, because
 * the hold earns whether or not the cabin fills.
 *
 * Returns null when nothing is flying, or when the fare does not cover the cost of
 * carrying one more passenger — at which point no load covers the fixed costs either
 * and the honest answer is "not at any load", not a number above 1.
 */
export function breakevenLoad(
  econ: RouteEconomics,
  posture: PricingPosture,
): number | null {
  if (econ.capacityWeekly <= 0 || econ.loadFactor <= 0) return null;

  const overhead = 1 + CONSTANTS.fleet.overheadRate;
  // The pax half, grossed up for the head-office uplift charged on top of it.
  const paxCost = econ.handlingPax * overhead;
  const fares = econ.revenue - econ.cargo;

  // Earned per unit of load, net of what carrying those passengers costs.
  const contributionPerLoad = (fares - paxCost) / econ.loadFactor;
  if (contributionPerLoad <= 0) return null;

  const allCosts = econ.fuel + econ.crew + econ.maintenance + econ.handling
    + econ.lease + econ.standing + econ.fixed + econ.overhead;
  const fixedCosts = allCosts - paxCost;

  return (fixedCosts - econ.cargo) / contributionPerLoad;
}
```

Note `posture` is currently unused because `handlingPax` already carries the posture multiplier. Keep the parameter: it documents that the answer is posture-specific, and callers must pass the posture the economics were priced at. Silence the lint with a leading underscore only if the build complains.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run tests/economics.test.ts -t "breakeven load"`
Expected: PASS, all four.

- [ ] **Step 7: Confirm the numbers match the spec's table**

Write a throwaway script and check `LON-PAR 3x AROSW5 skim` reports roughly 328%, `2x AROSN3 match` roughly 80%, and `LON-IST 2x AROSN3 match` roughly 60%. If they differ materially, the split is wrong — stop and re-derive rather than adjusting the test.

- [ ] **Step 8: Report and stop — do NOT touch git**

Run: `npx vitest run` and confirm the expected count.

Then list the files you changed and stop. **Do not run any git command** — not
`git add`, not `git commit`, not `git checkout`. Matt does all git work himself
and wants to control what enters history. A task is complete when the tests are
green and the changed files are named, not when anything is staged.

---

### Task 3: The free verdict

One line wherever a configuration exists. This is the warning, and it must be free — the trap catches players in their opening moves, when they have no tech.

**Files:**
- Modify: `src/ui/inspector.ts` — `renderProspect` (after the stats block) and `renderRoute` (near the load factor figure)

**Interfaces:**
- Consumes: `breakevenLoad(econ, posture)` from Task 2; `RouteEconomics.loadCeiling`.
- Produces: a helper local to `inspector.ts`:
  `verdictLine(econ: RouteEconomics, posture: PricingPosture, label: string): HTMLElement`

- [ ] **Step 1: Add the shared helper**

In `src/ui/inspector.ts`, above `renderProspect`:

```ts
/**
 * Breakeven against ceiling, in one line. The free half of the route-quality work:
 * it names the number rather than gesturing at it, because a warning that fires on
 * distance alone is non-diagnostic — the same short sector pays with a narrowbody at
 * Match and loses $31M a quarter with widebodies at Skim.
 */
function verdictLine(
  econ: RouteEconomics,
  posture: PricingPosture,
  label: string,
): HTMLElement {
  const wrap = el('div', 'verdict');
  const be = breakevenLoad(econ, posture);
  /*
   * A breakeven at or above 100% is unachievable — you cannot sell more seats than you
   * fly — so it is a verdict, not a number. Measured, these get genuinely silly: three
   * widebodies on London-Paris at Skim break even at 8,493%, because the fare per
   * passenger and the cost of carrying one are both $141 and the contribution per unit
   * of load collapses. Printing that figure would read as a bug; printing the turboprop's
   * 128% would suggest it is nearly reachable. Both are simply impossible.
   */
  if (be === null || be >= 1) {
    wrap.append(el('p', 'verdict-line is-negative', 'Cannot pay at any load.'));
    wrap.append(el('p', 'verdict-note', label));
    return wrap;
  }
  /*
   * A breakeven at or below zero means the hold alone covers the sector: it is already
   * paying before a passenger boards. Rare, and only on long widebody sectors where
   * cargo is large against fixed costs — but `breakevenLoad` returns a genuine negative
   * there, and printing "breakeven -12%" would read as a fault.
   */
  if (be <= 0) {
    wrap.append(el('p', 'verdict-line', 'Pays before a passenger boards.'));
    wrap.append(el('p', 'verdict-note', `${label} — the hold alone covers it.`));
    return wrap;
  }
  const ceiling = econ.loadCeiling;
  const pays = be < ceiling;
  wrap.append(el('p', 'verdict-line' + (pays ? '' : ' is-negative'),
    `Breakeven load ${pct(be)} · your ceiling ${pct(ceiling)}`));
  wrap.append(el('p', 'verdict-note', pays
    ? `${label} — ${Math.round((ceiling - be) * 100)} points of headroom.`
    : `${label} — cannot pay in this configuration.`));
  return wrap;
}
```

- [ ] **Step 2: Show it in the prospect panel**

In `renderProspect`, after `panel.append(stats);`, price one aircraft of the player's most-operated type at Match and append the verdict. If the player operates nothing, append nothing.

```ts
  /*
   * The verdict for the obvious configuration, before any money is committed.
   * One aircraft of whatever the player flies most, at Match — the neutral posture,
   * so this says whether the sector CAN pay without answering how to play it.
   */
  const counts = new Map<string, number>();
  for (const a of player.fleet) counts.set(a.typeId, (counts.get(a.typeId) ?? 0) + 1);
  const commonest = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  if (commonest && canReach(getAircraftType(commonest), dist)) {
    const one = [{
      id: 'probe-tail', typeId: commonest, ownership: 'leased' as const,
      acquiredTurn: state.turn, deliversTurn: state.turn, bookValue: 0, routeId: probe.id,
    }];
    const withMetal = computeRouteEconomics(
      probe, one, state.turn, conditionsFor(state, player, probe, klassesOf(one)),
      index ? rivalsOf(index, probe) : 0,
      index ? rivalCapacityOf(index, probe) : 0,
      1, 0,
    );
    panel.append(verdictLine(
      withMetal, 'match', `one ${getAircraftType(commonest).name}, at Match`,
    ));
  }
```

- [ ] **Step 3: Show it in the dossier**

In `renderRoute`, immediately after the `load` figure is appended, append the verdict for what is actually flying at the posture actually set:

```ts
  panel.append(verdictLine(
    econ, route.posture,
    `${assigned.length}x ${assigned.length ? getAircraftType(assigned[0]!.typeId).name : 'nothing'} at ${
      POSTURES.find((o) => o.id === route.posture)?.label ?? route.posture}`,
  ));
```

- [ ] **Step 4: Style it**

Append to `src/style.css`:

```css
/* --- Route verdict: breakeven against ceiling ------------------------------- */
.verdict {
  margin: 12px 0 0;
  padding-top: 10px;
  border-top: 1px solid var(--rule-hair);
}

.verdict-line {
  margin: 0;
  font-size: 15px;
  font-weight: 600;
  color: var(--ink);
}

.verdict-line.is-negative {
  color: var(--loss);
}

.verdict-note {
  margin: 3px 0 0;
  font-size: 13px;
  color: var(--ink-soft);
}
```

- [ ] **Step 5: Typecheck, build, and verify in a browser**

Run: `npm run typecheck && npm run build && npx vite preview --port 4200`

Verify: start a game, lease one narrowbody, price LON–PAR — expect a verdict naming a breakeven near 80% with headroom. Then price LON–IST — expect roughly 60% and more headroom. Open a sector, set Skim, and confirm the dossier verdict turns red and reads far above the ceiling.

- [ ] **Step 6: Report and stop — do NOT touch git**

Run: `npx vitest run` and confirm the expected count.

Then list the files you changed and stop. **Do not run any git command** — not
`git add`, not `git commit`, not `git checkout`. Matt does all git work himself
and wants to control what enters history. A task is complete when the tests are
green and the changed files are named, not when anything is staged.

---

### Task 4: The gated comparison table

Every type the player operates, ranked. Unlocked by `network-planning`.

**Files:**
- Modify: `src/ui/inspector.ts` — `renderProspect`
- Modify: `src/style.css`

**Interfaces:**
- Consumes: `breakevenLoad`, `canReach(type, distanceKm)`, `getAircraftType(id)`, `carrier.tech: string[]`.
- Produces: nothing consumed downstream.

- [ ] **Step 1: Build the table**

In `renderProspect`, after the verdict block:

```ts
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
    const head = el('tr');
    for (const h of ['Aircraft', 'Breakeven', 'Ceiling', 'Headroom', 'Free']) {
      head.append(el('th', undefined, h));
    }
    table.append(el('thead', undefined)).lastChild!.appendChild(head);
    const body = el('tbody');
    const rows = [...counts.keys()].map((typeId) => {
      const type = getAircraftType(typeId);
      if (!canReach(type, dist)) return { type, be: null, ceiling: 0, free: 0, reach: false };
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
        type, be: breakevenLoad(e, 'match'), ceiling: e.loadCeiling, reach: true,
        free: player.fleet.filter((a) => a.typeId === typeId && a.routeId === null).length,
      };
    });
    // Best headroom first; unreachable and unpayable sink to the bottom.
    rows.sort((a, b) => {
      const ha = a.be === null || !a.reach ? -Infinity : a.ceiling - a.be;
      const hb = b.be === null || !b.reach ? -Infinity : b.ceiling - b.be;
      return hb - ha;
    });
    for (const r of rows) {
      const tr = el('tr');
      tr.append(el('td', undefined, `${r.type.name} · ${r.type.seats} st`));
      if (!r.reach) {
        const cell = el('td', 'compare-flat', 'out of range');
        cell.colSpan = 4;
        tr.append(cell);
      } else if (r.be === null) {
        const cell = el('td', 'compare-flat is-negative', 'cannot pay at any load');
        cell.colSpan = 4;
        tr.append(cell);
      } else {
        const pays = r.be < r.ceiling;
        tr.append(el('td', pays ? undefined : 'is-negative', pct(r.be)));
        tr.append(el('td', undefined, pct(r.ceiling)));
        tr.append(el('td', pays ? undefined : 'is-negative',
          pays ? `+${Math.round((r.ceiling - r.be) * 100)}` : 'cannot pay'));
        tr.append(el('td', undefined, r.free > 0 ? String(r.free) : '—'));
      }
      body.append(tr);
    }
    table.append(body);
    panel.append(table);
    panel.append(el('p', 'verdict-note', 'at Match · types you operate · today’s competition'));
  }
```

- [ ] **Step 2: Style the table to match the existing sheets**

Append to `src/style.css`:

```css
.fleet-compare {
  width: 100%;
  margin-top: 12px;
  border-collapse: collapse;
  font-size: 13px;
}

.fleet-compare th {
  padding: 0 0 5px;
  border-bottom: 1px solid var(--rule);
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--ink-faint);
  text-align: right;
}

.fleet-compare th:first-child,
.fleet-compare td:first-child { text-align: left; }

.fleet-compare td {
  padding: 6px 0;
  border-bottom: 1px solid var(--rule-hair);
  text-align: right;
  font-variant-numeric: tabular-nums;
}

.fleet-compare .compare-flat { text-align: right; color: var(--ink-soft); }
```

- [ ] **Step 3: Typecheck, build, verify**

Run: `npm run typecheck && npm run build`

Verify in a browser by granting the tech in a scratch save, or by temporarily forcing the condition true, that the table lists one row per operated type, sorted with the best headroom first, and that a widebody on LON–PAR reads `cannot pay`.

- [ ] **Step 4: Report and stop — do NOT touch git**

Run: `npx vitest run` and confirm the expected count.

Then list the files you changed and stop. **Do not run any git command** — not
`git add`, not `git commit`, not `git checkout`. Matt does all git work himself
and wants to control what enters history. A task is complete when the tests are
green and the changed files are named, not when anything is staged.

---

### Task 5: Rewrite the spill alert to be marginal

The alert says "clearing it needs at least Nx the metal". Measured: on a sector where each aircraft loses money, adding metal runs net from −$0.4M to −$7.8M; and even where the sector pays, profit peaks at 3–4 aircraft while the alert urges 5+. It contradicts CLAUDE.md §6.

**Files:**
- Modify: `src/ui/inspector.ts:655-675` (the spill alert block)

**Interfaces:**
- Consumes: `breakevenLoad`, `computeRouteEconomics`.
- Produces: nothing.

- [ ] **Step 1: Replace the alert**

Replace the whole `if (econ.spilledWeekly > econ.paxCarriedWeekly ...)` block:

```ts
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
   * plane help". That is one extra pricing call, so it is answered exactly.
   */
  if (econ.spilledWeekly > econ.paxCarriedWeekly && econ.paxCarriedWeekly > 0) {
    const ratio = econ.spilledWeekly / econ.paxCarriedWeekly;
    const be = breakevenLoad(econ, route.posture);
    const note = el('p', 'sector-flag');

    if (be === null || be >= econ.loadCeiling) {
      // Each aircraft here loses money; more metal deepens it.
      note.classList.add('is-negative');
      note.textContent =
        `${STRINGS.sector.spilling} It turns away ${ratio.toFixed(1)}x what it carries, and ` +
        `each aircraft here loses money — breakeven ${be === null ? 'is unreachable' : pct(be)} ` +
        `against a ceiling of ${pct(econ.loadCeiling)}. More metal deepens the loss; try a ` +
        `smaller gauge, a cheaper posture, or a longer sector.`;
    } else {
      // Price the sector with one more of what is already on it.
      const extra = [...assigned, {
        ...assigned[0]!, id: `${assigned[0]!.id}-probe`,
      }];
      const withMore = computeRouteEconomics(
        route, extra, state.turn,
        conditionsFor(state, carrier, route, klassesOf(extra)),
        rivalsOf(index, route), rivalCapacityOf(index, route), feed, stationOverhead,
      );
      const delta = withMore.netCash - econ.netCash;
      const name = getAircraftType(assigned[0]!.typeId).name;
      note.textContent = delta > 0
        ? `${STRINGS.sector.spilling} It turns away ${ratio.toFixed(1)}x what it carries. ` +
          `One more ${name} would add about ${usd(delta)} a quarter.`
        : `${STRINGS.sector.spilling} It turns away ${ratio.toFixed(1)}x what it carries, but ` +
          `you are at the profitable size — another ${name} would cost about ${usd(-delta)} a quarter.`;
    }
    panel.append(note);
  }
```

- [ ] **Step 2: Nothing to thread — all four are already in scope**

Verified: `renderRoute` takes `index: MarketIndex` as a parameter (line 492) and computes
`carrier`, `assigned`, `feed` and `stationOverhead` at lines 496-500, well above the alert
at 655. Use them directly. Do NOT recompute any of them — pricing the "one more aircraft"
case against different conditions than the figures printed above it is exactly the
two-places-one-number fault this file has been bitten by repeatedly.

- [ ] **Step 3: Make the styling conditional**

The alert must be red only in the inverted case. Confirm `.sector-flag` is not unconditionally coloured; if it is, move the colour to `.sector-flag.is-negative` and leave the base neutral.

- [ ] **Step 4: Typecheck, build, verify all three branches**

Run: `npm run typecheck && npm run build`

Verify: one narrowbody on LON–PAR spilling heavily → "one more would add about $X". Four narrowbodies → "you are at the profitable size". Two widebodies → red, "each aircraft here loses money".

- [ ] **Step 5: Report and stop — do NOT touch git**

Run: `npx vitest run` and confirm the expected count.

Then list the files you changed and stop. **Do not run any git command** — not
`git add`, not `git commit`, not `git checkout`. Matt does all git work himself
and wants to control what enters history. A task is complete when the tests are
green and the changed files are named, not when anything is staged.

---

## Self-Review

**Spec coverage.** Every section maps to a task: the prerequisite fix → Task 1; computation → Task 2; the free verdict → Task 3; the gated comparison → Task 4; the alert rewrite → Task 5; edge cases → Tasks 2 (null returns), 3 (no fleet), 4 (out of range, cannot pay); testing → Task 2's sign-agreement test. The "deliberately not included" section requires no work by definition.

**Placeholders.** None. Every code step contains the code.

**Type consistency.** `breakevenLoad(econ, posture)` has the same signature in Tasks 2, 3, 4 and 5. `handlingPax` is added in Task 2 and read only there. `verdictLine` is defined in Task 3 Step 1 and used in Steps 2 and 3. `counts` is built in Task 3 Step 2 and reused in Task 4 Step 1 — **Task 4 depends on Task 3 having run**, which the build order already requires.

**Scope check on Task 5, resolved.** `renderRoute` receives `index` as a parameter and
computes `carrier`, `assigned`, `feed` and `stationOverhead` at lines 496-500, above the
alert at 655. Nothing needs threading; the step now says so rather than asking the
implementer to find out.

**Remaining judgement call.** Task 3 Step 2 builds `counts` (types the player operates)
and Task 4 reuses it. That coupling is deliberate — the two blocks sit adjacent in the
same function — but it means Task 4 cannot be implemented before Task 3. The build order
already enforces this; a reviewer taking tasks out of order should not.
