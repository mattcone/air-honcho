# Demand model audit — 2026-07-28

Commissioned against a symptom from a real 25-year campaign: *nearly every route
sits at 85–90% load factor and nearly every sector is profitable, regardless of
route type, distance or competition; long-haul loses money while everything else
prints uniformly.*

The audit confirms one half of that emphatically, and refutes the other half —
the second turns out to be a real problem wearing the wrong name.

Nothing has been tuned. Proposals are in §6, unimplemented, per the brief.

## 1. How this was measured

Two instruments, deliberately different, because either alone would mislead.

**`npm run analyze`** — observational. Adds an optional `observe` hook to
`runGame` that dumps every live sector every quarter (`RouteObservation` in
`src/sim/headless.ts`), then reports distributions rather than means. Default run
is 10 seeds x 100 turns, present-day, medium: **89,469 sector-quarters**.

**`npm run controlled`** — experimental. The observational split cannot answer
"what does posture buy me", because the AI *chooses* posture to suit the route
and rivals *enter* the markets worth entering; comparing those groups measures
the selection, not the lever. So this holds sector, fleet and world fixed and
moves exactly one thing.

### Known limitation, stated up front

`observeRoutes` prices each sector through `computeRouteEconomics` with the
carrier's real conditions, which is what the dossier shows the player — but the
engine applies the per-market **seasonal and noise shock** inside
`computeCarrierQuarter`, one layer above. So the observational load factors are
the *deterministic projection*, and true settled load factor varies around them
by the seasonal swing (index `[0.86, 1.02, 1.16, 0.96]`, full effect above 45°
latitude, none below 12°).

This does not rescue the finding. A ±16% seasonal swing can unpin a sector whose
demand-to-capacity ratio sits near 1.0; it cannot unpin one at 1.40, and §3 shows
the ratios are mostly well above 1. Treat the load-factor spread below as a lower
bound on flatness — the truth is *slightly* less flat than reported, not
differently shaped.

## 2. The headline

```
                              p5     p25  median     p75     p95
load factor %              0.0    86.2    88.0    89.1    92.8
margin %                   0.0    21.2    31.1    38.6    49.2

at the load ceiling      83.8%
unprofitable sectors      4.6%
demand won then spilled  41.7%
```

Load-factor distribution, 89,469 sector-quarters:

```
  80–85      4.5%  ███
  85–90     65.3%  ████████████████████████████████████████
  90–95     18.4%  ███████████
```

The interquartile range of load factor is **2.9 percentage points**. Eighty-four
percent of the mass sits in one five-point bucket.

Margins are a different story and are *not* flat: p25 21.2% to p75 38.6%, a
17-point spread. But only **4.6%** of sector-quarters lose money, against a target
of "a meaningful minority unprofitable at any given time".

## 3. Question 1 — is load factor converging, and why?

**Yes, and the mechanism is not what the symptom suggests.** It is not weak
elasticity, not a self-correcting fare loop, and not seats auto-scaling to demand.

**Load factor is the ceiling constant read back.** `loadCeiling` is 0.88 baseline
(`demand.maxLoadFactor`), rising to ~0.93 with the four revenue programs and hard
capped at 0.94 (`demand.loadCeilingMax`). 83.8% of observations sit *at* that
ceiling. The distribution's two lumps — 85–90 and 90–95 — are simply carriers
without and with revenue technology.

The reason every sector reaches the ceiling is **spill is free**. From the
controlled headroom probe, best build per sector, no rivals:

```
  sector       demand/wk   share   won/wk   seats/wk   ratio   LF     spilled
  LON–PAR       274,016     43%  118,366     84,823    1.40   88.0%    43,722
  NYC–CHI       115,772     47%   53,843     52,549    1.02   88.0%     7,600
  LON–IST        63,778     46%   29,496     31,946    0.92   88.0%     1,383
  NYC–LAX        67,878     40%   27,298     22,586    1.21   88.0%     7,422
  LON–NYC        66,093     36%   24,000     16,931    1.42   88.0%     9,101
  PAR–NYC        55,854     38%   21,054     16,266    1.29   88.0%     6,740
  LON–SIN        22,470     38%    8,627      9,769    0.88   88.0%        31
```

Every sector wins more traffic than it can seat, so every sector prices out at
exactly 88.0%. A passenger who chooses you and cannot be seated is deleted from
the world at no cost — so **being undersized is never punished**, and the
profit-maximising build is therefore always capacity-constrained. The optimiser
lands under demand every time, by construction.

Network-wide, **41.7% of all won demand is spilled and deleted.** That is
materially worse than the 27.3% recorded in DECISIONS.md ("Spilled passengers
vanish instead of rebooking"), which was measured before delivery lead times and
the difficulty rework. That open item is not a curiosity — it is *the* cause of
the flatness, and it is getting worse.

Correlations confirm load factor is inert with respect to everything a player
does:

```
  aircraftCountVsLoadFactor      0.054
  demandVsLoadFactor             0.045
  competitorsVsLoadFactor        0.011
  capacityVsLoadFactor           0.293
```

Only capacity moves it, weakly, and only because a very large build finally
overshoots demand. Nothing else registers.

## 4. Question 2 — why does long-haul uniformly lose money?

**It does not.** This part of the symptom is not reproduced anywhere in the model,
and chasing it through the gravity exponent or the cost curve would have been
wasted work.

Observationally, by distance band:

```
  band     n        share   LF med   margin med   unprofitable   fare med   a/c med
  short      28714   32.1%     88.0         32.3           3.9%       $144       1.0
  medium     48295   54.0%     88.0         31.1           4.8%       $262       1.0
  long       12460   13.9%     89.1         28.9           5.3%       $581       2.0
```

Long-haul's median margin is 28.9% against short-haul's 32.3% — a 3.4-point gap,
not a loss. The named sectors are *healthy*:

```
  pair        n       LF %   margin %   unprofitable   rivals   fare   a/c
  LON–NYC       618     89.1       26.2           4.9%      0.0   $549   3.0
  PAR–NYC       486     89.1       29.0           3.3%      0.0   $601   4.0
  NYC–LAX       733     87.7       25.7           5.7%      1.0   $391   2.0
```

Nor is it fuel fragility. Break-even spot price on the best build:

```
  LON–NYC   $3.58/L      PAR–NYC   $3.44/L      LON–PAR   $4.24/L
  NYC–LAX   $3.72/L      LON–IST   $3.66/L      LON–SIN   $1.57/L
```

Spot fuel is ~$0.80/L. The transatlantic survives a 4.5x fuel spike. Only
*ultra*-long (LON–SIN, 10,848 km) is genuinely fragile at $1.57/L, which a real
oil-spike event can reach.

**What is actually true, and reconciles the symptom: the winning aircraft is a
225-seat narrowbody on every sector, including the transatlantic.** Net per
quarter on LON–NYC, match posture:

```
  type              seats   1 frame      3 frames     6 frames
  Aros N4            225        $7.68M      $23.38M      $46.94M   <- best
  Aros W5            480        $6.92M      $21.11M      $38.27M
  Vanta 9            370        $6.34M      $19.36M      $38.89M
  Aros W6            420        $4.73M      $14.54M      $29.25M
  Vanta 8            290        $3.69M      $11.43M      $23.03M
  Vanta 7            245        $2.28M       $7.18M      $14.54M
```

A player applying real aviation intuition — *widebody on the long-haul* — gives
up 18% (Aros W5) to 38% (Aros W6) to 69% (Vanta 7) against the narrowbody answer.
Layer one rival on top, which costs 57% of net (§5), and an intuitively-built
transatlantic route goes negative while the player's short-haul narrowbody
network, built the same intuitive way, prints money.

**So it is a gauge problem presenting as a distance problem.** The player
correctly perceives "my long-haul loses money"; the cause is the aircraft, not
the sector. This is the same root cause as the deferred slot-scarcity item in
DECISIONS.md — *nothing in the model rewards seats-per-frame* — now measured from
the player's side rather than the AI's. `share.gaugeElasticity` is 0.4 against
`share.refSeatsPerDeparture` 180, so a 480-seat frame earns only
(480/180)^0.4 = 1.47x the share of a 180-seat one while burning far more fuel and
costing far more to lease.

## 5. Questions 3 and 4 — do the levers work?

### Posture: not decorative

Controlled — same sector, same build, posture flipped. Swing is best-to-worst as
a percentage of the match-posture net:

```
  sector            km     build            premium        match      undercut    swing
  LON–PAR       343  6× Aros N4           -$23.45M      $18.19M      $21.70M    248%
  NYC–CHI      1144  6× Aros N4            $24.10M      $41.30M      $40.04M     42%
  LON–IST      2501  6× Aros N4            $22.72M      $40.90M      $37.60M     44%
  NYC–LAX      3935  6× Aros N4            $47.93M      $46.60M      $42.18M     12%
  LON–NYC      5570  6× Aros N4            $51.42M      $46.94M      $41.98M     20%
  PAR–NYC      5837  6× Aros N4            $49.35M      $44.63M      $39.75M     22%
  LON–SIN     10848  4× Vanta 9            $10.60M      $18.94M      $13.41M     44%
```

Minimum swing 12%, median ~42%. Comfortably above the 10% "decorative" threshold.
Better still, **the right answer flips with the route**: undercut wins on short
dense leisure markets, premium wins on the transatlantic. That is a real decision
with a non-obvious answer, and it is working as designed.

The observational split understates this badly (undercut 33.2% median margin vs
premium 28.0%) precisely because the AI already picks well — a textbook selection
effect, and the reason the controlled instrument exists.

### Competition: bites hard on margin, not at all on load factor

Controlled, one like-for-like rival added to the market:

```
  sector       alone        1 rival       2 rivals     dent(1)  dent(2)
  LON–PAR        $18.19M       -$2.00M        -$6.72M      111%     137%
  NYC–CHI        $41.30M       $13.76M         $8.01M       67%      81%
  LON–IST        $40.90M       $13.76M         $8.17M       66%      80%
  NYC–LAX        $46.60M       $19.04M        $12.38M       59%      73%
  LON–NYC        $46.94M       $20.33M        $13.24M       57%      72%
  LON–SIN        $18.94M       -$9.48M       -$15.77M      150%     183%
```

A single entrant costs the incumbent **57–150% of quarterly net**. Observationally,
contested sectors run 24.9% median margin against 32.8% uncontested — an 8-point,
24%-relative dent, with `competitorsVsMargin` at −0.183.

But load factor barely moves: contested 86.6% vs uncontested 89.0%, a 2.4-point
gap, `competitorsVsLoadFactor` = **+0.011**. `share.competitionLoadPenalty` (0.3)
was added expressly to make entry felt in load factor, and it is being swamped —
because a market with 40% spare spilled demand simply refills the seats a rival
takes. Competition is felt entirely through **share and fare**, never through
empty seats.

## 6. Proposed changes — NOT implemented, for review

Ordered by expected effect on the target shape (load factors spread ~60–95%; a
meaningful minority unprofitable; posture and gauge each worth double digits;
long-haul viable when hub-fed, marginal without).

### P1. Clear the market — redistribute spill instead of deleting it

**The single change that matters.** Not a constant: a model change in
`computeRouteEconomics` / a new market-clearing pass, already scoped in
DECISIONS.md ("Spilled passengers vanish instead of rebooking").

Allocate demand by attractiveness, then redistribute each carrier's spill across
carriers with remaining room, in proportion to attractiveness, until demand or
capacity is exhausted.

*Predicted effect:* load factor stops being a constant. Undersized carriers hand
traffic to rivals instead of deleting it, so being sub-scale is punished and the
optimiser no longer parks every route against the ceiling. Expect the 85–90 spike
to break into a genuine spread; the 41.7% spill figure should fall to single
digits. Also the honest fix for system load factor reading 88–89% against a
published 82–84%. **Everything below is worth far less until this is done**, and
some of it becomes unnecessary.

*Risk:* under-capacity would then be punished twice (lost share *and* lost
revenue), so `share.competitionLoadPenalty` (0.3) will likely need reducing —
possibly to 0 — since real spill competition would be doing that job for real.

### P2. Reward seats-per-frame so widebodies have a reason to exist

Touches `share.gaugeElasticity` (0.4) and `share.refSeatsPerDeparture` (180).

Raising `gaugeElasticity` toward ~0.6 makes a 480-seat frame worth
(480/180)^0.6 = 1.80x a reference narrowbody in share terms rather than 1.47x.

*Predicted effect:* narrows the 18–69% penalty the player currently pays for
flying a widebody on the transatlantic, so aviation intuition stops being
punished. Long-haul becomes a *gauge* decision rather than a trap.

*Caveat, and the reason this is P2 not P1:* DECISIONS.md is explicit that the
real fix is slot scarcity — without a constraint on frequency, adding another
narrowbody stays cheaper than up-gauging whatever this elasticity says, and
pushing it too far just makes piling capacity onto one trunk route dominant. This
is a mitigation, not the cure. The cure is the deferred slot mechanic.

### P3. Make the unprofitable minority real

Only after P1, and measured against it: 4.6% of sectors losing money is too few.
Candidates, in order of bluntness:

- `routes.quarterlyFixedCost` (150,000) — a flat per-sector charge; raising it
  hits thin routes hardest, which is where marginality belongs.
- `share.incumbentBase` (0.10) — the unmodelled rest of the industry. Raising it
  takes share from everyone uniformly.
- `share.monopolyPremium` (0.28) — 79% of observed sector-quarters are
  *uncontested* and collecting this premium. That is the largest single reason
  the median sector is comfortable.

*Predicted effect:* pushes the margin p25 from 21.2% toward zero, putting a real
minority under water without touching the strong routes.

*Do not* reach for `demand.maxLoadFactor`; both its own comment and DECISIONS.md
warn that lowering it to close the load-factor gap treats the symptom and breaks
the RASK/CASK calibration.

### P4. Leave posture alone

12–248% swing, direction correctly route-dependent. Working. No change proposed.

## 7. Regression assertions added

`tests/regression.test.ts` gains a `demand model shape` block encoding the ranges
this audit establishes, so a future balance change cannot silently re-flatten the
game. Deliberately loose — these are *shape* invariants, not the tuned figures,
and each carries the number measured today so a drift is legible:

- load factor is not a constant: the p75–p25 spread must exceed 2 points (today
  2.9) — a guard against regression, to be tightened hard after P1
- the ceiling does not swallow the distribution: fewer than 95% of sector-quarters
  at the load ceiling (today 83.8%)
- some sectors lose money: unprofitable share strictly above 1% (today 4.6%)
- posture is not decorative: best-to-worst posture swing above 10% of match net on
  a representative sector (today 12–248%)
- competition is felt: one like-for-like rival costs above 20% of quarterly net
  (today 57–150%)
- long-haul is not structurally dead: the long band's median margin within 20
  points of the short band's (today 3.4 apart)

## 7a. Figures re-measured — 2026-07-29

The balance work of 2026-07-29 (rival survival in downturns, and a difficulty
`yield` knob) touched behaviour on every level, so the medium-difficulty figures
above have drifted slightly. Re-measured on the same command:

| | 07-28 | 07-29 |
|---|---|---|
| sector-quarters observed | 89,469 | 107,831 |
| load factor median | 88.0% | 88.0% |
| at the load ceiling | 83.8% | 84.0% |
| margin median | 31.1% | 30.5% |
| unprofitable sectors | 4.6% | 5.7% |
| demand won then spilled | 41.7% | 41.3% |

Every conclusion in this document stands: load factor is still the ceiling
constant read back, spill is still ~41% of won demand, and the margin
distribution is still the healthy axis. The larger sample is itself a result —
rivals now survive downturns instead of shedding their networks, so there are
more live sectors to observe.

Note that on **hard** the yield knob now puts median route margin at 23.3%
against medium's 30.9%, which is the "routes are too profitable" complaint
answered at the difficulty level rather than in the model. It does NOT substitute
for P1: the flatness is unchanged, because yield scales revenue without touching
the capacity constraint that pins load factor.

## 8. What I would do next

1. Review these proposals.
2. Implement **P1 only**, re-run `npm run analyze`, and re-read this document —
   several of the numbers above are downstream of free spill and will move on
   their own.
3. Re-derive P2 and P3 against the post-P1 distributions rather than these.
4. Tighten the assertions in §7 once the shape is where it should be.

---

# Follow-up audit — 2026-08-02 (Q2 2038 playtest)

Diagnostic only. No tuning applied; proposals are at the end, unimplemented.

## Q0 — Status of the prior stream

**The audit stream did run.** Everything it was asked for exists:

| | |
|---|---|
| `docs/demand-audit.md` | exists — this document, produced 2026-07-28 |
| `npm run analyze` | exists, runs (`scripts/analyze.ts`) |
| `npm run controlled` | exists, runs (`scripts/controlled.ts`) |
| regression assertions | 7, in `tests/regression.test.ts` under `demand model shape` |

**Commit refs cannot be given, because there is no repository.** This working copy
has no `.git`; it was checked, not inferred. The record of what changed and why is
`DECISIONS.md`, which is dated and append-only, and `docs/design-pass/README.md`
for the UI stream.

**Were tuning changes applied to `constants.json`? Yes — but none of them were this
document's proposals.** P1 (redistribute spill), P2 (reward seats-per-frame) and P3
(make the unprofitable minority real) are all still unimplemented and still gated on
review. What *was* changed came from separate difficulty and AI work, and several of
those changes moved the numbers in this document. In date order, from DECISIONS.md:

- **2026-07-27** — delivery gating in `buildMarketIndex` (a correctness fix)
- **2026-07-28** — `growthActions`, `playerFocus` difficulty knobs
- **2026-07-29** — `recession`/`pandemic` made crisis-eligible; survival borrowing;
  `retreat` made horizon-aware; new `yield` knob (hard 0.90)
- **2026-07-30** — **`competitionLoadPenalty` made saturation-aware**; `monopolyPremium`
  0.28 -> 0.18; `competitionHalfShare` 0.35 -> 0.50; trunk-market discovery;
  archetype `minSectorKm` floors lowered; `entryPace`, `rivalCapital` knobs
- **2026-08-02** — bailout recorded and surfaced (a UI fix)

**The load-factor band narrowed on my watch, and I should name the cause.** The
saturation change of 2026-07-30 is the reason: it removed the competition penalty
from markets with demand to spare, which returned contested sectors to the ceiling.
It was recorded at the time as a known, accepted cost — the p75-p25 spread falling
from 2.9 points to ~1.5 — and the guard in `regression.test.ts` was lowered with a
comment saying so. The playtest observation is that regression being felt.

## Q1 — What pins load factor at ~93%?

**Causal chain.** Load factor is `min(demand won, capacity x ceiling) / capacity`.
On virtually every sector the first term is the larger, so the expression collapses
to the ceiling and load factor stops being an outcome at all. The ceiling is
`demand.maxLoadFactor` (0.88) lifted by four revenue programs
(1.012 x 1.018 x 1.012 x 1.015) to **0.931**, capped at `loadCeilingMax` 0.94.
93.1% is exactly the figure the playtest reports; the previous campaign's 85-90%
was the same mechanism before those programs had been delivered.

Hypotheses, ruled in or out by experiment:

**(a) Demand back-fill — RULED IN, and it is the dominant term.** Piling capacity
onto LON–PAR (`computeRouteEconomics`, one seed):

```
   a/c   seats/wk    demand won    load    spilled
     1     14,137        54,872   93.1%     41,707
     2     28,274        76,146   93.1%     49,815
     4     56,549       101,834   93.1%     49,173
     8    113,098       130,473   93.1%     25,153
    11    155,509       143,988   92.6%          0
    16    226,195       159,697   70.6%          0
    24    339,293       176,020   51.9%          0
```

One aircraft wins 54,872 passengers and can seat 14,137. Load does not move until
the **eleventh** aircraft — which is exactly the fleet the playtest has on that
sector, and exactly why it reads 92.6% rather than 93.1%. Demand is not "too high"
in the abstract; it is 3-4x the capacity a normal build puts against it.

**(b) A clamp — RULED IN; it is the same finding from the other side.** Observed
load equals the ceiling to three decimal places on every sector that can be flown
at all:

```
  sector      km      demand/wk    load    ceiling   at ceiling?
  LON-PAR      343     274,016    93.1%     93.1%    YES
  NYC-CHI     1144     115,772    93.1%     93.1%    YES
  LON-NYC     5570      66,093    93.1%     93.1%    YES
  NYC-LAX     3935      67,878    93.1%     93.1%    YES
```

(a) and (b) are not competing explanations. The clamp binds *because* back-fill is
unlimited: spill is free, so under-capacity is never punished and the profit-maximal
build always sits under demand.

**(c) Fare/demand feedback — RULED OUT.** Posture moves the fare and does not move
the load by a single point:

```
  sector      premium          match            undercut
  LON-PAR    93.1% @ $118    93.1% @ $87     93.1% @ $74
  LON-NYC    93.1% @ $678    93.1% @ $503    93.1% @ $427
```

Elasticity is real (`priceStimulation`) but it lands entirely in spill, which is
discarded. There is no equilibrium-seeking loop.

**(d) AI capacity — RULED IN, and it is the ONLY thing that unpins load.**

```
  sector      alone    +1 rival  +2      +3      +4
  LON-PAR    93.1%     84.5%    75.8%   72.2%   70.8%
  LON-NYC    93.1%     86.0%    78.8%   72.2%   70.8%
```

Which is why the band narrowed rather than widened: 76.5% of served markets still
have exactly one carrier, so most sectors never meet the one force that would move
them off the ceiling.

## Q2 — Where are the per-departure fixed costs?

**They exist. The brief's hypothesis is wrong, and handling is in fact the largest
single cost line on the sector.** Itemised for LON–PAR, 11x Aros N4, undercut:

| line | quarter | scales |
|---|---|---|
| revenue | $153.30M | — |
| fuel | −$8.95M | per-km x departures |
| crew | −$12.48M | per-block-hour (km **plus a 0.4h fixed pad per leg**) |
| maintenance | −$5.34M | per-block-hour (same fixed pad) |
| **handling** | **−$56.81M** | **per-departure ($1,200) + per-seat ($4)** |
| leases | −$18.48M | per-aircraft per-quarter |
| standing | −$1.53M | per-aircraft per-quarter (x seats) |
| station | −$0.15M | per-ROUTE per-quarter |
| overhead | −$15.56M | 15% rate on the above |
| **net** | **$34.00M** | |

So the model has three per-cycle terms: `fleet.handlingPerDeparture`,
`fleet.handlingPerSeat`, and `fleet.blockPadHoursPerLeg` (which charges crew and
maintenance a fixed 0.4h every leg regardless of distance). Handling alone is 37%
of revenue on this sector.

**What a further landing/ATC charge would do** (8,985 departures a quarter):

| added fee | cost | net becomes | survives |
|---|---|---|---|
| $800 | $7.19M | $26.81M | 79% |
| $1,500 | $13.48M | $20.52M | 60% |
| $2,500 | $22.46M | $11.53M | 34% |
| $4,000 | $35.94M | −$1.94M | negative |

A plausible major-hub charge (~$1,500 all-in for a 225-seat narrowbody) would remove
40% of this sector's profit. That is a real lever if short-haul is judged too rich —
but note the honest counter-evidence below.

**Counter-evidence the brief should weigh: short-haul is NOT the outlier the playtest
suggests.** Across 128,609 sector-quarters, median margin by band is short 27.1%,
medium 25.1%, long 26.3% — a 2-point spread. And LON–PAR specifically runs a **11.2%
median margin, the *thinnest* of the named sectors**, against LON–NYC's 20.6%. The
playtest's $59M is a big *absolute* number because the sector is flown with 11
aircraft at 691 departures a week; per aircraft it is one of the weaker earners.
Charging per-cycle costs would be defensible on realism grounds, but it would be
correcting a margin that is already the lowest on the board.

## Q3 — Is posture doing its job?

**Case (a), plus a genuine bug that the code's own comment says should not exist.**

`fareOneWay(a, b, posture)` is `(base + perKm x dist^exp) x cityWeight x posture` —
an **absolute** formula. It never reads what any rival charges, so "undercut" means
"85% of my own reference fare", not "below the competitor". That alone is the design
gap the brief anticipated.

But it does not explain a *dominant* carrier pricing above a small one, and this
does:

```
  big carrier   small carrier   big fare   small fare   cheaper?
            8               2      $94         $90      the SMALL one
            6               3      $93         $90      the SMALL one
            4               4      $92         $92      tie
            2               8      $90         $94      the big one
```

**Two carriers on the same market with the same posture clear at different fares,
and the bigger one always charges more.** `competitionFareMultiplier` is called
per-carrier with `rivalCapacityWeekly` — *everyone else's* capacity, excluding
itself. A dominant carrier therefore sees little rival capacity, keeps most of the
monopoly premium, and prices high; a small carrier sees a lot, has its premium
compressed, and prices low.

The docstring on that function states the opposite as an invariant: *"It applies to
every carrier on the market equally (the market clears at one fare), so it does not
distort share."* **The code does not do that.** On CAI–IST the playtest is the big
carrier, so its undercut fare ($126) sits above Halyard's ($115).

Not case (b): nothing is stale — the fare is recomputed from live capacity every
settlement. Not case (c): no cost floor exists in `fareOneWay`.

**Posture still moves the fare in the right direction** — against the same small
rival on match ($106), the player prices $150 premium / $111 match / $94 undercut.
The button is not inert; the size-asymmetric premium can simply outrun it.

**How much posture is worth**, best-to-worst as a share of the match-posture net
(controlled, one sector at a time, from `npm run controlled`): short-haul 42–248%,
medium 12–44%, long 20–22%. Comfortably double-digit everywhere, so posture is not
decorative.

**I have NOT fixed this.** The brief authorises an immediate fix only for case (b),
and this is not case (b). The premium asymmetry is a bug, but correcting it changes
every fare in the game, which makes it a balance change in effect. It is P0 below.

## Q4 — Do decisions matter yet?

**They do, and roughly as much as the world does — this is not the core finding.**
Spread in quarterly sector net, one sector at a time:

| sector | band | decisions (posture x type x count) | world (12 seeds, 20 turns of events/fuel) |
|---|---|---|---|
| LON–PAR | short | $67.8M | $61.0M |
| NYC–CHI | short | $53.2M | $69.2M |
| LON–IST | medium | $43.1M | $65.4M |
| NYC–LAX | medium | $88.3M | $71.2M |
| LON–NYC | long | $70.8M | $71.1M |
| PAR–NYC | long | $90.9M | $68.3M |

Decision-attributable spread is 0.6x to 1.2x world-attributable spread. Choices are
not drowned out.

**The precise defect is narrower than "decisions don't matter": decisions move MONEY
but they do not move LOAD.** Q1(c) shows posture changes the fare by 60% and the load
factor by nothing. So the one number the player watches on every row of the schedule
is the one number no decision of theirs can shift — which is exactly why the board
reads flat even though the economics underneath are responsive.

**Baseline distributions, current build**, 128,609 sector-quarters, medium:

```
                    p5     p25  median     p75     p95
load factor %      0.0    87.5    88.2    89.1    92.4
margin %           0.0    16.3    25.8    34.8    46.5

at the load ceiling      87.9%   (was 83.8% on 2026-07-28)
unprofitable sectors      4.3%   (was 4.6%)
demand won then spilled  42.1%   (was 41.7%)

load factor:  85-90  71.0%
              90-95  17.5%

by band       LF med   margin med   unprofitable
  short        88.2       27.1%         4.0%
  medium       88.0       25.1%         4.5%
  long         89.1       26.3%         3.7%
```

The at-ceiling share has risen 83.8% -> 87.9% since the first audit. The band did
tighten, and the saturation change is why.

## Proposed changes — NOT applied, for review

**P0 (new, and the only one that is arguably a bug fix). Make the monopoly premium
a property of the MARKET, not of each carrier.** Touches
`demand.competitionFareMultiplier` and its call site in `computeRouteEconomics`:
compute `rivalShare` from TOTAL market capacity rather than from each carrier's view
of everyone else. *Effect:* one clearing fare per market, so posture becomes the only
thing that moves a carrier's price relative to its rivals — the CAI–IST anomaly
disappears and the button tells the truth. Serves: posture swings a route
double-digit %. *Risk:* every fare in the game shifts slightly; the monopoly premium
on a genuinely uncontested route is unchanged, which is the case it was tuned for.

**P1 (unchanged, still the one that matters). Redistribute spill instead of deleting
it.** *Effect:* the only fix that reaches Q1(a). Until under-capacity is punished,
load factor cannot become an outcome, and every other proposal here is cosmetic
against it. Serves: load spread 60–95%.

**P1b (new). Reconsider the saturation scaling on `competitionLoadPenalty`.**
Introduced 2026-07-30 to allow multi-carrier markets; measured cost was the
load-factor spread falling 2.9 -> ~1.5 points and the at-ceiling share rising to
87.9%. If P1 lands, this becomes unnecessary — real spill competition would do the
job it was standing in for — and it should be reverted at that point.

**P2 (unchanged). Reward seats-per-frame** — `share.gaugeElasticity` 0.4 -> ~0.6.

**P3 (revised). Add a landing/ATC charge per departure** — a new
`fleet.landingFeePerDeparture`, city-weight scaled like handling already is.
*Effect:* quantified above; ~$1,500 removes 40% of LON–PAR's profit. Serves:
short-haul frequent but thin. **But see the counter-evidence in Q2** — short-haul is
currently the thinnest-margin band by the median, not the richest, so this may be
correcting an impression rather than a number. Recommend measuring per-aircraft
returns by band before applying.

**Not proposed: `demand.maxLoadFactor`.** Its own comment and the first audit both
warn that lowering it to close the load-factor gap treats the symptom.

---

## Applied — 2026-08-02, after review

**P0 — APPLIED. The monopoly premium is now a property of the market.**
`competitionFareMultiplier` takes the market's TOTAL scheduled capacity instead of
each carrier's view of its rivals, so the market clears at one fare. Verified: two
carriers of any size on CAI-IST now price identically ($90 at 8-v-2, 6-v-3, 4-v-4,
2-v-8), and undercut ($91) finally sits below a small rival's match ($106). The
playtest anomaly is gone. The docstring that claimed this invariant now describes
what the code does.

**P1 — APPLIED, and it does NOT do what this document predicted. Reporting that
plainly.** Spill now re-books with whoever has room (`share.spillCapture` 0.6)
rather than being deleted. It is better modelling — a carrier that under-builds now
hands its overflow to a rival that gains from it — and it makes demand shocks reach
a sold-out sector for the first time. **But it did not unpin load factor**:
at-ceiling went 87.9% -> 89.7%, the wrong way. The reason is visible in the
arithmetic: absorbing overflow only ADDS passengers to a carrier that had room, so
it pushes that carrier UP toward the ceiling. Nothing in it pulls anyone down.

**The load-factor finding, corrected.** This document's §3 said spill was "the cause
of the flatness". That is wrong, and the evidence is a demand sweep: halving
`demand.k` from 140,000 to 65,000 left at-ceiling at 87.2% and the p5-p95 spread
unmoved. **Load factor cannot be unpinned by tuning demand, because capacity is
CHOSEN in response to demand.** A carrier sizes its fleet to the traffic it expects,
so `won >= capacity` holds at any demand level and `min(won, capacity x ceiling)`
collapses to the ceiling. The only two things that move it are rivals arriving after
you have built (93.1% -> 70.8% with four) and demand falling after you have built
(seasonality, recessions). Both are real and both already work.

That reframes the target. "Load spread 60-95%" is not reachable by tuning the
demand side at all; it needs either per-route demand variance the model does not
have (day-of-week, directional imbalance) or many more contested markets.
`demand.k` was restored to 140,000 — the sweep found no case for moving it.

**P1b — NOT APPLIED.** The saturation scaling was to be reverted "if P1 lands".
P1 landed and did not deliver the load-factor spread, so reverting saturation would
only re-break multi-carrier markets for nothing. It stays.

**P2 — NOT APPLIED.** `share.gaugeElasticity` 0.4 -> 0.6 was measured and changed
the LON-NYC gauge ranking by nothing at all: the 225-seat narrowbody wins by 2.6x
either way, because six widebodies is simply more capacity than a 66,000/wk market
can fill. The widebody problem is the same capacity-versus-demand fact, not a share
elasticity, and DECISIONS.md warns that raising this risks a pile-onto-one-route
strategy. Reverted to 0.4 rather than keep an unmeasurable change.

**P3 — NOT APPLIED, on this document's own evidence.** A landing fee is defensible
realism, but Q2 showed short-haul is already the thinnest-margin band by the median
(LON-PAR at 11.2% against LON-NYC's 20.6%). Charging per-cycle costs would push the
band that is already thinnest further down. It needs a per-aircraft-return study
first, not an application.

**Distributions after P0 + P1**, 66,813 sector-quarters:

```
                    p5     p25  median     p75     p95
load factor %      0.0    87.5    88.3    89.1    92.5
margin %         -11.4    13.9    24.3    32.9    44.8

at the load ceiling      89.7%   (was 87.9%)
unprofitable sectors      7.4%   (was 4.3%)
demand won then spilled  48.5%   (was 42.1%)
```

The margin distribution is the honest gain: **unprofitable sectors 4.3% -> 7.4%**
and the p5 moved from 0.0% to -11.4%, so a real minority of routes now lose money —
one of the target-shape criteria, met. Load factor is unchanged, for the structural
reason above.
