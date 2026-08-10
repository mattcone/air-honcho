# "Air Honcho" Airline Sim — Project Plan

A turn-based airline management game in the spirit of Railroad Tycoon and Aerobiz.
Free, open source, browser-based, no backend. Named 2026-07-25 — a play on "head
honcho" and the Air Canada / Air France naming convention. The player's carrier is
always Air Honcho; rivals are dealt from the roster in `rivals.json`.

This document is the source of truth for design intent. When a proposed feature
conflicts with the Design Pillars, the pillars win.

---

## 1. Vision

The player is the CEO of a startup airline in the present day. Buy a plane, open a
route, start flying. Profits attract AI competitors who heat up the market over time.
The player wins through smart fleet decisions, route strategy, technology investment,
and financial engineering — including buying out rivals — and can lose by going
bankrupt or being acquired when their share price craters.

Think: Sid Meier's Railroad Tycoon's financial layer + Aerobiz's route/rival loop,
applied to modern deregulated aviation, playable at a URL with zero install.

## 2. Design Pillars

1. **The board-meeting test.** Every mechanic must be a decision a CEO makes in an
   annual/quarterly board meeting. Fleet plan, route entry/exit, pricing posture,
   capital structure, tech roadmap: in. Crew scheduling, refueling, gate assignments,
   per-seat fares: out. If a real airline delegates it below the C-suite, we do not
   model it.
2. **Turn-based.** One turn = one quarter. No real-time pressure, no timers. The
   player can think as long as they want.
3. **Easy to start, hard to master.** Turn 1 must be playable in under two minutes
   with no tutorial: pick a home city, buy/lease one plane, open one route, end turn.
4. **Rivals create the difficulty curve.** No difficulty slider. AI competitors enter
   markets in response to visible player profits. Success attracts sharks.
5. **Losing is possible.** Bankruptcy and hostile takeover are real end states. A
   defined horizon (default 25 years / 100 turns) with victory by market cap or by
   acquiring all rivals.
6. **Deterministic and data-driven.** Seeded RNG. All content (aircraft, cities,
   events, AI archetypes, economic constants) lives in JSON data files, never in
   code. Same seed + same inputs = same game.

## 3. Non-Goals (explicit)

- No real-time flight tracking or animation-dependent gameplay (animation is
  decoration only)
- No 3D, no airport building, no per-flight scheduling
- No multiplayer, no accounts, no server-side anything
- No monetization of any kind
- No historical eras (present-day start; the event deck provides variety instead)
- No mobile-first design (desktop browser first; don't break on tablets, but don't
  contort for phones)

## 4. Tech Stack

- **TypeScript**, strict mode
- **Vite** for build/dev
- **No framework requirement** — preference: vanilla TS + small reactive helpers, or
  Preact if component structure earns its keep. Avoid heavy dependencies; this must
  still build in ten years. Justify every dependency in the PR/commit message.
- **Rendering:** SVG for the world map and route arcs (styleable with CSS, crisp at
  any zoom); HTML/CSS for all panels and UI. Canvas only if SVG performance
  measurably fails (unlikely at this scale: ~200 cities, a few hundred arcs).
- **Map data:** Natural Earth (public domain) GeoJSON, simplified aggressively at
  build time. Equirectangular or Robinson projection. Great-circle arcs computed,
  not drawn from data.
- **Saves:** localStorage autosave + explicit export/import of a versioned `.json`
  save file. Save format gets a `schemaVersion` from day one.
- **Hosting:** static output, deployable to Cloudflare Workers/Pages. No backend.
- **Testing:** Vitest. The sim core must run headless in Node.
- **License:** MIT — decided 2026-08-02. The bundled Inter subset stays under the
  SIL OFL 1.1, which is unaffected. Include LICENSE and a README with a playable
  URL from the first milestone.

## 5. Architecture

Two strictly separated layers:

```
/src
  /sim        ← pure TypeScript, zero DOM imports, fully deterministic
    engine.ts       (turn resolution)
    demand.ts       (gravity model, market share)
    economics.ts    (route P&L, company financials)
    market.ts       (share price, takeovers)
    ai/             (rival archetype brains)
    events.ts       (event deck)
    rng.ts          (seeded PRNG — e.g. mulberry32; no Math.random anywhere in /sim)
    types.ts
  /ui         ← rendering + input only; reads GameState, dispatches Actions
  /data       ← JSON: cities, aircraft, archetypes, events, constants
```

- The sim exposes `applyAction(state, action) -> state` and
  `endTurn(state) -> state`. State is serializable plain data. The UI never mutates
  state directly.
- **Headless mode is a first-class feature:** a CLI script
  (`npm run simulate -- --seed 42 --turns 100 --players ai`) runs full games with
  all-AI players and dumps summary stats. This is the balance-tuning instrument and
  the regression-test substrate.

## 6. Simulation Model (v1 targets — all constants in `/data/constants.json`)

### Demand
- ~200 cities with population and an economic-weight multiplier.
- Gravity model per city pair: `baseDemand = k * (popA*wA * popB*wB) / distance^d`,
  with a short-haul floor and long-haul decay tuned so intra-regional and
  intercontinental routes both matter.
- Demand is split among carriers on a route by attractiveness score: frequency
  share, fare posture, product/brand score (tech tree feeds this), and hub
  connectivity bonus (simple: carriers with more routes touching an endpoint get a
  feed multiplier — do NOT model itineraries in v1).

### Routes & Fleet
- A route = city pair + assigned aircraft count + weekly frequency (derived from
  aircraft speed/range/turnaround, not player-set per flight) + pricing posture
  (one of: Premium / Match / Undercut).
- Aircraft (~15 types, fictional-but-recognizable names to sidestep trademarks; stats
  modeled on A320/737/A220/E195/ATR72/787/A350/777 classes): range, seats, cruise
  speed, purchase price, monthly lease rate, fuel burn, maintenance cost curve by
  age.
- **Lease vs. buy** on every acquisition. Owned aircraft are balance-sheet assets;
  sale-leaseback is a cash-raise action available when owned aircraft exist.

### Financials
- Quarterly P&L per route and consolidated; balance sheet (cash, aircraft, debt,
  loyalty program as an intangible in later phase); debt issuance with
  credit-rating-driven interest.
- **Fuel price** follows a random walk with occasional event shocks. **Hedging
  action:** lock X% of next year's fuel at current price.
- **Share price** = function of book value, trailing earnings, growth, and a
  volatility term. Must be legible: show the player the formula's components. Share
  price gates: raising equity, acquiring rivals, and being acquired.

### Rivals
- 6–10 AI airlines, each an **archetype** with a legible strategy, entering the game
  staggered over time, triggered partly by player profitability:
  - **ULCC** ("Ryanair brain"): lowest costs, secondary cities, always Undercut,
    avoids head-to-head with other ULCCs
  - **Legacy hub**: fortress hub, Premium posture, matches fares only on overlap
    routes, buys widebodies
  - **State-backed flag carrier**: deep pockets, prestige long-haul, tolerates
    losses for share
  - **Roll-up artist**: grows by acquiring weak carriers, high leverage, fragile —
    and a takeover target
- Archetypes are data-configured (weights/thresholds in JSON), decision logic in
  `/sim/ai/`. Greedy heuristics are fine; legibility beats cleverness.

### Events
- Event deck drawn quarterly with tuned probabilities: oil spike, pandemic scare,
  aircraft-type grounding, volcanic ash (region routes suspended), pilot shortage
  (cost bump), recession/boom, open-skies treaty (unlocks restricted markets).
  Each event is JSON: effects are parameter deltas with durations. No bespoke code
  per event.

### Tech Tree
- Small (10–15 nodes), each node = spend + time → permanent parameter change:
  revenue management (+yield), direct booking app (−distribution cost), alliance
  membership (+feed multiplier), predictive maintenance (−cancellation events),
  ancillary revenue (+per-pax revenue, small brand penalty), loyalty program
  (unlocks the intangible asset + later financial plays).

## 7. Build Phases

Each phase ends with a deployed, playable URL and a go/no-go: **is the loop fun?**
Do not start the next phase's features if the current loop is not fun — fix or cut.

### Phase 0 — Skeleton (small)
Vite + TS project, map rendering from GeoJSON, cities plotted, great-circle arc
drawing, seeded RNG, state/save round-trip, headless sim script stub, CI running
Vitest. Deployed.

### Phase 1 — Core Loop (the MVP)
Pick home city → lease/buy aircraft → open routes → set posture → end turn →
quarterly P&L. Demand model live. Cash can hit zero = game over. One passive AI
carrier as a demand sink. **Acceptance:** owner plays 20 turns voluntarily and wants
turn 21.

### Phase 2 — Rivals
All archetypes active, profit-triggered market entry, route-level competition and
share splits, rival financials visible (annual-report style). **Acceptance:** the
player changes decisions because of what rivals do.

### Phase 3 — Events + Tech
Event deck, fuel walk + hedging, tech tree. **Acceptance:** two games with different
seeds feel meaningfully different.

### Phase 4 — Financial Layer
Share price, debt/equity raises, lease vs. buy fully realized, sale-leaseback,
acquisitions (with assumed debt + integration penalty turns), hostile-takeover loss
condition, win conditions + end-of-game report card. **Acceptance:** a game can be
won via acquisition strategy and lost via takeover.

### Phase 5 — Feel & Polish
This is where the "graphics" budget goes: arcs animating in when routes open,
number tickers, quarterly results sequence (split-flap or equivalent), sound off by
default, onboarding via a 5-tooltip first turn (not a tutorial mode), keyboard
shortcuts, save-slot UI, seed sharing.

## 8. Visual Direction

**Airline modernism.** The game should look like an artifact of the industry it
simulates: classic timetable typography, wayfinding-style UI (Frutiger/Inter-class
sans), flat color-blocked liveries as carrier colors, seatback-magazine route map
aesthetics. Aircraft rendered as single-color side-profile SVG silhouettes
(timetable-icon style, ~15 assets total).

Hard rules:
- No default-Tailwind dashboard look; no gradient-glass cards; no emoji in UI
- Light theme primary; restrained palette: paper white, ink, one accent per carrier
- Dense information is fine — this is a game for people who like annual reports —
  but every screen answers "what decision am I making here?"
- Before building UI, consult the frontend-design skill if available in the
  environment.

## 9. Balance & Testing Doctrine

- Every tunable constant lives in `/data/constants.json` with a comment field.
- Headless regression suite runs on CI: e.g. 20 all-AI games × 100 turns asserting
  invariants — no NaN/negative-seat states; not all carriers bankrupt by year 10;
  no carrier exceeds 90% global share by year 15; median ULCC outlives median
  roll-up artist; fuel spike events measurably dent margins.
- Any balance change must include before/after headless summary stats in the commit
  message.
- Known failure mode to watch: a single dominant strategy (e.g. "always Undercut
  with the cheapest narrowbody"). If headless AI variants converge on one strategy
  winning >80% of games, the economy needs work.

## 10. Working Agreements for Claude Code Sessions

- Read this file at the start of every session; it overrides ad-hoc ideas.
- Ship vertical slices: every session should end with the deployed build still
  playable (`npm run build` + tests green).
- Prefer deleting scope to deferring it. Log cut ideas in `IDEAS.md`, not in code.
- No feature merges without the board-meeting test applied in the PR description.
- Sim layer: no DOM, no Math.random, no Date.now (turn count is the only clock).
- Keep the save format migration-friendly: additive changes preferred; write a
  migration when `schemaVersion` bumps.
- Data before code: when adding content (aircraft, events), extend JSON + schema
  first, code second.
- Plain commit messages describing player-visible or balance-visible effects.

## 11. Open Questions (decide before the relevant phase, not now)

- ~~Name and license (before first public push)~~ — **settled 2026-08-02:** Air
  Honcho, MIT.
- Preact vs. vanilla (end of Phase 0, based on how painful the UI wiring feels)
- Whether hub feed deserves a real connecting-itinerary model in a later version
  (v1 answer: no)
- Loyalty-program financialization depth (Phase 4 stretch: mortgage/spin-off as
  late-game actions)
- Whether to add a compressed "history mode" start (1978 deregulation) post-1.0
