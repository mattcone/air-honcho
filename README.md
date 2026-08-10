# Air Honcho

A turn-based airline management game in the spirit of Railroad Tycoon and Aerobiz.
Free, open source, browser-based, no backend. One turn = one quarter.

Design intent lives in [CLAUDE.md](CLAUDE.md); it is the source of truth and it
wins over anything written here. [DECISIONS.md](DECISIONS.md) records why things
ended up the way they did, and what has been deliberately deferred.

**Status: Phase 5 — feel & polish.** Quarterly results land on a split-flap board, route arcs draw themselves in, the masthead figures roll rather than jump, and the map zooms and pans. Keyboard shortcuts (`?` lists them), named save slots, shareable seed links — the game is a pure function of seed, scenario, difficulty and home city, so a link is the whole world — first-turn coaching that retires itself, and sound, off by default and synthesised rather than sampled.

**Phase 4 underneath it — the financial layer.** Every carrier has a share price
(book value plus a multiple of trailing earnings, scaled by growth) and a market
cap that is now the score. Borrow against your assets at a credit-rating-driven
interest rate; issue equity when the price is high; buy stakes in rivals and, past
a majority, buy them out. Acquisitions fold a rival's routes, fleet and balance
sheet into yours, funded with cash or debt — a leveraged buyout — and run a few
quarters of integration drag. The roll-up archetype hunts weak rivals the same
way, and a much larger predator will seize a player whose share price has
cratered: a hostile takeover, and a real way to lose. Win by finishing the most
valuable carrier, or by clearing the board.

Phase 3 still underneath it: the fuel price walks and can be hedged, an event deck
runs oil spikes and recessions and groundings, and a technology tree turns cash
into permanent margin. Rivals fly different aircraft with different competence,
and technology is a real multi-year commitment.

**Two ways to play.** Before you pick a home city you choose a game. *Present day*
starts in 2026 and runs 25 years — a clear runway. *History, 2000* starts in 2000
and runs 50 years through the real shocks on their real dates: the dot-com
recession, 9/11, SARS, the 2008 crash, the ash cloud, COVID. Aircraft arrive on
their historical launch dates — you fly period metal and adopt each new jet as it
enters service, with a handful of fictional next-gen types launching on an
uncertain future date, so being early is an edge. COVID is survivable: a carrier
that would fail during a declared crisis takes a government bailout, booked as
debt, a limited number of times. It is designed to model reality closely without
killing every airline on the board.

## Run it

```sh
npm install
npm run dev            # http://localhost:5173
```

1. Choose a game — *Present day* (2026) or *History, 2000* — then click a city to
   set your home base.
2. **Acquire aircraft** — buy (cash now, an asset on the books) or lease (a month
   down, then rent every quarter).
3. Click two cities to price a sector — you see what it costs to open before you commit — then open it and assign a parked aircraft.
4. Set a pricing posture, then **close the books** on the quarter.

Escape cancels a half-made sector or deselects one. The sector dossier under the
map shows every component the sim used to settle the quarter.

## The decisions the game is about

**Aircraft gauge against market size.** Frequency is derived from an aircraft's
speed, range and turnaround — you never set it — so an oversized jet on a thin
market flies half-empty and loses money where a smaller one would have made some.
Adding aircraft to a sector wins share with diminishing returns, so profit peaks
at a fleet size rather than scaling for ever.

**Who else is on your market.** Every carrier flying a city pair splits its
demand in proportion to how attractive their service is. A rival arriving on one
of your sectors costs roughly a third of your share there, so a route that was
comfortable stops being comfortable. The sector dossier names who is on it.

**When to spend, and what to insure.** Fuel wanders a long way over twenty-five
years and takes your margins with it. You can lock some of it forward, but a
hedge is insurance and not a free bet: it costs a premium, and because the
industry-wide fare surcharge tracks the spot price, locking in before a fall
means paying over the odds while fares drop around you. Technology is the largest
lever you have — a fixture that skips it fails more than twice as often and ends
with a tenth of the net worth.

**Lease or buy, and what to do as the fleet ages.** Maintenance climbs with
airframe age along a saturating curve. Leasing preserves capital but costs rent
for ever, and handing an aircraft back inside its term carries a break fee — so
you cannot churn to a fresh airframe for free. Buying is cheaper over a long
horizon but leaves you holding the aging, with a heavy maintenance visit as the
way to reset the clock. Over 25 years on a good sector, buy-and-hold beats
lease-and-churn by roughly a third — if you can find the capital up front.

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Dev server. Regenerates map data first. |
| `npm run build` | Typecheck, then production build to `dist/`. |
| `npm test` | Vitest. The sim core runs headless in Node. |
| `npm run typecheck` | `tsc --noEmit`. |
| `npm run simulate` | Headless games with summary stats — see below. |
| `npm run build:map` | Regenerate `src/data/world-110m.geo.json` from Natural Earth. |

## Headless simulation

The balance-tuning instrument and the regression-test substrate. Any balance
change should carry before/after output from this in the commit message.

```sh
npm run simulate -- --seed 42 --turns 100 --players ai
npm run simulate -- --seed 1 --games 20 --json
npm run simulate -- --scenario history --games 20   # the 2000 start, 50-year run
```

`--scenario history` runs the 2000 start with the scripted events and launch
dates; the turn count defaults to whichever scenario's full horizon.

`tests/regression.test.ts` runs 20 all-AI games over the full 25-year horizon in
CI and asserts invariants rather than exact figures.

## Layout

```
src/
  sim/     pure TypeScript, zero DOM, fully deterministic
    engine.ts    turn resolution — applyAction() and endTurn()
    conditions.ts what the world is doing to a sector right now
    demand.ts    gravity market sizing, share split, fares
    events.ts    the event deck, fuel walk and completion draw
    tech.ts      the technology tree
    economics.ts route and carrier P&L for a quarter
    fleet.ts     aircraft types, derived frequency, maintenance by age
    geo.ts       great-circle distance and arc sampling
    rng.ts       seeded mulberry32; Math.random is banned in here
    save.ts      versioned save format with a migration ladder
    world.ts     loads and validates the JSON data
    headless.ts  full-game driver shared by the CLI and CI
    ai/
      common.ts    shared probing used by rivals and the balance fixture alike
      archetype.ts rival entry, personality and one turn of decisions
      heuristic.ts the headless balance fixture that stands in for a player
  ui/      rendering and input only; reads state, dispatches actions
  data/    JSON: cities, aircraft, archetypes, rivals, events, tech, constants
```

The sim exposes `applyAction(state, action) -> state` and `endTurn(state) -> state`.
State is plain serializable data; the UI never mutates it directly.

`tests/purity.test.ts` enforces the rules the compiler can't: no `Math.random`,
no `Date.now`, no DOM, no UI imports anywhere under `src/sim/`.

## Determinism

Same seed plus same inputs produces the same game, always. The PRNG state is a
single uint32 that rides along in the save file, so loading a save resumes the
random stream mid-flight rather than restarting it. `tests/save.test.ts` asserts
this by comparing the next turn either side of a round-trip.

## Data

Cities, aircraft and balance constants are JSON in `src/data/`. Content is added
there first and code second. Figures in `cities.json` and `aircraft.json` are
designed game-balance values, not a factual reference — the aircraft are
fictional types with recognizable class stats.

Map geometry comes from [Natural Earth](https://www.naturalearthdata.com/) 1:110m
(public domain) via the `world-atlas` package, converted to GeoJSON and rounded
at build time by `scripts/build-map.mjs`. The output is generated, not committed.

## Dependencies

Five devDependencies, no runtime dependencies. Every one has to earn its place:

- **vite**, **typescript**, **vitest** — build, types, tests.
- **world-atlas** + **topojson-client** — build-time only, for the map geometry.
- **@types/node** — for `scripts/` and `tests/`; `src/sim/` must not use it.

There is no `ts-node`/`tsx`: Node 23+ runs the TypeScript scripts natively.

## Deploy

Static output, no backend.

```sh
npm run build
npx wrangler deploy      # see wrangler.jsonc
```

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). The short version: read
[CLAUDE.md](CLAUDE.md) first, keep `src/sim/` pure and deterministic, put
constants in JSON rather than code, and bring headless before/after numbers for
anything that moves the economy.

## Credits

- **Map geometry** — [Natural Earth](https://www.naturalearthdata.com/) 1:110m,
  public domain, via the `world-atlas` package.
- **Inter** by Rasmus Andersson, under the SIL Open Font License 1.1. The latin
  subset is vendored at `src/assets/fonts/`, unmodified, with the full licence
  alongside it.

## Aircraft

**The names are invented. The numbers are not.**

Every aircraft in the game is fictional — Aros, Vanta, Boreal, Cirro, Tarn,
Halcyon — because using real manufacturers' names and liveries would mean using
their trademarks. But each type is modelled on a specific real aircraft, and its
seats, range, cruise speed and fuel burn are taken from that aircraft's published
figures. The Aros N3 flies like an A321neo because it is one, with the badge filed
off.

Which real type each one is modelled on lives in the `basis` field in
[`src/data/aircraft.json`](src/data/aircraft.json), and it is not decoration:
`tests/fleet.test.ts` holds a table of published seats, range, cruise and
entry-into-service dates and checks every type against it, so a figure cannot
drift away from the aircraft it claims to be. The roster spans the A220, A320neo
family, 737 MAX, 757, MD-80, E-Jets, ATRs, 767, A330, 787, A350, 777, 747 and
A380, plus a handful of invented next-generation types that launch on an uncertain
future date.

Two things the table does *not* pin, deliberately. Operating costs — lease rates,
maintenance, crew — are balance figures, anchored to real orders of magnitude but
tuned for the game. And fuel burn is calibrated for ordering rather than level: the
roster reproduces the published efficiency ranking of these aircraft almost
exactly, while sitting about 28% below published absolute figures. See
[DECISIONS.md](DECISIONS.md) and [IDEAS.md](IDEAS.md).

Nothing here is affiliated with, endorsed by, or derived from any real airline or
manufacturer.

## Built with Claude Code

This game was built with [Claude Code](https://claude.com/claude-code), working
from the design brief in [CLAUDE.md](CLAUDE.md) — which is why that file sits at
the repository root and is treated as the source of truth. [DECISIONS.md](DECISIONS.md)
records what was decided along the way and why, including the things that were
tried, measured and thrown out.

## License

[MIT](LICENSE) — Copyright (c) 2026 Matt Cone.

The bundled Inter font is separately licensed under the
[SIL OFL 1.1](src/assets/fonts/LICENSE), which is not affected by the MIT licence
on the rest of the project.

`package.json` is marked `private` on purpose: this is an application, not an npm
package, and the flag stops it being published to the registry by accident. It
says nothing about the licence.
