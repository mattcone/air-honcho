# Route quality: breakeven load against your ceiling

**Status:** design, awaiting approval
**Date:** 2026-08-14

## The problem

The sector prospect panel leads with `Market: 274,006/wk` for London–Paris. That reads
as a strong route. It is barely profitable, and with the wrong metal or the wrong
posture it is ruinous. London–Istanbul shows 63,778/wk — a quarter of the traffic —
and earns several times more per aircraft.

Market size is close to an anti-signal, and the panel presents it as the headline.

Two players reported this within days of launch. One opened London–Paris with three
widebodies on Skim and lost about $31M a quarter. Neither did anything unreasonable:
they read the biggest number on the screen and believed it.

The information is not secret. Open the route and the dossier itemises fares, cargo,
fuel, crew, handling, station, overhead and sector net. It simply arrives one quarter
after the decision it should have informed.

## What we are adding

A **breakeven load factor** — the share of seats you must sell to cover costs — shown
against **the load the sector actually flies**.

> **Correction, 2026-08-14, after implementation.** Every earlier draft of this spec said
> "against the load you can actually achieve", meaning `loadCeiling`, and the first
> implementation compared against it. That is wrong. Net cash is
> `contribution × (loadFactor − breakeven)`, so a sector pays exactly when
> **breakeven < loadFactor** — the load it really flies — not when it is below the
> ceiling, which is only the most it could fill if demand allowed.
>
> The two diverge on demand-limited sectors, which are precisely the ones this feature
> exists to expose. Swept over 3,405 configurations: comparing against the ceiling
> disagrees with actual profitability **232 times (6.8%), always optimistic**; comparing
> against the achieved load disagrees **zero times**. The worst case printed
> "14 points of headroom" in ordinary ink above a P&L of −$25.8M a quarter.
>
> The ceiling is still shown, because it explains WHY the achieved load is capped —
> competition erodes it — but it is context, not the test.

Measured on the shipped economy, it separates winners from losers without exception:

| sector | fleet | posture | breakeven | ceiling | net |
|---|---|---|---|---|---|
| LON–PAR | 3× widebody | skim | **8,493%** | 88% | −$31.3M |
| LON–PAR | 3× widebody | match | **94%** | 88% | −$2.9M |
| LON–PAR | 2× narrowbody | match | **79%** | 88% | +$1.3M |
| LON–PAR | 1× turboprop | match | **128%** | 88% | −$1.2M |
| LON–IST | 2× narrowbody | match | **60%** | 88% | +$6.8M |
| LON–NYC | 2× widebody | match | **68%** | 88% | +$10.5M |

Figures measured against the exact implementation. An earlier draft quoted 328% for the
first row, from a prototype that reconstructed handling's per-passenger half from outside
`RouteEconomics` and so under-counted it. The exact figure is 8,493%, because at Skim on
that sector the fare per passenger ($141) and the cost of carrying one ($141) are
effectively equal — contribution per unit of load collapses to $0.37M against $16.77M at
Match, and the breakeven explodes. The implementation is verified exact: net cash is linear
in load, and the formula reproduces the model's actual `netCash` to the cent.

## Displaying an impossible breakeven

Load factor cannot exceed 100% — you cannot sell more seats than you fly. **Any breakeven
at or above 100% is therefore unachievable, and must read as a verdict rather than a
number.** Printing "8,493%" is absurd; printing "128%" invites a player to imagine it is
nearly within reach.

| breakeven | display |
|---|---|
| below the ceiling | `Breakeven 79% · ceiling 88% → 9 points of headroom` |
| between ceiling and 100% | `Breakeven 94% · ceiling 88% → cannot pay in this configuration` |
| 100% or above, or null | `Cannot pay at any load` |

This makes the turboprop and the Skim widebody read identically, which is correct: both are
impossible, and the difference between impossible and very impossible is not a decision.

Chosen over a dollar estimate or a RASK/CASK ratio because it is scale-free, it
diagnoses *why* rather than only *how much*, and it reuses `loadCeiling`, a mechanic the
game already models and already displays.

## Where each piece lives

Three pieces, two panels, one shared calculation. Ordered as they should be built,
because each depends on the one above.

| # | piece | panel | depends on |
|---|---|---|---|
| 1 | Rival fix on the prospect probe | prospect | nothing; latent, ships first |
| 2 | `breakevenLoad()` in `/sim` | — | nothing |
| 3 | Free verdict, one configuration | prospect + dossier | 1 and 2 |
| 4 | Gated comparison table | prospect | 2 and 3 |
| 5 | Spill alert rewrite | dossier | 2 |

The comparison answers "which of my aircraft belongs here?" and so belongs to the
prospect panel. The dossier reports actuals for a sector you already fly and needs no
forecast — what it needs is the free verdict and a corrected alert.

Piece 1 ships first because pieces 3 and 4 are wrong without it. It needs no changelog
line — see "A prerequisite fix" below for why the earlier claim that it had been misleading
players does not survive measurement.

## Two tiers

The line falls between **the verdict** and **the comparison**, not between qualitative
and quantitative. An earlier draft of this spec put breakeven itself behind the tech
gate and justified it with the principle below — which the gate then violated.

**Free — the verdict.** Breakeven against ceiling for ONE configuration, wherever a
configuration exists:

- *Prospect panel*, before you commit: one aircraft of the type you operate most, at
  Match. A single line.
- *Dossier*, once the sector is open: what is actually assigned, at the actual posture.

This includes the `cannot pay at any load` case. It is the smoke detector, and it must be
free because the trap catches players in their opening moves, when they have no tech and
no spare cash.

**Unlocked by `network-planning` — the comparison.** The full table: every type you
operate, ranked, with headroom and free tails. The planning department.

### Why the line moved

The first draft gated breakeven itself and kept only a qualitative "short sector,
handling will be heavy" free. Measurement shows that would have failed the player it was
written for. On LON–PAR:

| configuration | breakeven | outcome |
|---|---|---|
| 2× narrowbody, Match | 80% | **+$1.3M — fine** |
| 3× widebody, Match | 93% | −$2.9M |
| 3× widebody, **Skim** | **328%** | −$31.3M |

Same sector, same distance, same warning. A distance-triggered notice fires identically
on the configuration that makes money and the one that loses $31M a quarter — because
the killer was posture and gauge, not length. The free tier has to name the actual
number or it is not a warning, it is a mood.

The gate remains meaningful, and gets *more* meaningful as a game develops: with one
aircraft type the comparison has one row and the tech adds nothing, which is correct —
you have no choice to optimise. It earns its cost exactly when a fleet grows complex
enough to need a planning department, which is also when a player can afford one.

## The verdict (free)

One line, wherever a configuration exists. In the prospect panel, quoted for one
aircraft of your most-operated type at Match:

```
LON–PAR · 343 km · 3 rivals
  Breakeven load    93%   one Aros W5, at Match
  Your ceiling      88%
  → cannot pay at Match with this aircraft
```

In the dossier, quoted for what is actually flying it, at the posture actually set —
which is what catches a configuration the prospect panel never saw:

```
  Breakeven load   328%   3× Aros W5 at Skim
  Your ceiling      88%
  → cannot pay at any load
```

That second case is the reported disaster, named in two numbers, on the screen the
player was already looking at.

## The comparison (gated by `network-planning`)

Rows are the **distinct aircraft types the player operates** — deduplicated by
`typeId`, assigned or not. Not parked tails only: by the time a player is expanding a
real network every tail is working, and the question is which *type* suits the sector.

```
LON–PAR · 343 km · 3 rivals

  AIRCRAFT           BREAKEVEN   CEILING   HEADROOM   FREE
  Aros N3   220 st        80%       88%       +8       2
  Vanta 5   178 st        86%       88%       +2       —
  Aros W5   480 st        93%       88%        —  cannot pay
  Tarn 72    72 st       125%       88%        —  cannot pay

  at Match · types you operate · today's competition
```

**FREE** counts unassigned tails of that type, distinguishing "this works and I have
metal idle" from "this works but I must move or lease one". Different answers, different
moves.

Quoted at **Match** with **one** aircraft, both stated in the panel. Tech applies
automatically since it is the player's own. Posture and how much metal to commit stay
the player's decisions — the panel says whether the sector *can* pay, never how to play
it. Listing only types already operated keeps fleet strategy a judgment call rather than
a lookup.

## Computation

A pure function in `src/sim/economics.ts`:

```ts
breakevenLoad(econ: RouteEconomics, posture: PricingPosture): number | null
```

Derived from the components `computeRouteEconomics` already returns, so it cannot drift
from the real model — the same discipline that has the prospect panel price a probe
route through the real economics rather than restating them.

Costs split in two:

- **Scaling with passengers:** handling's per-head half
  (`distributionPerPax × paxCost[posture]`), plus the overhead uplift riding on it.
- **Not scaling with load:** fuel, crew, maintenance, lease, standing, station and their
  overhead. These follow capacity and frequency, which the load factor does not move.

Cargo is subtracted from what must be covered — the hold earns whether or not the cabin
fills.

```
breakeven = (fixedCosts − cargo) / (fareRevenuePerUnitLoad − paxCostPerUnitLoad)
```

Living in `/sim` means the UI, the tests and any future AI use share one implementation.

## A prerequisite fix

The prospect panel prices its probe with `0, 0` for rivals. Pass `rivalsOf(index, probe)`
and `rivalCapacityOf(index, probe)` instead.

**This fixes nothing a player currently sees**, and an earlier draft of this spec wrongly
claimed it was a second cause of the "looks great" illusion. Measured: the panel reads only
`marketDemandWeekly` from that preview, and market demand is the whole market — 274,016 on
LON-PAR with rivals and without. The rival arguments move `loadCeiling` (0.880 → 0.793) and
`netCash` (+0.8M → −0.6M), and neither is on screen today.

It is a prerequisite all the same: every number the verdict and the table quote is
rival-dependent, so shipping them on a monopoly-priced probe would state the opposite of
the truth on exactly the contested sectors this feature exists to expose.

## Rewriting the spill alert

The existing alert fires when a sector turns away more than it carries and says:

> Clearing it needs at least 3x the metal that is on it now.

Its code comment claims this is *"under-gauged metal, not a pricing problem, and no
amount of posture fixes it."* Both halves are false in the cases that trap players, and
measurement shows two distinct faults:

**1. When breakeven exceeds the ceiling, the advice is inverted.** Widebody on LON–PAR:
net runs −$0.4M → −$1.4M → −$2.9M → −$5.1M → −$7.8M as aircraft are added. Every one
loses more, and the alert fires at one and two aircraft telling the player to add metal.

**2. Even where the sector pays, "clear the spill" overshoots the peak.** Narrowbody on
LON–PAR: net peaks at **+$1.6M at 3–4 aircraft** and falls to $1.3M at five. The alert
fires all the way to four. This contradicts CLAUDE.md §6, which states that adding
aircraft "wins share with diminishing returns, so profit peaks at a fleet size rather
than scaling for ever" — the alert argues with the design doc.

**Fix: make it marginal, not total.** The player's real question is not how much metal
clears the spill but whether *one more* aircraft helps. That is one extra
`computeRouteEconomics` call with one additional tail **of the type already flying the
sector** — the aircraft the player would realistically add — so it is answered exactly
rather than estimated. Where a sector already carries mixed types, use the most numerous;
where it carries one of each, use the largest, since that is the commitment being
tested.

| situation | message | styling |
|---|---|---|
| Next aircraft adds profit | "Turning away 2.3× what you carry. One more Aros N3 would add about $0.3M a quarter." | neutral |
| Next loses, sector pays | "Turning away 1.2× what you carry, but you are at the profitable size — another aircraft would cost about $0.3M a quarter." | neutral |
| Breakeven above ceiling | "Turning away 1.4× what you carry, and each aircraft here loses money — breakeven 93% against a ceiling of 88%. More metal deepens it; try a smaller gauge or a different sector." | negative |

Same trigger, same position. Red is warranted only in the third case; today it is red in
all three.

## Edge cases

| case | behaviour |
|---|---|
| Player owns no aircraft at all | Neither verdict nor comparison — no configuration exists to price. Panel shows today's market figures only |
| Player owns one type only | Verdict shown; comparison has a single row and the tech adds nothing, which is correct |
| Type cannot reach the sector | Row reads `out of range` (`canReach`), not a nonsense percentage |
| Fare below per-head cost | `cannot pay at any load` — no finite breakeven exists |
| Cargo alone covers costs | Breakeven ≤ 0 → `pays before a passenger boards`; rare, long widebody sectors |
| Ceiling varies per row | Computed per aircraft from the same conditions as its breakeven, never shared |

## Testing

The invariant that makes the number trustworthy:

> **breakeven < loadFactor if and only if the sector makes money**
>
> (Not `loadCeiling` — see the correction above. The original invariant as written here
> was false, and the test that "proved" it passed only because its ten hand-picked cases
> missed the 6.8% band where the two comparisons disagree. It is now a sweep over the
> whole aircraft roster across destinations and postures.)

A sim test asserting sign agreement across many route, fleet and posture combinations
catches any drift between this and the real cost model. The prototype showed 6 of 6
agreeing, including all three loss-making cases.

Plus: `breakevenLoad` returns null rather than a number for each edge case above; the
spill alert picks the right one of its three branches for a constructed sector of each
kind; and the table lists distinct types rather than tails.

## Deliberately not included

- **A dollar forecast.** Rejected in favour of breakeven: a point estimate reads as a
  promise, and season, noise and rival entry will all move it.
- **Every aircraft in the game.** Rejected: it would answer the fleet-purchasing
  question, and gauge against market size is the first decision the README names as what
  the game is about.
- **Any claim about the future.** No rival-entry prediction, no fuel forecast. A planning
  department models today's economics; nobody models next year's competitors.

## Constants

`breakevenLoad` reads only existing constants (`distributionPerPax`, `paxCost`,
`overheadRate`). No new tunables. The tech gate reads `carrier.tech.includes(...)`,
matching `src/sim/tech.ts`.
