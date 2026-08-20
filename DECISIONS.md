# Decisions

Why things are the way they are, when the reason isn't visible in the code.

[CLAUDE.md](CLAUDE.md) holds design *intent* and wins over anything here.
`IDEAS.md` is for cut scope. This file is for decisions that were taken or
deliberately deferred, with enough context to re-open them later. Entries are
dated and append-only — supersede an entry rather than editing it.

---

## Deferred

### Slot scarcity at congested airports — deferred 2026-07-21

**What.** Give each city a finite supply of departure slots, scaled from its
population and economic weight. Departures consume slots; congested airports
price them, ration them, or both. Slot holdings become a balance-sheet asset.

**Why it came up.** Six of the fifteen aircraft types were never the optimal
choice on any city pair. Investigating showed the widebodies fail for a
structural reason rather than bad stats: *nothing in the model rewards
seats-per-frame*. On Seoul–Tokyo — the densest market on the map at ~159,000
one-way passengers a week — the best answer even with all twelve permitted
frames is a 220-seat A321neo-class aircraft at 93% load factor. Adding a second
small aircraft is always cheaper than up-gauging to a large one.

That is exactly backward from reality. The 777-300ER (~840 built) and the A380
exist *because* Heathrow, Haneda and their peers ration slots: when you cannot
add another frequency, you must up-gauge. It is also why the A380 failed — only
a handful of airports are constrained enough to need one.

**Why deferred.** It is a genuine mechanic, not a constant tweak, and it changes
what a "good route" is. Phase 2's rival AI would otherwise be tuned against
economics that are about to move. Deferred on the owner's call, not on merit.

**What it would unlock.**
- A commercial reason for the large widebodies to exist, and a correct reason
  for the very largest to stay marginal.
- Hub cities become strategically valuable in their own right, rather than being
  just another endpoint with a bigger population number.
- A far better shape for Phase 2 than abstract share competition: rivals fighting
  over scarce slots at the same hub is a legible, board-level conflict, and it
  gives profit-triggered market entry something concrete to contend for.
- Sets up Phase 4 — slot portfolios are a real acquisition motive.

**Board-meeting test.** Passes comfortably. Slot portfolios are a CEO-level
asset and airlines really do buy each other for them.

**Rough shape when picked up.** Slots per city in `cities.json` (or derived from
pop × weight); `maxAircraftPerRoute` becomes redundant and should probably go;
congestion pricing as a per-departure surcharge that rises as a city fills;
`RouteEconomics` gains a slot-cost line. Watch that it does not simply make hub
cities the only viable home bases — the calibration work below fought hard to get
84% of cities to a viable opening sector.

**Now also blocked on this.** Phase 2 confirmed the diagnosis from the other
side: even the world's densest market wants a 220-seat narrowbody, and rivals
respond to being out-competed by adding *another frame*, never a bigger one.

**Related open item.** Turboprops and small regional jets (Tarn 42/72, Cirro R70)
are also never optimal, but for different missing mechanics: genuinely thin
markets (the demand recalibration below flattened most of them away), short or
hot-and-high runways, and US-style scope clauses. Slot scarcity will not fix
those. Decide separately whether the regional end of the fleet ladder earns its
place at all, or whether the aircraft list should just be shorter.

### The game cannot be lost after about year five — open 2026-07-22

Player feedback after playing Phase 2: "it feels like the game is too easy, like
there's no way to lose." Measured across 20 headless games where the fixture
actually built a network:

- **0 of 20 failed after year 5.** Once established, failure is off the table.
- Median final net worth **8.1x** the starting cash.
- Quarterly net after year 5: p5 **−$1.4M**, median **+$6.2M**, p95 **+$51.8M**.

That last line is the whole problem: the upside tail is roughly **37x** the
downside tail. Only 15% of quarters lose money at all, and a bad one costs a
rounding error against a balance sheet in the hundreds of millions.

Most of the missing hardship is scheduled — events and the fuel walk are Phase 3,
debt and hostile takeover are Phase 4 — so this is largely a roadmap gap rather
than a defect. But two things are worth writing down now.

**The spill cushion will absorb Phase 3's demand shocks.** Player routes run at a
median demand-to-capacity ratio of **1.12x**, and **25% carry 20% or more spare
demand**. A route that is selling out with 20% of its traffic already spilling
does not notice a 20% demand shock at all — it just spills less. Phase 3 events
that only move demand will land softly on exactly the strong routes that need
threatening. Events should hit the **cost** side (fuel, crew, maintenance) or the
**capacity** side (groundings, closures) to be felt, or the cushion has to shrink.

**Revenue is close to deterministic.** Demand noise is the only stochastic input,
and on a sold-out sector it does nothing whatsoever (there is a test pinning this:
"is immune to demand noise on a sold-out sector"). So a competent operator's
income is nearly a straight line. Costs are entirely deterministic today.

### How full you can fly is a decision, not a constant — 2026-07-22

Player question: "why is capacity apparently always fixed at 88%?"

It was. `maxLoadFactor` was a single constant applied to every carrier forever,
so every strong sector reported exactly 88% and the number carried no
information. That is wrong: the achievable load factor is one of the things that
separates a well-run airline from a badly-run one — revenue management decides
how much inventory to protect for late high-fare bookings, capacity planning
matches gauge to the daily and seasonal peaks, and repeat custom books earlier
and cancels less.

`loadCeiling` is now an operating condition like fuel or completion. The 88%
constant is its baseline; four technology programs raise it (revenue
management, dynamic pricing, loyalty, network planning) to **93.1%**, and a
recession lowers it. There is a hard cap at 94% — nobody sells the last seat on
every departure.

Worth 11% of revenue on a sold-out sector between an airline that has invested
and one that has not, which is a real reward for a real decision.

The dossier now also reports **Turned away** — passengers who chose you and could
not be seated. On a full sector that is the most actionable number on the screen,
and it is what makes "load factor 88%" mean something rather than looking like a
cap nobody can move.

Not modeled: brand and advertising as separate levers. The loyalty program is
the closest the tree comes, and there is a reasonable case for advertising as its
own spend that buys share rather than load factor.

### Spilled passengers vanish instead of rebooking — SUPERSEDED, fixed 2026-07-24

**This entry is history, not a live problem.** P1 was applied: spill re-books with
whoever has room (`share.spillCapture`, currently 0.6) rather than being deleted.
See "P1, applied, and it did not do what the audit predicted" under Taken. The
entry is kept because its measurements explain why the change was made, but every
present-tense claim below — that spill goes nowhere, that under-capacity is free,
that nothing pressures a carrier to add seats — stopped being true when P1 landed.
Left in the Deferred section unedited for two days, it was read as current and
repeated as current. An entry that has been overtaken has to say so in its title.

Found while diagnosing why a rival on New York–London was earning twelve times
the player from twice the aircraft.

Share is computed from frequency and posture, then capped at capacity. Whatever
a carrier wins but cannot seat is simply dropped. On that sector:

| | wins/wk | carries | spills |
|---|---|---|---|
| player, 1 aircraft | 3,839 | 1,497 | 2,342 |
| rival, 2 aircraft | 5,901 | 2,994 | 2,907 |

(Figures per direction, as measured at the time. `RouteEconomics` now reports
both directions — see "Route traffic is quoted in one unit" below — so the same
sector reads at twice these numbers in the dossier today.)

**16% of the whole market chose a carrier, was turned away, and then stopped
existing.** In reality a passenger you cannot seat books whoever has seats, so
being sub-scale actively hands traffic to your rival. Here it hands them nothing.

Fixing it means clearing the market rather than pricing each route independently:
allocate demand by share, then redistribute any carrier's spill across the
carriers with room, in proportion to attractiveness, until nothing is left or
nobody has space. That is a real change — `computeRouteEconomics` would need each
competitor's capacity rather than just their attractiveness total, or a
market-clearing pass ahead of it — and it would need rebalancing afterwards,
because under-capacity would start being punished twice.

It is worth doing: it is the mechanism that should make competition bite hardest,
and right now it is missing.

**Measured network-wide 2026-07-22**, over 30 games to the horizon, this is not a
New York–London curiosity — it is the dominant distortion in the model:

| | |
|---|---|
| of all traffic carriers win, share actually flown | 72.7% |
| share won, turned away, and deleted from the world | **27.3%** |
| spill on the median sector | 24% of what it won |
| sectors spilling more than 30% of what they won | 42% |

The consequence reaches further than the lost revenue. Because spill is free —
it goes nowhere, so no rival gains from it — nothing pressures a carrier to add
capacity, and 73% of sectors sit pinned against `maxLoadFactor`. That is why the
model's system-wide load factor reads 89.5% against a published 82-84%: the
ceiling has become the average, because the model has almost no unproductive
flying. **Market clearing is the fix for the load-factor discrepancy too, not
just for competition.** Do not attempt to close that gap by lowering
`maxLoadFactor` — see the note on it in constants.json.

### Owned aircraft look free at route level — open 2026-07-22

Same investigation. A leased aircraft charges rent to the sector every quarter; a
bought one charges nothing, because the P&L is deliberately cash-based (Phase 1).
On New York–London that is worth **$7.24M a quarter** — larger than most sectors'
entire profit, and the sole reason a `preferOwn` archetype like the state-backed
flag carrier appeared to be twelve times better run than a player who leased.

The accounting is not wrong: owning genuinely costs no cash per quarter, the
capital is tracked as book value, and bankruptcy correctly keys off cash. But the
market board sets two carriers side by side as though the comparison were
like-for-like when one has sunk $145M and the other has not. Real route
profitability charges ownership — depreciation plus a capital charge — precisely
so the comparison means something.

Mitigated for now by showing how the metal is held and what rent it pays, so the
difference is at least visible and explicable. Charging depreciation to the sector
would be the full fix, and would want its own decision: it changes what "sector
net" means everywhere, including the number bankruptcy is judged on.

### A carrier can wither without ever going bankrupt — open 2026-07-22

Measured over 150 games after Phase 3:

| outcome | share |
|---|---|
| bankrupt | 9% |
| **withered to nothing** | **27%** |
| survived, modest | 3% |
| thriving (>3x) | 61% |

"Withered" means the carrier traded, lost money, shed every sector and then sat
on its remaining cash to the horizon. It is not bankrupt, so the game never says
anything, but it has not been an airline for years. That is a distinct end state
the game does not currently name, and arguably should — a carrier with no
aircraft and no routes for a sustained stretch has failed, whatever the bank
balance says.

The distribution is strongly bimodal because home city quality dominates: a good
base thrives, a poor one withers. That is the intended shape of the home-base
decision, but it does mean the middle is nearly empty.

### Rivals almost never fail — partly resolved 2026-07-22

Phase 3 gave the world enough variance to kill a rival. Across 150 games,
**hazard rates per 100 quarters of exposure**: flag carrier 0.011, legacy hub
0.017, roll-up artist 0.126, ultra low-cost 0.132. Phase 2 measured 1 failure in
56 carriers; it is now a routine part of a run.

The original diagnosis still stands for the deep case — a carrier that can always
shed its worst sector is hard to kill outright, and genuine over-leverage is
Phase 4 — but the archetypes now differ from each other in survival the way their
descriptions say they should, with the flag carrier's deep pockets making it
nearly unkillable and the thin-capital archetypes carrying real risk.

### Rivals almost never fail — deferred 2026-07-21

Across 30 games only 1 of 56 rivals went bankrupt. CLAUDE.md §9 lists "median
ULCC outlives median roll-up artist" as a balance invariant, which is vacuous
while nobody dies, and §6 calls the roll-up "high leverage, fragile".

The cause is structural, not a tuning miss: `retreat()` lets a carrier shed its
worst sector whenever cash runs short, and nothing in the model creates an
obligation it *cannot* shed. Real airline failure comes from leverage — and debt
is Phase 4. Loosening the roll-up's reserve and growth drag was tried and moved
the failure rate barely at all.

Pick this up with the Phase 4 financial layer rather than by tuning archetypes.

---

### Rivals plateau because their search is capped — deferred 2026-08-07

A rival's growth flattens around turn 60. The cause is `origins()` in
`src/sim/ai/common.ts`: it searches only the top `maxOrigins` (7) cities, and a
large carrier's best remaining sector is usually outside that set, so it falls back
to adding another aeroplane to something it already flies — 30 times out of 32 in a
late-game sample.

Rotating the window by turn number fixes the symptom emphatically. The biggest
rival's growth over its last forty turns went **15% -> 128%** and its final value
**$45B -> $100B**.

It is deferred, not rejected, because that growth is a runaway rather than a
stronger opponent. With it in:

- the field consolidated to a **monopoly on seed 105**, breaking the antitrust
  invariant in CLAUDE.md §9
- no Territorial could hold 55% of a hub any more, so `cornerRentThreshold` never
  fired and the archetype stopped charging rent — its premium share fell to 0.8%
  against a legacy carrier's 5.7%, i.e. the identity beat of the archetype vanished
- a late-game turn went 52ms -> 321ms and the suite 55s -> 531s with seven timeouts

The cost objection is now gone (see the tally entry under Taken); the *stability*
objection is not. The merger-review and antitrust pressure are tuned against a field
that grows slowly, and have to be re-tuned against one that does not — before the
search opens up, not after. Whoever picks this up should treat the antitrust floor
and `cornerRentThreshold` as part of the same change, not as follow-up fixes.

### `hubDominance` is blind to city size, and the ULCC out-corners the Territorial — open 2026-08-07

Measured over 24 seeds at 100 turns, the share of its own hub's sectors each
archetype ends up holding:

| archetype | n | mean | median |
|---|---|---|---|
| ULCC | 158 | **60.9%** | 68.4% |
| flag | 16 | 59.2% | 51.6% |
| Territorial | 23 | 50.5% | 43.2% |
| legacy | 13 | 41.7% | 41.4% |

The archetype whose entire identity is collecting a hub the way the board game
collects a colour group is beaten at it by the low-cost carrier, and not narrowly.

The cause is that `hubDominance` is a raw share and takes no account of how big the
city is. A ULCC flies out of secondary cities where only a handful of sectors exist,
so holding most of them is close to free; a Territorial based at LON holding 44% of
it has done something far harder and scores lower for it. The same blindness runs
into `cornerRentThreshold`, which is a fixed share: it is easiest to clear exactly
where cornering means least, and hardest where it means most.

Not fixed here, because it is a design change rather than a balance one and it
should be a deliberate choice: weighting dominance by the city's sector count (or by
its traffic) would change what every archetype is optimising for, not just this one.
Worth doing before any further work on the Territorial — the archetype currently
cannot be tuned honestly against a metric that rewards the wrong thing.

## Taken

### The Maximum button that went dark when you pressed it — 2026-08-05

Player report: "the maximum (etc) buttons don't work sometimes when I click on
them." Two separate faults, both in `askAmount`, both amount-dependent — which is
exactly why it was "sometimes" and why neither showed up in review.

**The highlight compared the wrong two numbers.** Clicking a preset set the field to
the value rounded DOWN to a display step, but the "which preset is active" test
compared the RAW preset against what was in the field. On a ceiling of $12,345,678
that is 12.345678 against 12.34 — a gap of 0.0057 against a 0.005 threshold, so the
button went dark the instant it was pressed. Only ceilings that were already round
numbers ever lit. The field did change, so nothing was broken underneath; it simply
read as a button that did nothing, which is worse than an error.

**And any ask under one display step rounded away to nothing.** The field was two
decimals of a millions box, always — one step of $10k. A ceiling of $8,000 floored
to zero, so "Maximum" set the field to 0 and Confirm stayed greyed with no valid
amount expressible at all. Reachable on a small stake sale, or repaying against a
nearly empty account. Decimals now follow the size of the ask (2 above $1M, 3 above
$100k, 4 below), so the step is always fine enough to land on the ceiling exactly
and the ordinary eight-figure case is unchanged.

| ceiling | before: field / confirm / lit | after |
|---|---|---|
| $105,000,000 | 105 · valid · lit | unchanged |
| $12,345,678 | 12.34 · valid · **dark** | 12.34 · valid · lit |
| $8,000 | **0 · greyed** · dark | 0.008 · valid · lit |
| a quarter of $30,000 | **0 · greyed** · dark | 0.0075 · valid · lit |

**Note on the test.** The first version asserted the fixed comparison against
itself, which is a tautology — stepped-against-field agrees by construction and
proves nothing. Replaced with one that shows the OLD comparison genuinely failing on
ordinary ceilings, so the test pins the bug rather than the fix. Worth recording
because a passing test that cannot fail is worse than no test: it reads as coverage.

### The acquire dialog quoted the share price, not the deal — 2026-08-06

Player report: the acquisition screen showed $500M and the real cost was in the
billions. Correct, and it was a loose end from this session's own enterprise-value
fix.

`acquisitionCost` returns what the SHARES cost — market cap at a premium, less the
stake already held. The merge also moves the target's entire debt onto the buyer, and
`ACQUIRE_CARRIER` was changed earlier the same day to refuse unless the buyer can
carry both. The engine was corrected; the dialog was not. So a carrier could be
offered at its share price and land as an enterprise several times larger.

The sharpest detail: **the engine's own rejection message had been naming both
figures the whole time** — "costs X and assumes Y of its debt" — while the screen the
player actually reads named one. The information existed and never reached the place
it was needed, which is the same shape as the two column bugs recorded above.

Now quoted at enterprise value and itemised rather than summed, for the reason the
sector panel itemises: a single total cannot tell you that most of the deal is
somebody else's borrowing, and that is the whole character of a leveraged buyout.
The affordability warning was wrong in the same way — it compared cash against the
share price, so it stayed silent on deals the engine would refuse. It now checks
cash plus borrowing capacity against the total, which is exactly what the engine
checks. The row tooltip carried the same understatement and got the same fix.

Pinned by tests on the RELATIONSHIP rather than the copy: a buyer holding exactly
the share price is refused and told why, a buyer holding shares plus debt succeeds,
and the target's debt lands in full on the acquirer afterwards. Quoting anything
less than that sum is quoting the wrong number, whatever words surround it.

### Medium was being measured on the wrong thing all along — 2026-08-06

Player, after a day of tuning: medium is laughably easy, they had just acquired
basically every airline, and could the AI adapt to what the player is doing.

**The yardstick was broken, and it explains every flat sweep of the day.** Medium's
headless player was losing **121 games in 240 to TAKEOVER** against 39 to bankruptcy.
So "medium survival is 34%" was mostly measuring a fixture that never watches its
share register — a way to lose no competent human ever suffers. Split by cause:

| | raw | solvency (ignoring takeover) | bankrupt | taken over |
|---|---|---|---|---|
| easy | 98% | 99% | 2 | 4 |
| medium (before) | 33% | **67%** | 39 | 121 |
| hard | 10% | 12% | 174 | 42 |

Hard beats you at running an airline; medium was beating a bot at reading a cap
table. Tuned against solvency instead, `growthActions` 1 -> 2 moved it **64.2% ->
48.1% over 960 games — 16 points at over two standard errors**, the only lever all
day to clear that bar, and bankruptcies 88 -> 124. Note 3 is WORSE than 2 and yields
FEWER bankruptcies: past two moves a quarter the field over-expands, thins and starts
killing itself, which relieves the player rather than pressing them.

**The M&A layer only ran one way**, which is why buying the board was the cheapest
victory. The merger review lives inside `maybeAcquire`, which is AI-only, so the
player faced no antitrust whatever; and `foldable` excludes the player, so no rival
can ever buy the player outright. The only thing that responded to player success
was rivals arriving sooner — measured earlier the same day as having no effect at all.

**So dominance now pushes back.** Above `dominanceNoticedAbove` (28% of the world's
sectors, counting anything commanded) the next carrier costs more to buy — minority
holders know what their shares are worth to a near-monopolist, and a competition
authority takes remedies from a big acquirer it would wave through for a small one —
and rivals are drawn onto whoever is ahead. Keyed on ANY carrier, never the player
specifically: a rule that only fires on the human is not a rule about concentration.

**A bug introduced and caught in minutes:** the premium went into `acquisitionCost`
and not into `mergeCarrier`, so a dominant buyer was TESTED at the higher price and
CHARGED the lower one. Third instance today of one number living in two places.

**A guard that was giving false comfort.** "Opens more sectors on hard than on
medium" failed, and chasing it found something better: measured raw, hard opens 41
sectors by turn 30 against medium's 82 and looks becalmed — but that count is a
function of how many carriers are ALIVE to open anything, and hard fails rivals far
more often. Per live rival per quarter, hard expands FASTER (0.78 against 0.71). The
file already warned about this confound for the standing count and never carried the
warning to the flow count, which shares it: a dead carrier stops opening sectors too.
The guard now measures the rate, and was verified to still bite — with hard's
growthActions put back to 1, its rate falls to 0.44 and the test fails.

Final ladder: easy 98% raw / 99% solvency, **medium 25% / 48%**, hard 10% / 12%.
505 tests, determinism identical.

**The caveat that matters more than the numbers.** All of this is still measured
against a fixture that plays nothing like a person; the only thing that changed is
which of its failures are counted. Solvency is a better proxy than the aggregate was,
and it is still a proxy. If medium reads easy in a human's hands at 48%, the next
move is not another constant — it is teaching the fixture to play properly, because
a yardstick that flatters both sides is worse than none.

### Medium, again — and three levers that do nothing — 2026-08-06

Player: medium is still a little too easy, and earlier entry is fine by them. It
took four sweeps and roughly 3,500 games to find the one knob that moves it, and the
three that do not are worth more than the one that does.

**entryPace does not make the game harder.** This is the lever the player explicitly
licensed, so it got the biggest sample: 1.4 against 2.0 over 480 games an arm,
**40.0% -> 39.0%**. It is not a small effect, it is no effect. And the mechanism
plainly works — rivals on the board by year three go 2.8 -> 3.7, a third more early
competition. They simply arrive small, and arriving sooner also gives them longer to
compound into carriers a player can trade against rather than merely survive. Left
at 1.4 anyway, and documented in constants.json as TEXTURE rather than pressure, so
the next person does not read it as difficulty.

**contestPressure is saturated above 0.9.** 0.9 / 1.15 / 1.35 measure 40% / 39% /
39%. The 0.55 -> 0.9 step earlier in the day did its work and the lever then stopped.
Which also corrects a claim made two messages before that one: the 53% -> 40% move
had been attributed to "contestPressure carrying it alone", and with the higher rungs
measuring flat that attribution does not hold either.

**predation runs backwards**, established earlier the same day: 53% -> 58%. A field
that undercuts itself grinds its own margins down over a hundred quarters and the
player is under no obligation to join in.

**What worked: yield 1.0 -> 0.96.** Confirmed at 960 games, **40.0% -> 35.0%, five
points at 1.6 standard errors** — suggestive rather than conclusive, and consistent
with a separate 240-game screen showing six points the same way. Shipped on that
basis, with the confidence stated rather than rounded up. It is the lever the
difficulty comment already argued for: the same revenue line for everyone, so a
thin-margin world punishes a badly-run network without making a well-run one
impossible. The ladder stays properly spaced — easy 1.08, medium 0.96, hard 0.90.

Final: easy 98%, **medium 34%**, hard 9%, determinism identical. Medium's day in
full: 48% -> 53% (the Territorial, which is deliberately not the strongest strategy)
-> 40% (entryPace and contestPressure) -> 34%.

**A test caught the change and was right to.** "Leaves a neutral personality alone"
failed at 288,000 against 300,000 — exactly 0.96. Not a bug: `effectiveConfig` scales
the commit bar by yield deliberately, because an absolute dollar bar in a thinner
world makes rivals PASSIVE in the setting meant to make them fierce. The test had
been passing only because medium's yield happened to be 1.0, so alongside its real
claim it was quietly asserting "this difficulty is identity on every axis". Now it
compares against the yield-scaled value and keeps `maxSectorKm`, which yield does not
touch, as the straight identity check.

**Method note, since it cost the most.** Two tunings were nearly shipped on 240-game
samples that turned out to be noise. The standard that held: 240 games to FIND a
candidate, 480 an arm to BELIEVE it, and a standard-error test printed by the script
rather than eyeballed — the eyeballing was wrong twice.

### Looting a book-insolvent subsidiary is free — open 2026-08-06

Surfaced by the medium tuning, which moved the board enough that a holding-company
test picked a different carrier and failed: `expected 70000000 to be less than
63000000` — a direct pull that cost its owner nothing.

Not a regression. `standaloneEquity` floors the book term at zero,
`max(0, cash + fleet - debt) + franchise`. A carrier whose debts exceed its assets
therefore has no book value left to lose, so taking its cash does not move its
equity, so the owner's holding does not fall. Measured on the fixture that failed:
Harrier Airways, $47M cash against $751M of debt, standalone equity $1,148M — and
still $1,148M after $200M is added. The whole value is franchise.

**Arguably correct, and incomplete.** A company whose liabilities exceed its assets
genuinely has zero equity; its shareholders are already wiped out. The harm from
stripping its cash falls on CREDITORS, and this model has no creditor claim on
anything — debt is a number that charges interest, not a party with standing. So the
cost shows up nowhere.

Left open rather than patched, because the honest fix is creditor priority — debt
having a claim on assets ahead of shareholders — and that reaches into bankruptcy,
Chapter 11, acquisitions and the credit rating. A local hack in `TRANSFER_CASH`
would hide the gap without closing it.

The test now constructs a solvent subsidiary rather than taking whichever one the
fixture found, which is the lesson worth keeping: a test that means to check a
pricing rule should build the case it is about, or a change somewhere else decides
what it measures.

### A fifth archetype, wildcards in the deck, and a harder medium — 2026-08-06

Player report: rivals are too predictable, medium is a bit too easy, and could they
be more monopoly-minded, like the board game.

**Predictability was NOT what it looked like.** The first guess was that the cast
clumps — one seed had dealt six legacy carriers out of eight. Measured over 400
casts the spread is even (flag 27%, legacy 25%, rollup 25%, ulcc 23%) and only 1% of
games hold fewer than three archetypes. That seed was an outlier. Per-carrier
personality is wide too: aggression rolls 0.9-1.7, gauge +/-0.5, thrift 0.7-1.4. So
the sameness is not variance, it is SHAPE — four templates, and jitter on knobs does
not change what a carrier is trying to do.

**A fifth shape: the Territorial.** It collects a hub the way the board game
collects a colour group — takes sectors out of its own city at margins the others
walk away from (`cornerPull`), contests anyone who lands there (`cornerDefence`),
and once it holds most of the place, stops matching and charges premium
(`cornerRentThreshold`). The field measured over 14 games to the horizon:

| archetype | network on its hub | hub dominance | premium at home |
|---|---|---|---|
| flag | 82% | 95% | 17% |
| legacy | 70% | 43% | 8% |
| **Territorial** | 53% | **68%** | **61%** |
| rollup | 0% | 0% | 0% |
| ulcc | 4% | 14% | 0% |

**A design error caught by measuring rather than reasoning.** The first version had
`fortressHub: true`, which restricts origins to the home city — so every candidate
sector was on-patch by definition, and the hub preference collapsed into a flat
willingness multiplier. It made the carrier keener, not territorial, and measured
56% hub dominance against legacy's 54%. It has to be able to look elsewhere for
preferring its own city to mean anything.

**Wildcards, without breaking the no-code-per-event rule.** Duration was always
rolled and the SIZE never was, so a card played identically every time and a player
who had met it once knew what it cost. Any card may now declare `effectRange`, and
two new ones keep their whole bite there: Market turmoil and Labour unrest. Measured
over 80 games, turmoil's fuel effect landed anywhere from 0.81 to 1.45 across 81
appearances, and its demand effect straddles 1 — sometimes the turmoil is other
people's.

**Medium: predation was the obvious lever and it is the wrong one.** Turning it on
moved survival 53% -> 58% — the WRONG WAY. A field that undercuts itself grinds its
own margins down over a hundred quarters, and the player is under no obligation to
join in. It stays right for hard, where it is what makes meeting a rival on your
route frightening; it is simply not a difficulty knob. Two sweeps and about 2,400
games to establish that, which is the price of not guessing.

**What did work, and it is superadditive:**

| entryPace | contestPressure | survival |
|---|---|---|
| 1 | 0.55 | 53% |
| 1.4 | 0.55 | 49% |
| 1 | 0.9 | 51% |
| **1.4** | **0.9** | **40%** |

Both moved, because either alone buys four points and the pair buys thirteen:
rivals arriving sooner is only pressure if meeting one hurts, and competition biting
harder only matters once somebody has arrived to do it.

**Note that the Territorial itself cost 5 points of difficulty** (48% -> 53%) before
any of this, because it is deliberately not the strongest strategy and every one
dealt into the cast is a slightly weaker opponent. The tuning above pays that back
and more. If it ever needs revisiting, the better fix is a monopolist that genuinely
profits from owning its city rather than one that pays over the odds — that would be
a stronger archetype AND a harder game, instead of trading one against the other.

**Two of the suite's own guards fired and were right both times:** the subsidiary
fixture went inert when a fifth archetype changed those seeds (widened to six seeds
rather than lowering the bar), and the card validator rejected an empty `effects`
block (taught it about ranges instead of loosening it).

### Your own holdings were filed under someone else's name — 2026-08-06

Player report, straight after the picker fix: "the Held by column isn't showing the
shares my company owns." Correct, and the two columns between them managed to hide a
position the player had just paid for.

Both were written when "not you" and "a rival" were the same thing, which they
stopped being the moment carriers could hold each other:

- **Your stake** read the DIRECT holding only, so a company bought by a subsidiary
  showed 0% — for a position you had bought a minute earlier.
- **Held by** showed the largest holder that was not you, which now included your own
  subsidiaries. Your holdings appeared under the name of the company that made them,
  beside genuine raiders, with nothing to tell the two apart.

**Fixed both ways round.** Your stake is now `economicInterest` — the stakes
multiplied along the chain, so 60% of a carrier holding 30% of another reads as 18%,
which is what you would actually receive. Held by excludes anything you command,
because it is not held by someone else. The direct figure still governs the Sell
button: you can only sell shares in your own name.

A tooltip states the composition whenever the stake is not all held directly —
"18% of Halyard Group is yours once the chain is counted: Nimbus Air 30% — held by a
carrier you command". A single percentage that silently sums a direct holding and
three subsidiaries' is worse than no number, because nothing on screen can check it.

**Verified with an independent holder in the same market**, which is the check that
matters: the filter has to be narrow enough that a genuine rival still appears.
Halyard Group reads stake 18%, held by "Orcadia 22%" — yours counted as yours,
theirs still visible as theirs.

### The invest picker only offered four companies — 2026-08-06

Player report: "why does the invest modal only give the option to buy stock in three
companies? Shouldn't I have the ability to invest in any company?" Yes. It was
`targets.slice(0, 4)` — an arbitrary cap I wrote to keep a stacked-button dialog
short, against a field of up to eleven carriers, and the four were taken in roster
order rather than by any merit. Most of the board was simply unreachable, silently.

**Fixed by turning the flow around rather than lengthening the list.** The treasury
table already has a row for every live carrier, so the targets were never the thing
that needed a picker. Now `Buy` on any row asks WHO PAYS — you, or any carrier you
command that could fund it — which puts the short list in the dialog and leaves the
long list in the table where it already was. The "Invest" button is gone entirely,
and the row is simpler for it.

Two properties worth keeping:

- **No extra click in the common case.** With nothing commanded there is only one
  possible buyer, so no dialog appears and the flow is exactly what it was before
  any holding-company work existed. Verified in the browser: picker shown 0 times.
- **Every carrier is reachable by construction**, not by a cap being large enough.
  That is the difference between fixing this and raising the number to eleven.

**A near miss worth recording.** Deleting the dead `directInvestment` method by
slicing from its comment to the next method would have taken `chooseBuyer` with it —
the new method sits between them, and the range was 4,496 characters where the
method is 2,453. A length assertion on the block caught it before anything was
written. Bounding a text-range edit by an expected size is cheap and it works;
without it this would have compiled (the button referencing it was being removed in
the same pass) and shipped a treasury with no buyer picker at all.

### An equity issue prices by how big it is — 2026-08-05

Player question: "I get a lot of money and my company becomes worth a lot more. Is
that how it works in the real world?" — and then the sharper follow-up: "the market
cap only goes up if somebody buys the shares at the current price. Doesn't the price
usually go down when new stock is issued?"

**Two thirds of it was already right, and worth stating before the fix.** Market cap
rose by exactly the cash raised, which is correct: the company is worth more because
it HAS more, cash being an asset. And the price did fall. Existing holders were
diluted — a 10% stake went from $12.00M to $11.82M — so no value was created; it
came from whoever bought the new shares. Nor is it a route to victory: a player who
does nothing but issue to the ceiling for 100 turns manages three raises totalling
$74M against the charter ceiling, finishes at $194M, and loses to a rival worth
$20.4bn.

**What was wrong is the second question exactly.** The clearing discount was a flat
7% whatever the size, so the price move came only from dilution arithmetic:

| raise | before | after |
|---|---|---|
| 1% of cap | -0.07% | -0.04% |
| 5% | -0.36% | -0.30% |
| 10% | -0.68% | -0.89% |
| **25%** | **-1.48%** | **-4.21%** |

A raise of a quarter of the whole company is a rights issue, and one that moves the
share price 1.5% is not one anybody has to think about. The discount now widens with
the size of the raise — 3% on a top-up, ~18% below market at a quarter of the company
— because somebody has to buy every share and a large block only clears if it is
priced to move. Floored, so an enormous ask against a small cap cannot price at
nothing and mint unbounded shares.

**The ceiling had to be solved rather than computed.** How much cash a block of
shares raises now depends on the discount, and the discount depends on the raise, so
`equityRaiseCeiling` runs a short fixed point. It converges immediately, and it has
to be exact: the treasury quotes that figure as its maximum, and a loose solve
reproduces the "dialog promises what the engine refuses" bug fixed earlier the same
day. Pinned by a test that asks for the ceiling and requires it to be honoured.

**Balance: 114/240 (48%) against 109/240** — five games, and in the *easier*
direction, because `maybeDefend` funds its takeover defence by issuing equity and
that defence is now dearer for rivals too. Within noise at this sample, and left
alone.

**What is still not modelled, and is the honest remainder of the player's question.**
There is no signalling effect: in life the announcement of an issue moves the price
on its own, because raising equity tells the market something about what management
thinks the shares are worth. Here an issue is a pure arithmetic event. Worth having
eventually; it is a different mechanism from size-pricing rather than more of it.

### Dividends received are taxed by how much you own — 2026-08-05

The last hole in the holding-company layer, and the one that mattered most: cash
cascading up a chain leaked to minority holders but not a cent to tax, so depth was
economically free. Verified before building rather than assumed — `tax` is computed
on the operating quarter in economics.ts, and `dividendIncome` was folded into
`netIncome` in engine.ts *afterwards*, so a receipt was never taxed at all.

**The dividends-received deduction, at its real thresholds.** Below 20% a holder is
a minority investor and half the receipt is taxable; from 20% it is an affiliate and
35% is; at 80% a group files as one company and nothing is. Those numbers are used
unchanged because the 80% line is precisely what a 51% controller cannot reach — it
is the mechanism economists credit with ending the American pyramid ahead of any
prohibition. The structure was not so much banned as taxed at every layer.

Measured through the engine, effective rate on a receipt:

| owned | effective tax |
|---|---|
| 50% | 8.8% |
| 51% | 8.8% |
| 79% | 8.7% |
| **80%** | **0%** |
| 95% | 0% |

Which is the decision it buys: control costs half a company, not leaking costs four
fifths, and a deep chain held at the cheap end pays for its depth every time it
moves money. It also reinforces the rule shipped hours earlier — cash may only move
along edges you own outright — by making the legal route up a chain leaky as well as
slow.

**Booked gross, taxed on the tax line.** `dividendIncome` stays the gross receipt
and the tax joins `tax`, so the quarter still reads
`revenue - costs - interest - tax + dividends`. Netting it off the income line
instead would have silently broken an identity the settlement harness checks every
turn — 0 breaks in 2,019 quarters after the change.

**A pre-existing test caught it immediately**, which is the system working: one
asserting a holder receives `0.4 x 0.5 x netIncome` failed the moment receipts
started being taxed, 658,730 against an expected 721,896 — exactly the 8.75% of the
affiliate band. Updated rather than relaxed.

**A fixture lesson worth recording.** The first attempt measured the bands by
varying the player's stake in a live game, and the sub-20% rows reported no dividend
at all. Not the tax: the payer had LOST money that quarter, because the player's
holdings feed the AI's decisions, so changing the stake changed how the rival
played. A game fixture cannot isolate an ownership band on demand. The bands are now
tested against the engine with a hand-built payer that is definitely in profit.

**Balance: 109/240 (45%) against a 110/240 control** — one game in two hundred and
forty, determinism identical. Rivals hold stakes in each other rarely enough that
taxing the receipts barely reaches them; this is a mechanic aimed at a player
running a chain.

### The pyramid gets closed off, and the AI gets to build one — 2026-08-05

Three follow-ons to the holding-company work, and a correction to a figure that has
been quoted all day.

**Cash now moves only along edges you own outright.** Command follows the chain,
cash does not. The reason is arithmetic: a stake is valued at the target's
STANDALONE worth, which excludes what that target itself holds, so a stake in A was
priced without A's stake in B — B's value never reached the books, and draining it
cost nothing. Measured before the fix: $70M pulled from a direct subsidiary moved
equity **+$28M** (correctly surrendering the owner's own 60%); the same pull from a
grandchild moved it **+$70M**, free and repeatable every quarter. The restriction
also says something true — a pyramid buys control cheaply and extracting the cash is
the hard part, which is why the real ones ran on dividends, management fees and
related-party deals, and why regulators watch those rather than the org chart.

**Merger review counts effective control.** The floor counted solvent carriers,
which is the same thing only while consolidation happens by merger. A pyramid never
merges, so it would never trip a review. It now counts independent groups — carriers
nobody else commands.

**The AI can spend the treasuries it commands**, and getting that to actually run
took three placements, two of which were correct code that could never execute:

- `maybeTakeStake` returns immediately for acquisitive carriers and caps everyone
  else at 40%, below the control line. Nothing that reaches it can ever hold a
  subsidiary. Measured: 0 directed purchases.
- `maybeAcquire` returns early once the field is at the antitrust floor — which is
  precisely the situation in which subsidiaries persist. Also 0.
- Its own step in `decideRival`, outside the merger review, because buying shares is
  not a merger. **246 directed purchases across 20 games**, subsidiaries live in 828
  carrier-quarters, present in all 20.

A test that only asserted "nothing broke" would have passed for all three. The one
in rivals.test.ts asserts the capability fires AND that subsidiaries existed to fire
it on, so an inert fixture fails loudly rather than silently.

**Balance: the capability is neutral, measured properly.** Same six seed bases, with
and without the new step: **110/240 (46%) against 112/240 (47%)** — two games in two
hundred and forty.

**And the correction.** Medium has been quoted at 51-52% all day. That came from 120
games on one seed set. Across 240 games spanning six bases it is **46-47%, and always
was** — the tuning seeds are a mild sample. This is the same error as the hard-mode
"2.5%" corrected earlier in this log, and it is now the second time a rate has been
quoted from too narrow a sample: 120 games is the floor for detecting a change, not
for stating a level. Nothing was re-tuned on the back of this, because the number
moved and the game did not — but the figure to carry forward is 46-47%.

**Still open.** Multi-level AI pyramids remain theoretical: rivals hold single
subsidiaries readily but merge rather than stack, so a house commanding two carriers
at once was seen 0 times in 20 games. That is defensible behaviour rather than a
broken feature, but it means the deep-chain mechanics are exercised by the player
and by tests, not by the field. An earlier note in this log framed that as "0
pyramids, the feature is inert", which was too strong — the metric required a house
commanding two carriers, and single subsidiaries are everywhere.

### Holding-company powers: a stake you control is a treasury you command — 2026-08-05

From a player question about Railroad Tycoon. The RT1 mechanic is real and better
documented than expected: the era strategy guides describe completing a takeover,
selling down to 40%, "looting any cash from the subsidiary's treasury", letting the
price collapse and repurchasing cheaply — and funding the subsidiary in the other
direction later, because "subsidiaries will not build track when they do not have
enough funds". Whether RT1's UI allowed the further step of pointing a subsidiary's
treasury at a THIRD company could not be confirmed. The aviation anchor is stronger
than the game one either way: UATC and AVCO were pyramid holding companies until the
1934 Air Mail Act broke them up, and IAG (BA, Iberia, Vueling, Aer Lingus) and
Lufthansa Group (SWISS, Austrian, Brussels) are the same structure rebuilt legally.

**Almost all of it was already here**, which is why this is small. `holdings` was
already carrier-to-carrier — there is no separate "personal" wealth layer in this
game, the player IS a carrier — so no cap-table refactor was needed. `BUY_SHARES`
already accepted an arbitrary buyer. `SET_DIVIDEND` already established "direct a
carrier you control" as a verb. And `marketCap` was already deliberately
non-recursive, so cross-holdings cannot spiral the valuation.

**What was added.** `controlledBy` / `commands` / `economicInterest` in market.ts —
control follows a chain, and the economic slice multiplies along it, so 51% of A
and A's 51% of B is COMMAND of B on 26% of the exposure. Two actions:
`DIRECT_BUY_SHARES` (a carrier you command buys with its own money) and
`TRANSFER_CASH` (cash moves between you and it, either way). Schema 16.

**Deliberately separate actions rather than flags on the existing ones**, because
the engine validates state and not callers: naming the controller makes the
permission a checkable fact (`commands(controller, buyer)`) and leaves the plain
`BUY_SHARES` path the AI uses for itself completely untouched.

**Looting needed bounding, not balancing.** The economics already price it with no
special rule: cash sits in `standaloneEquity`, so pulling a dollar out of a
subsidiary drops its equity by a dollar and your holding by your share of that. You
keep the dollar and the minority holders eat their fraction — which is exactly the
historical trick, correctly modelled. It needs only a floor (the subsidiary keeps
enough to keep flying, or the mechanic becomes a way of deleting rivals rather than
financing yourself) and a per-quarter cap (or the whole treasury moves on the turn
control lands and there is no ongoing decision).

**Two cycle guards, for two different cycles.** `controlledBy` carries a visited set
because A-holds-B-holds-A is reachable and an unguarded walk never returns;
`economicInterest` terminates because a stake is a fraction, so going round a ring
strictly shrinks the number. Neither of these is the thing `marketCap`'s
non-recursion protects against — that one is about valuation spiralling, these are
about the walk terminating. Conflating them is easy and would have shipped a hang.

**A bug the feature introduced, found by exercising it in the browser.** The invest
dialog offers the player's own stock as a target, which is legitimate — parking your
shares in a subsidiary takes them off the float where a raider could reach them. But
the hostile-takeover loss condition fires on any non-player carrier holding a
majority, and a subsidiary is a non-player carrier. So directing your own company to
buy your own stock ended the game with "your rival took you over", the rival being a
company you owned. Guarded with `!commands(next, player, c)`, and pinned by a test
on BOTH sides: your subsidiary cannot take you over, an independent carrier still
can. Unreachable before this feature, which is why it had never surfaced.

**Balance is untouched and that was checked, not assumed:** medium 19/40, 19/40,
23/40 across three seed bases, byte-identical to before the work, determinism
identical. The powers are player-only and opt-in, and the AI does not use them —
which is the open question, not an oversight. If the player can command a treasury
at 26% exposure and rivals cannot, the acquisition victory gets cheaper; `maybeDefend`
is no answer either, since its only move is dilution and it gives up once a raider
is past the control threshold. Measured first: today no AI carrier ever controls two
others without merging (max group size 1 over 20 games), because it merges as soon
as it can — so there is no hidden consolidation to fix, but also no rival that would
ever build a pyramid back at you.

### A new-game screen, because the board opened with no explanation — 2026-08-05

The game used to begin with an empty board, two radio fieldsets tucked into the
schedule panel, and a line reading "click a city on the map to set up your home
base". Nothing anywhere said what the game was, who the player was, or how it
ended, and the first decision — where to base an airline — was taken by clicking
one of about two hundred identical dots. Pillar 3 asks for a first turn playable
in two minutes without a tutorial; that is not the same as no explanation at all.

**What the screen states**, because these are the things the rest of the interface
assumes you already know: the job is fleet, network, pricing and debt and nothing
below the C-suite; a turn is one quarter and nothing is timed; you win by being the
most valuable carrier at the horizon or by seeing off every rival; you lose to
bankruptcy or to a controlling stake. The win and lose text was taken from the
actual strings in `concludeTurn` rather than written from memory of the pillars.

**Ten home bases instead of two hundred.** The sim still starts from any city —
this is a UI shortlist, not a rule — but "anywhere" is not a decision a new player
can make, because every dot looks the same until you know what the demand model
does with it. They are chosen to PLAY differently rather than to be the ten
biggest, and each note quotes measured figures:

| base | short-haul markets | short-haul share | rivals reaching it |
|---|---|---|---|
| London | 63 | 53% | 4.0 |
| Istanbul | 78 | 54% | 1.2 |
| Frankfurt | 65 | 57% | 1.7 |
| Tokyo | 34 | 46% | 6.8 |
| New York | 43 | 44% | 4.7 |
| Delhi | 64 | 50% | 0.9 |
| Cairo | 86 | 56% | 0.3 |
| Dubai | 63 | 41% | 0.5 |
| Sao Paulo | 17 | 24% | 0.8 |
| Sydney | 10 | 11% | 0.0 |

The spread that matters is the first column: Cairo touches 86 markets inside
narrowbody reach and Sydney touches ten, so one game is a dense feeder network and
the other is long thin sectors and the aircraft that can fly them. Rival pressure
was measured over twelve games to the horizon, not guessed — the claim that Tokyo
is the most contested base was checked before it was written down, and it is
(6.8 carriers against London's 4.0).

**Every figure in those notes was verified against `demand.ts` before shipping.**
That is worth recording as the standard: a note that says "63 markets" is a factual
claim the model has to back, and the alternative — plausible-sounding copy — is how
a player ends up making a decision on a number nobody checked.

**The map is no longer a chooser.** Clicking an empty board re-opens the screen
rather than quietly starting a game on whichever dot was under the cursor, and
Escape does not dismiss it, because there is nothing behind it to do.

### A station is a standing cost, not a cheque you write once — 2026-08-04

The follow-on to the entry below, after the player looked at $6.9M to open a sector
and asked, reasonably, whether that was right. It was not, and the shape was wrong
as well as the size.

**Why a one-off was the wrong instrument.** It is a sunk cost the instant it is
paid. It can deter an opening; it exerts no pressure afterwards, so a carrier
holding forty thin stations feels nothing for holding them. It was also charging
base prices for what is usually just a destination — outsourced handling and a
station manager — when the genuinely expensive thing in life is a crewed base.

**Split into the two costs a station actually has:**

| | before | after |
|---|---|---|
| opening (base) | $900K | $900K |
| per new station, one-off | $6.0M | $1.5M |
| per sector per quarter | $150K | $60K |
| per STATION per quarter | — | **$600K**, divided among the sectors using it |

Most of what `quarterlyFixedCost` used to stand for was station overhead charged
per sector, which is why forty single-sector stations cost the same per sector as
a hub running six through one. Now a station carrying six sectors charges each a
sixth, and the allocation is exact: a carrier pays `stationQuarterlyCost` once per
station however its sectors are arranged. Pinned by tests over hub-and-spoke, line,
scattered and triangle shapes, and checked over real networks in 24 games. The one
exception is stated in the code and worth repeating: only a sector with an aircraft
on it is charged, so dormant sectors under-pay. An earlier draft of that comment
claimed the identity held unconditionally, which was wrong.

**It worked, and the decision mix is the proof** — this is the number the whole
exercise was aimed at:

| AI growth move | before | after |
|---|---|---|
| open a new sector | 42% | 38% |
| **add an aircraft to one it flies** | **31%** | **45%** |
| raid a rival's market | 27% | 18% |

Reinforcement is now what a rival most often does. Network shape, measured from
where this started: single-frame sectors **69% -> 50%**, aircraft per sector
**1.44 -> 1.98**, sectors per station **1.46 -> 1.77**.

**The raid share fell, and that needed checking** rather than accepting — raids are
pillar 4, the mechanism by which success attracts sharks. Competition did not get
quieter: contested markets went **15.2% -> 18.0%**, because carriers concentrating
on fewer stations overlap each other more. The lower raid rate is more than paid
for by the denser networks colliding.

**Balance needed no compensation at all**, which was the surprise. Medium sits at
51% with `rivalCapital` left where the previous entry put it, and 2.0 measures the
same. An ongoing charge is far more balance-neutral than a one-off: the player pays
it every quarter too, where the one-off mostly drained the rivals' expansion capital
and quietly handed the player an easier game. Final ladder over three seed bases:
easy 98%, medium 51%, hard 12%, determinism byte-identical.

**The early game was checked directly**, since $1.26M a quarter on a first sector
carrying both its stations alone is a large change from a flat $150K. A first route
out of London nets $2.15M-$3.34M a quarter after it, and **no game in thirty failed
inside three years**. Station cost is about 9% of a first sector's revenue.

**Performance, found by profiling and fixed.** `stationOverheadFor` measured 4.3%
of a headless game, because `appraise` recomputed it inside the posture and
aircraft-type loops where it cannot vary. Hoisted into the three search loops:
558 -> 502 ms a game, verified behaviour-neutral by the survival counts returning
byte-identical (19/40, 19/40, 23/40).

**A bad measurement caught on the way**, recorded because it is the second time this
exact mistake has been made in this codebase. The first attempt to price those scans
stubbed them out and timed the result — which came back SLOWER, 928ms against 554ms,
because zeroing a cost changes the game rather than the work: richer carriers open
more routes and there is more to do. Timing two different games and calling the
difference a performance number is the same error as the repricing-pass claim
recorded earlier. Use the profiler.

**A sweep for the same class, after the player asked for one.** Two of the four
things it turned up were live bugs; the other two were correct-but-fragile
duplications that got removed anyway.

*Found and fixed:*

- **`marketBoard` and `technologyValue`** — the two call sites inside economics.ts
  itself, missed because the original sweep grepped the files that IMPORT from it.
- **`finalLoadFactor` in headless.ts** priced every player sector with no rivals, no
  rival capacity and no hub feed, so the player won the whole market on every route
  and the reported figure was a monopolist's load factor. Analysis-only — no
  gameplay moved — but it is read straight out of `GameSummary` when balance is
  being judged, and a flattering number is worse than a missing one. Measured on the
  same games (valid here precisely because the statistic does not feed back):
  **84.6% -> 78.5%** for surviving players. Several load figures quoted earlier in
  this session were overstated by about six points.
- **The stake-purchase dialog** offered the full quarterly allowance even after part
  of it had been spent. `BUY_SHARES` truncates rather than refusing, so the player
  set an amount, fewer shares arrived, and nothing said so.

*Checked and sound:* `freeFloat` matches the engine's `buyable`; repayment matches
`min(debt, cash)`; the dividend ceiling is the same constant; selling a whole stake
is honoured exactly; `scheduledTrips` and `gaugeOf` compute quantities
`RouteEconomics` does not expose, using the sim's own primitives rather than
restating formulas.

*Structural fix, so this class stops recurring.* Two ceilings that the treasury
panel had been working out for itself now live in market.ts as
`stakePurchaseCeiling` and `equityRaiseCeiling`, and `ISSUE_EQUITY` was changed to
call the shared one rather than keep its own copy. Both are pinned by tests that
require the ceiling to be EXACT — asking for it delivers it, asking for more never
delivers more — because an upper bound the engine merely respects is not the same
promise as the one a dialog makes when it disables its button.

**A second one from the same session, same root cause.** The market figure on the
prospect panel disagreed with the one the sector showed the instant it opened. Two
compounding errors, both from restating a sim formula in the UI instead of asking
the sim: `marketDemandWeekly` is ONE-WAY where `RouteEconomics` quotes both
directions, and it is the raw gravity figure before the difficulty and event demand
multipliers. The panel a player uses to decide whether to open a sector was
understating its market by about half.

Fixed by pricing an empty prospective route through `computeRouteEconomics` and
reading the number back, so it cannot drift from the dossier's — it IS the dossier's.
The formatting was matched too (same locale, same `/wk` suffix): two figures that
sit side by side in a player's head read as different quantities when one says
"63,778/wk" and the other "63778 pax/wk", even once the arithmetic agrees.

The pattern behind both bugs is the same and worth stating once: **the UI must not
recompute what the sim computes.** Every panel that wants a figure should obtain it
from the same function the quarter settles on, even when the formula looks trivial
enough to inline. Both of these were one-line "obvious" restatements.

**A bug this change introduced, found by the player within an hour.** The sector
header read $4.1M and the "on this market" table read $5.0M for the same route. The
table comes from `marketBoard`, which prices every carrier on a market through its
own pair of `computeRouteEconomics` calls — and it was never given the station
share, so its net omitted the station line and the overhead riding on it.

The reason it was missed is worth more than the fix. The sweep for call sites
grepped for `feedFactor(` across the files that IMPORT from economics.ts, on the
assumption that anything pricing a route passes the feed factor. `marketBoard` and
`technologyValue` live INSIDE economics.ts and never showed up. A new optional
parameter fails silently at every site that does not pass it, so "I updated all the
call sites" is a claim that needs `grep computeRouteEconomics(` over the whole tree
including the defining module — not a proxy search over its dependents.

Fixed at both sites (`technologyValue` prices each sector twice and the station
share cancels, so its answer never moved; passed anyway rather than leave one call
site inconsistent). Pinned by a test that prices every live sector through the
dossier path and the `marketBoard` path and requires them to agree — verified to
fail against the broken code with the same size of gap the player saw, rather than
merely passing after the fix.

**One pre-existing bug fixed in passing.** `briefing.ts` computed its "X-Y lost $N
this quarter" alert without `feedFactor`, so the figure it put in front of the
player disagreed with the sector dossier for the same route. Unrelated to this work;
found because the new parameter had to be threaded through the same call.

### Opening a sector costs what opening a sector costs — 2026-08-04

Player report: *"There are costs to opening new routes. How in the world would it
make sense to open a new route instead of add another plane to an existing one?"*
Correct, and there were three separate things wrong.

**1. The AI never paid to open.** `bestNewSector` scored a candidate as
`appraise(...)` — the sector's gross quarterly cash — while `bestReinforcement`
scored another aeroplane as a *marginal* gain over the sector's existing baseline.
The one-off opening fee entered neither. So breadth was ranked against depth with
its principal cost omitted, and won on an accounting artefact rather than on
economics. Both `bestNewSector` and `bestIncursion` now subtract the opening cost
amortised over the same appraisal horizon, which puts it in the units everything
else is ranked in: dollars per quarter. This also explains why simply raising
`openingCost` would have achieved nothing — a number no decision reads cannot
change a decision, it can only drain cash the carrier then fails to spend.

**2. Opening was flat, and trivial.** $900k against a sector earning $5.73M a
quarter pays back inside six weeks, and it cost the same whether the carrier
already served both cities or neither. Nothing in the model distinguished hanging
a sector off an existing station from opening in fresh territory — so there was no
reason to build a hub, and rivals grew by scattering single aircraft over virgin
markets. `openingCostFor` now charges `newStationCost` per endpoint the carrier
does not already serve. Its home base always counts as served, or the first sector
of a game would cost double for a reason no player could follow.

**3. Spill is still free.** Under-capacity costs nothing because spilled passengers
evaporate rather than booking a rival, so depth has no urgency. Untouched — see
"Spilled passengers vanish instead of rebooking", still the biggest open distortion
in the model, and still the one that would change which option *wins* rather than
merely what it costs.

**Measured**, 20 games to the horizon on medium, sweeping the station cost:

| newStationCost | single-frame | tails/route | sectors/game | sectors/station |
|---|---|---|---|---|
| $0M | 58% | 1.68 | 284 | 1.46 |
| **$6M** | **52%** | **1.83** | **246** | **1.72** |
| $12M | 47% | 1.99 | 227 | 1.90 |
| $20M | 38% | 2.32 | 179 | 1.86 |

Monotonic in every column that matters until $20M, where carriers can no longer
afford stations at all and networks shrink rather than thicken — sectors/station
turns over at $12M. $6M was taken as the point where the shape moves without the
field being starved, and it is the right order of magnitude for standing up a
mainline station. Note that is a plausibility check, not a fitted figure: it was
chosen for its effect on the board and should be re-tuned on evidence, not defended
as a published number.

**It also made medium easier, and that had to be paid for.** Rivals stand up
stations like everyone else, which left the field poorer (mean net worth $3.29B ->
$2.85B) and medium survival went **57% -> 68%** — measured against a same-seed
control, because the previously recorded 52% came from a different seed sample and
comparing across the two would have overstated the drift. Easy (98% -> 95%) and
hard (2.5% -> 3%) barely moved: at `rivalCapital` 0.8 the world is roomy enough not
to notice and at 3.2 the field is rich enough not to care, and medium's 1.0 was the
one setting tight enough for the new cost to bite. Compensated by raising medium's
`rivalCapital` to 1.6, which is a recalibration to the world the field now lives in
rather than a difficulty increase — it restores the game medium already was.

| medium config | survival |
|---|---|
| control, no station cost | 57% |
| station $6M, rivalCapital 1.0 | 68% |
| station $6M, rivalCapital 1.3 | 64% |
| **station $6M, rivalCapital 1.6** | **56%** |

**Two clicks stopped opening a route.** The map gesture committed capital without
ever showing a number, which was tolerable at $900k and indefensible at eight
figures. A second click now *proposes* a sector; the pane under the map states the
distance, the market, and the cost **itemised** — base fee, then a line per station
— and opening is a button. The itemisation is the point: a single total cannot
teach the rule that sectors hanging off cities you already serve are the cheap
ones. A confirm dialog was built first and thrown away; it was a patch on the bad
interaction rather than a fix for it.

**Verified across three independent seed bases** (1000/2000/3000), rather than the
one the value was chosen on:

| | easy | medium | hard |
|---|---|---|---|
| seed 1000 | 98% | 59% | 10% |
| seed 2000 | 95% | 56% | 3% |
| seed 3000 | 98% | 53% | 13% |
| **mean** | **97%** | **56%** | **9%** |

Medium lands at 56% against a 57% control: the compensation holds. Hard was
isolated separately, 120 games per config with the station cost on and off, and is
**unmoved** — 9.2% control against 8.3% with it, comfortably inside noise.

**A correction that came out of that run.** Hard had been quoted at "1/40, 2.5%"
repeatedly, including in the review pass above. That was a single 40-game sample at
seed base 2000, and the isolation run shows the same configuration returning 4/40
and 5/40 at the other two bases. Hard's actual survival is around 8-9%, not 2.5%.
Forty games is far too few to quote a rate that low to one significant figure — the
standard error there is about five points, which is most of the spread. Balance
claims about the tails of the difficulty range need 120 games as a floor, the way
the medium tuning already did.

Worth recording that the browser check caught what the unit tests could not: while
the panel was up, **zero routes existed**, which is the whole claim. It also caught
that the Playwright smoke had quietly stopped opening any player route at all —
still passing, still reporting a clean run, covering nothing. It presses the button
now.

### Two bugs from a logic-and-model review pass — 2026-08-04

A review sweep across state invariants, model relationships, the financial layer,
save round-tripping, content reachability and cross-layer consistency. Two real
bugs, both silent — neither could throw, and neither showed up in a played game as
anything but a slightly odd outcome.

**Acquisitions were priced ex-debt.** `mergeCarrier` does `acquirer.debt +=
target.debt`, but the affordability check weighed only the equity `cost`. A carrier
could therefore buy something it could not remotely fund and take the balance sheet
with it. Proven by construction before the fix: $300M of cash plus $360M of
borrowing capacity bought a company with a $0 market cap and assumed **$4.00B** of
debt. The check now weighs enterprise value:

```ts
const assumed = Math.max(0, target.debt);
const fundable = acquirer.cash + (withDebt ? borrowingCapacity(state, acquirer) : 0);
if (fundable < cost + assumed) { /* refuse */ }
```

The AI's own version of the test in `ai/archetype.ts` had the same hole and got the
same fix. This is why a distressed carrier is cheap to buy and expensive to own,
which is the correct shape for the roll-up archetype to be fragile.

**The player was assigned a manufacturer.** `conditionsFor` called
`preferredMaker(state.seed, carrier.id)` unconditionally, so the player carried the
same hidden 8% crew-and-maintenance surcharge on off-shop aircraft that rivals do.
Rival manufacturer preference exists to stop the field converging on one airframe
(see "Everyone flew the same aeroplane"); it is a personality given to an AI, and
the player does not have one. There is no UI anywhere that names the player's
"preferred" maker, so the penalty was strictly invisible — a fleet decision quietly
priced against a fact the player was never told. Now `carrier.isPlayer ? null : ...`.

The existing test called `makerCostMultiplier(type, null)` in isolation and so
never touched what `conditionsFor` actually passes. Replaced with an integration
test that prices a player route through the real conditions path.

**What the sweep cleared.** Byte-exact agreement between `probe` and the quarterly
settlement across 27,498 route-pricings, including the hub-feed factor, which the
two layers compute by different arithmetic — pinned now by a test in
`appraisal.test.ts`. `pruneLosers` and `retreat` cannot close a profitable sector
by construction (both require negative cash *and* a negative appraisal). Book value
never goes negative, never exceeds purchase price and never rises with age; leased
tails never carry any. Every event and technology effect names a key the conditions
layer actually reads, every technology prerequisite resolves, and the only two
zero-weight cards (sept11, covid) are reachable through the history script — all
now tested, because unreachable content fails silently and looks exactly like
content that works.

**Four findings were the harness, not the game**, and are recorded because each
looked convincing: `dividendIncome` omitted from a quarterly reconciliation; reorg
debt compared across a whole turn, in which a carrier may legitimately borrow;
`tech.requires` read as an array when it is a single id, so the check iterated
characters; and `weight: 0` read as broken content when it means "never drawn at
random". The censoring-excess tolerance was also too tight — the true figure is
0.0220% of mean demand at every scale, matching the closed form `k·φ(1/k) − Φ(−1/k)`.

Balance is unmoved: medium 63/120 survival (52%, exactly as tuned), easy 39/40,
hard 1/40, determinism byte-identical on both settings. 464 tests.

### Medium turned up, using the one lever that makes rivals the difficulty — 2026-08-04

Medium had drifted easy: **64% survival across 120 fixture games** against the ~50%
it was tuned for, and it was being beaten consistently.

Most of medium's knobs are deliberately 1.0 — that is what makes it the baseline
the other two levels multiply against, and a test pins it. The two that are not are
`contestPressure` and `predation`, so those were the honest places to turn.

**`predation` was tried first and made medium EASIER** — 70% to 75%. Worth
recording, because it is counter-intuitive and the opposite of what it was reached
for: a rival that surrenders margin to price underneath you damages itself more
than it damages you. It is a good lever for making hard feel vicious and a bad one
for making anything harder.

**`contestPressure` 0.22 → 0.55.** It scales the competition load penalty, so it
makes RIVALS the difficulty rather than taxing the player — pillar 4 — and it only
bites on the ~20% of markets that are actually contested, so an uncontested network
is untouched and the change is felt exactly where competition is. Easy (0.15) and
hard (1.6) are unchanged; medium was much nearer easy than the gap to hard
suggested it should be.

| | survival | by seed base |
|---|---|---|
| 0.22 | 64% | 16, 10, 13, 14, 12, 12 |
| **0.55** | **52%** | 12, 12, 11, 10, 9, 9 |

Every seed base at or below baseline, and the spread tightened. Variety holds on
all six bases (0.86–1.31 against a 0.35 floor).

**A measurement note.** A first sweep at 60 games per config read 0.22 → 70%,
0.40 → 63%, 0.45 → 80%, 0.55 → 51% — non-monotonic, because the fixture's survival
swings about ten points on sample alone at that size. Picking 0.45 from it would
have shipped a value my own numbers called easier than baseline. The decision needed
120 games per config before the signal separated from the noise.

### A majority stake ends the game now, grace or no grace — 2026-08-03

A playtest: "Bantam raised its stake in you to 53%" — and the game carried on. The
`acquisitive` gate had already been removed from this loss condition; what was
left was the early-game grace, and it applied to both takeover paths. Before turn
32 — eight years — a rival could hold 53% of the player and nothing happened.

The two paths are not the same thing and should not share a grace. Being seized
because your share price cratered is something that happens TO a young carrier,
and that one keeps its protection. Somebody buying a MAJORITY is not bad luck: the
per-quarter cap means it takes at least six quarters, every one of them is reported
in the briefing from 10% upward and in danger tone past 40%, and there are three
answers — buy the block back, issue equity and dilute them, or lift the price out
of reach. Graced, it produced the worst outcome available: the interface warning
that a controlling stake *would* let a rival take you over, while it already had
one.

**Measured with the stub AI actually playing**, 60 games per difficulty: medium is
untouched (5 seizures, all at turn 38 or later, none newly possible); hard gains 6,
all at turns 20–26, which were previously suppressed until 32 and would mostly have
landed there anyway.

The warning copy escalates within ten points of the line: *"Bantam holds 47% of you
and is 3% from a majority — at which point it owns your airline and the game ends."*
One sentence used to cover every stake from a tenth to a majority.

**Two bad measurements on the way, both mine.** The first read `r.gameOverTurn`,
which does not exist on the result type — so "0 before turn 32" was structurally
guaranteed and meant nothing. The second dropped `runGames` for a hand-rolled loop
in which the player took no actions at all, and a carrier that never buys an
aircraft is not a target anyone raids; it reported 0 seizures out of 120. The
honest number needed the stub AI playing and the player's own `bankruptTurn`, which
is set by the merge and so IS the seizure turn.

### Picking one sector out, and the entrant nobody could see — 2026-08-03

**A sector in a carrier's route list is now a control.** Clicking it holds that
one arc out from everything else — full opacity, a heavy stroke, and the dash
dropped so a not-yet-flying sector still reads clearly when it is the one asked
for. Deliberately louder than the carrier focus it sits inside: that lights a
whole network so its shape can be read, this answers "which of those lines is
TYO–HKG". The list stays put, so a network can be stepped through.

Arcs carry `data-route` as well as `data-carrier`, because a sector crossing the
antimeridian is drawn as several paths and picking it out has to mark all of them.
The pick lives in the map selection like the carrier pin, and one guard in
`render` drops it whenever the list it came from is off screen — rather than a
clear at each of the ten places selection changes, which is exactly how an arc
ends up lit with nothing on screen explaining why.

**And the sector panel was hiding entrants.** A rival that has opened a market but
has no delivered metal on it takes no share, so it is correctly absent from the
share table — but the panel then said "You have it to yourself" while the map drew
their announced sector as a dashed line, which is a flat contradiction of
something the player can see. Measured at **3.46% of route-quarters**: 622 cases of
metal on order, 187 of a sector opened and never filled.

The panel now names them separately from the carriers actually competing, because
they are a different fact: *"Meridian Airways has opened this market and is not
flying it yet."* Entry is the earliest warning there is. It appears on a contested
market too — a third carrier can be on its way in while two are already fighting.

**Layout:** the contested count now sits before the valuation in the sidebar, on
the grounds that "3 of yours" is the thing that changes what you do this quarter
and the money is context for it. The value took a fixed right-aligned column at
the same time, or the figures ragged as the count between them changed width.

**Sorted biggest first, with the failed always last.** The list was in the order
rivals entered the game, which is meaningless by year five — it is read to answer
"who is the threat", and that is a ranking question. Failure is sorted on
EXPLICITLY rather than left to fall out of the valuation, which was the first cut:
a carrier that has just entered, or one in real distress, can be worth about
nothing while still flying. Measured over fourteen finished games, a pure
market-cap sort would have placed a live carrier below a dead one in **88** pairs.
A struck-through name is history, and history goes at the bottom whatever the
arithmetic says.

**An uncontested sector now uses the same one-row design as a contested one.** It
had a branch of its own that printed the entire technology panel inline — every
delivered program and every effect it has, unfolded — so the quietest sector on
the board produced by far the tallest panel. The technology is still there, in the
Tech column with its breakdown behind the same expandable row every carrier gets
on a contested market. One design, not two. A sector with nothing flying returns
before the table, since there is no standing to tabulate and the dormant note
below already says so.

**And the pin marker matches the schedule's.** It was a 2px bar with no padding,
printing straight up against the swatch; it is now the same 3px livery bar and 9px
step-clear that a selected sector has used all along. Same for the picked row in a
carrier's route list — one marker for "this is the thing you chose", wherever the
thing is.

**Each sector in a carrier's list now shows what it earns THEM**, priced through
their own books: their technology, their cost base, and the rivals actually on the
market including you. That is the number that says whether a competitor can afford
to keep fighting you on a route, which is most of the reason to read somebody
else's network at all. The list sorts on it — a network is read by where its money
is, not by where its metal happens to be parked — and a sector with nothing
assigned shows a dash rather than a zero, because those are different facts.

**It shipped broken twice, in the same way, and that is the lesson.** Two separate
stylesheet edits were written by an anchored replace that silently matched
nothing, so neither rule was ever added: first `is-route-focus`, then the whole
row-styling block. Both times the feature half-worked and therefore looked
plausible — the arc did get picked out, the row did get its class — so a reader,
and a screenshot, would pass it. What caught them was reading computed values back
out of the browser: `strokeWidth: 1.4px` where 3.4 was intended, and
`backgroundColor: rgba(0,0,0,0)` on a row that was supposed to be tinted. An
anchored edit that no-ops leaves no trace anywhere except in the thing it failed
to change. The build is now grepped for the rules that must exist.

**And "working" was not the same as usable.** With the row styling missing there
was no feedback in the list at all, and the picked arc — 3.4px among a pinned
carrier's six sectors all sitting at full opacity — was, in a tight cluster of
short-haul routes, a slightly fatter line in a tangle rather than a highlight. It
was reported as not working, and that was a fair description of it. Everything
other than the picked sector now drops to 14% while one is picked, the row carries
a bar in the carrier's own colour matching its sidebar swatch, and asking for one
sector leaves one sector to look at.

**Route lines are also clickable now**, which is the first thing anybody tries and
did nothing whatever: arcs carried hover handlers and no click, so the click fell
through to the map and was read as picking the nearest city to start a route. Your
own sector opens its dossier; a rival's pins the carrier, picks the sector out and
puts their network in the pane. Each arc has an invisible wider twin to be clicked,
because a 1.4px curve is not a reasonable thing to ask anyone to hit — at 12px
those targets overlapped so badly near a hub that a click on one line was answered
by a neighbour, so they are 5.

### The competition list gets a number and a handle — 2026-08-03

Two asks from a playtest, and the second came with a question: was there any way
to see all of one carrier's routes? Almost none. Hovering a rival's arc lit their
whole network, which is no use unless you already knew where on the map to point.

**Each rival now shows what it is worth**, and the figure is **market cap**, not
`netWorth`. That function is cash plus the BOOK VALUE of owned aircraft, so a
carrier flying an entirely leased fleet reads as worth little more than its bank
balance however well it is doing, and debt does not enter at all — borrowing $50M
raises it. Market cap is what the horizon victory check compares and what the
treasury already shows, so the sidebar now agrees with both. Two tests pin the
distinction rather than the choice being a comment nobody can check.

**And a rival can be pinned from the list.** Clicking a row holds that carrier's
whole network at full strength on the map until it is clicked again; the row takes
a bar in the carrier's own colour so the list and the lit arcs read as the same
thing. Hover still works and now falls back to whatever is pinned rather than to
nothing.

The pin is a property of the map SELECTION rather than of the arcs, so it survives
a re-render — the arcs are rebuilt every time the board changes, and a class
applied at click time would have been wiped by the next quarter.

**And the pane under the map now lists the network**, which is the part that was
actually missing. Lighting the arcs answers "where are they" only if you can read
a map at world zoom; the annual-report sheet counts a rival's sectors without
saying where any of them are. The dossier gives the carrier's archetype and home,
what it is worth, how many sectors and aircraft it has, how many of its markets
you are already in — and then every sector it flies, with distance, aircraft on it
and posture, heaviest first. A sector it has opened and not filled shows a dash,
so a rival moving into a market is visible before the metal arrives.

The pane was a two-way switch (a selected sector, or the quarter's result) and is
now three. Clicking a rival clears the sector selection so the dossier has the
pane; selecting a sector takes it back while leaving the network lit. The row
click is three-way rather than a plain toggle for that reason: clicking a pinned
rival whose dossier is not on screen brings it back rather than unpinning, which
a two-state toggle got wrong the moment a sector was selected.

### A sector you just opened was almost invisible — 2026-08-03

A playtest: opening a route between two cities showed nothing until an aircraft
was assigned to it. The dashed dormant arc added yesterday was drawing — it was
just very nearly impossible to see. Two faults compounding, and the first is the
real one.

**`routeWeights` ranked dormant sectors last instead of ranking them out.** A
route with nothing on it earns nothing, so it scored zero revenue, sorted below
every flying sector, and was handed the thinnest of the three weight tiers — 1px.
The tier is supposed to mean "how much of your network this sector carries", and a
sector that is not flying has no answer to that. It now takes the middle weight
and is excluded from the ranking, which also stops one dormant route dragging the
tier boundaries around for every other sector.

**And the dormant style was calibrated for the wrong thing.** 42% opacity is right
for a RIVAL's announced-but-not-flying route — intelligence, not service, and it
must not compete with your own network for the glance. On the player's own sector
it was far too quiet: at 1px and 42%, dashed, it read as the click having failed.
Split, so yours sits at 80% and lets the dash carry the "not flying yet" by
itself, while a rival's stays at 28%.

**The rule was extracted to `src/ui/arcweight.ts` to make it testable.** It was a
private method on the app class, pure over sim types but unreachable from a test,
which is why a defect in it was invisible to a 450-test suite and had to be found
by a person looking at a map. Three tests now cover it: a dormant sector takes the
middle weight, three or more flying sectors still spread across the range, and a
network too young to have a shape stays unranked.

### "Halyard Group 0%" — the holding was real, the display was not — 2026-08-03

A playtest asked why the treasury listed a shareholder at 0%, beside a Buy out
button. It reads as a phantom entry. It is not: a rival taking a modest
speculative position in a large carrier genuinely lands under half a percent, and
`pct` rounds to whole percent, so a real holding was erased.

The mechanism is `maybeTakeStake`, which is meant to do this — a non-acquisitive
carrier puts surplus cash into a profitable rival's stock and never pushes past
`stakeCeiling`. A rival with $20M spare buying into a player worth billions owns
about 0.4% of it, which is exactly what it should own and exactly what the
interface refused to say.

Added a `stake()` formatter for shareholdings specifically: a decimal below one
percent, `<0.1%` below a tenth, whole percent above. Only a genuinely empty
holding now reads as 0%. Applied everywhere a holding is shown — the shareholder
list, the rivals table's held-by tooltip, and the four briefing lines about
accumulation, selling down, dilution and a collapsed holder.

Accumulation is most worth seeing while it is still small, so rounding it away was
hiding the warning at precisely the point the warning is useful.

One thing caught applying it: the collapsed-holder alert interpolated `${was}%`,
and `was` had become a formatted string — it would have rendered "45%%".

### Chapter 11, and an estate sale — 2026-08-03

A failing rival used to evaporate, and a substantial one: at the moment of failure
the median carrier held **19 aircraft, flew 12 routes and owed $707M**, and all of
it left the world at once. That is neither how airlines fail nor an interesting
thing to have happen. Failure now branches.

**Chapter 11** — a carrier with a network still worth flying restructures instead
of being wound up. Creditors take 70% of the debt, the worst 40% of the network
closes and the leases behind it are rejected, and what emerges runs on a
permanently lower cost base (`reorgCostAdvantage`, 0.92 on crew, maintenance and
ground). That is the perverse dynamic the US industry actually runs on, and it
gives a fare war a downside it did not have: kill a rival and it comes back
cheaper than the airlines that never failed.

Measured, a restructured carrier regrows from 9 routes at emergence to 15 six years
later, against 23 for one that never failed. Smaller, cheaper, and still there.

**Chapter 7** — anything else is wound up, and its fleet goes on the market at 62%
of list for six quarters. Bought outright only (the estate wants cash, not a
lessee) and it flies the quarter you buy it rather than after a build slot. That
immediacy is most of the appeal: a rival folding is the one chance to grow faster
than the order book allows.

Capped at **one restructuring per carrier**. A rival that cannot die is not a
rival, it is weather — and on hard about 9.4 carriers fail per game.

**Three bugs found reviewing it, one of them serious.**

1. **The player could restructure.** The branch ran for every insolvent carrier,
   so the player emerged from bankruptcy with 70% of the debt forgiven, a cash
   cushion and a permanent cost advantage — pillar 5's loss condition simply gone.
   Verified by construction before the fix. This is the exact failure the bailout
   backstop already carries a comment about. Chapter 11 is now rivals only; the
   state rescue, capped at three, remains the player's second chance.
2. **Distressed lots were never pruned.** They accumulated for the whole game — 27
   still listed at the horizon on hard — and rode along in every autosave.
3. **`newGame` did not initialise `distressed`,** so a migrated v14 save and a
   fresh game had different shapes and two migration tests failed on the
   difference. Fixed in `newGame` rather than in the tests, which were right.

**And one test replaced, which deserves scrutiny rather than a footnote.** The
Phase 3 variety invariant measured an interquartile range scaled by mean magnitude
— two of twenty data points, and which two depends entirely on where the
bankrupt/surviving boundary falls. Near a 50% survival rate it reads enormous; at a
high survival rate both quartiles land inside the surviving band and it compresses
however varied the games were. Across six seed bases it ranged **0.41 to 2.23** on
a quantity meant to be a property of the game.

Chapter 11 moved one fixture from 14 survivors to 17 and failed it, while leaving
the mean across bases untouched (1.567 before, 1.580 after) — the change was in the
instrument. Replaced with a coefficient of variation over all twenty games, which
is the standard statistic for the question, ranges 0.48 to 1.05 over the same six
bases, and still goes to zero if every game ends the same way. Sampling more bases
was tried first and rejected: it cost 34s of CI per extra base for a weaker fix.

Balance: medium 10–14/20, hard 0–2/20, determinism identical on all three levels,
no invariant violations over 24 games.

### Everyone flew the same aeroplane — 2026-08-03

A playtest noticed every carrier on the same type. Measured over eight games:
**AROSN4 alone was 53.5% of all aircraft-quarters**, three types were 94.7% of the
fleet, and a carrier's fleet was a median 86% one type — the same one type. Three
causes, and the first was mine.

**The shortlist offered exactly ONE narrowbody.** The class-diversity fix of
2026-08-02 takes one representative per class and then fills by nearest gauge; the
spare slots go to the next-nearest overall, which on any decent market is another
widebody. So a carrier could never even price a second narrowbody. Fixing the
widebody problem had quietly destroyed choice inside a class.

**The roster had a hole.** Only Aros and Vanta build a full line, and Aros had the
next-generation single-aisle while Vanta had only a next-generation widebody. After
it launched there was no modern narrowbody but Aros's, so everyone had to buy it.
Added **VANTA11**, a peer rather than a clone: 215 seats against 225, 2% thirstier
per seat, but longer-ranged and faster, at a marginally lower price per seat.

**And nothing differentiated one carrier's appraisal from another's.** Every
carrier ran the same numbers and got the same answer. Carriers are now built around
a manufacturer — an Aros shop or a Vanta shop — derived from the seed and the
carrier id rather than stored, so it needs no migration. Flying outside your own
shop costs 8% more on crew and maintenance (`fleet.offMakerCostPenalty`), which is
what fleet commonality is worth in life: one type rating, one spares pool, one set
of procedures. It is why real airlines are Boeing shops or Airbus shops rather than
picking the marginally better aeroplane each time. The niche builders are exempt —
they are bought for jobs nobody else covers, so there is no commonality to lose.

The shortlist reads the preference too, treating an off-shop type as 25% further
from the ideal gauge. Ordering only; the economics still pick the winner. Without
it the mechanic was inert — a Vanta shop paid the penalty on Aros metal and still
bought Aros metal, because its own equivalent never reached the shortlist.

| | before | after |
|---|---|---|
| most-flown type | AROSN4 **53.5%** | AROSN4 **26.8%** |
| top three types combined | 94.7% | 67.9% |
| a carrier's fleet in its single most-flown type (median) | 86% | 77% |
| distinct types a carrier ever flies (median) | 2 | 3 |

Carriers still standardise, which is correct and is the point of commonality —
they now standardise on **different** types. Survival, determinism and the full
suite are unmoved.

**One bug found and fixed on the way.** The first version of `preferredMaker`
seeded a PRNG with a weak mix of seed and carrier id and took a single draw. Ids
differ by one character, and that does not decorrelate: every rival in a game got
the same manufacturer. Replaced with a murmur3 finalizer, verified at 49.8% across
1,200 (seed, carrier) pairs.

### Owning half of somebody is not a personality trait — 2026-08-03

A playtest: a rival bought a majority of the player and the game carried on; then
that rival went out of business and the only thing that happened was the player's
stock returning to the open market, unannounced. Two separate faults, and the
answer to the design question is yes — a majority holder should end the game, and
the rule for that already existed.

**The loss condition was gated on the holder's archetype.** It required
`getArchetype(c.archetypeId).acquisitive === true`, so a carrier could hold 75% of
the player and nothing happened, because buying rivals was not in its character.
Verified before the fix: rollup, legacy and flag holding 51% ended the game; a
ULCC holding 75% did not, at any turn. Ownership is not a character trait, and the
gate is gone. The `acquisitive` test stays on the DISTRESSED-predator path, where
it belongs — who goes hunting a wounded carrier genuinely is a matter of character.

In practice this changes nothing today, and that is worth saying rather than
overclaiming: `finance.stakeCeiling` caps a speculator at 40%, under the 50%
control line, and only an acquisitive carrier runs a campaign past it. So no
non-acquisitive carrier can currently reach control. It was a rule depending on a
constant a long way away from it, which is the kind of thing that silently comes
true later. A test now pins `stakeCeiling < controlThreshold` so that if the
ceiling is ever raised, the consequence is visible.

**The takeover can be dodged by the raider dying first.** Bankruptcy is settled at
engine.ts:787 and liquidates the failed carrier's holdings; the control check does
not run until :922. So a roll-up that levers up to cross 50% and fails in the same
quarter has its stake wiped before anyone looks — confirmed by construction: a
holder at 60% that goes bankrupt produces no game over. Left as it is, because the
outcome is defensible (a bankrupt company cannot own an airline, and administrators
sell the block) — but it was completely silent, which is what made it read as a bug.

**So the register is now reported in both directions.** Accumulation was already
telegraphed quarter by quarter, at 10% and rising, in danger tone past 40%. The
unwinding said nothing at all:

> **Raider collapsed, and the 45% of you it held has gone back on the open market.
> Nobody owns that block now — buy it back before somebody else does.**

A holder merely selling down gets a quieter line under Markets rather than an
alert, so the loud version stays meaningful.

### A pandemic read like a footnote — 2026-08-03

A playtest asked why big events do not appear in the quarterly report. They do —
measured, 123 of 123 event starts over six games reached the briefing. The report
was not missing them, it was burying them and saying nothing about them.

Two faults. **The briefing threw away everything the deck knows.** All nineteen
cards carry a blurb, a tone, a crisis flag and their actual multipliers, and the
line printed was `"${name} has begun."` — so a 58% collapse in demand arrived with
less information, and no more weight, than "Fuel rose 8%" two rows below it. And
**a crisis was a bullet in the third section**, under routine revenue and rival
chatter: 5+ lines down the page on 28% of the quarters one fired.

Now an event states what moves and for how long, biggest movement first, and the
four cards the deck marks `crisis` are promoted to the alerts box at the top:

> **Pandemic scare.** A health scare empties aircraft worldwide. Nobody is flying
> who does not have to. For 7 quarters: demand down 58%, fares down 15%.

Promoted as `warn`, not `danger`. The danger tone sounds an alarm and is reserved
for a game actually ending; a crisis every few years would make that furniture.

One copy defect caught on the way, and it is the same one this project has hit
before: the effects clause ran straight on from the card's blurb, which is already
a sentence, giving "...who does not have to. demand down 58%" — a lowercase
fragment after a full stop. Duration now leads the clause so it opens with a
capital and the movements read as a list. Pinned by a test that greps the line for
`/\.\s+[a-z]/`, since prose defects do not otherwise fail anything.

The old test asserted the literal word "begun" and so failed on the better copy. It
was rewritten to assert what it was actually defending — that the card is named,
its effect quantified and its duration stated — which is a stronger check than the
one it replaced.

### The pricing dial gets two more notches, and a preview — 2026-08-03

Prompted by outside guidance on a screenshot: a monopoly sector at Premium, still
turning away more passengers than it carried. Two of the four points in that
guidance did not apply to this codebase and are worth recording as such, because
they are easy to believe:

- **"Posture has no anchor; the buttons are defined relative to competitors who do
  not exist on a monopoly."** Not so. `fareOneWay` has always multiplied a fare
  the SECTOR bears — `(base + perKm x dist^0.78) x weightFactor` — by the posture
  table. Nothing about rivals enters it; market structure is a separate multiplier
  applied afterwards. The anchor the guidance asks for is the one already there.
- **"That missing anchor is also the root of the UNDERCUT-priced-above-a-rival
  bug."** That bug was real and was fixed on 2026-08-02: the premium was being
  computed per-carrier instead of off total market capacity. Different cause.

What was right, and is now built:

**Five notches, not three.** SKIM above Premium, STIMULATE below Undercut. The
three originals keep their exact figures, so a saved route still means what it
meant and no migration is needed. Still one decision per sector — a posture, not a
fare box — but the dial can now express milking a spilling monopoly and buying a
thin market, neither of which three buttons could say.

**And it fixed a dominant strategy nobody had measured.** Across 5,118 (route,
aircraft, fleet-size) combinations:

| | three notches | five notches |
|---|---|---|
| most-optimal posture | undercut **87.6%** | stimulate **56.5%** |

87.6% was already past the 80% line CLAUDE.md sets for "the economy needs work" —
it had simply never been checked. The wider dial is materially less degenerate.
The gradient still points cheap, and the real cause of that is a single
undifferentiated demand pool: with no business/leisure segmentation, whoever
prices lowest takes it. That is a model change, not a constant, and it is not
attempted here.

**A preview under the dial.** Hovering or focusing a notch prices it through the
same `computeRouteEconomics` the quarter settles on and states the fare, traffic,
load and quarterly net, against what is flying now. The reason people ask for a
fare box is not that they want to type 1,050 instead of 1,000 — it is that the
elasticity is invisible, so the buttons feel like a vibe. This shows the curve
without opening the door to hand-tuning forty sectors a quarter.

**Spill promoted to a first-class signal.** `STRINGS.sector.spilling` had been
written and never wired. A sector turning away more than it carries now says so,
in aircraft: "turns away 7.3x what it carries - short of seats, not of demand.
Clearing it needs at least 9x the metal that is on it now."

**The rivals could not use the new notches at all, and that needed a second fix.**
`posturesFor` returned a single-element list for any archetype with a configured
`posture`, and all four have one — so the dial was shopped only by carriers with
no posture set, which is the player fixture. Measured: skim and stimulate on
**0.00%** of rival route-quarters while the player fixture used skim on 29.8%. The
player held pricing moves the field could not answer.

Two changes. Archetypes now carry a `postures` BAND rather than a single lock —
ULCC `[undercut, stimulate]`, legacy `[skim, premium]`, flag
`[skim, premium, match]`, roll-up `[match, undercut]` — chosen so each can still
never do the thing that would betray its identity. And `repricedForOverlap` became
`repriced`: it prices the band on every sector each quarter and takes the best,
with the legacy hub's drop-to-match-when-contested rule kept intact on top. Without
the second change the first bought nothing, because `posturesFor` is only consulted
when a sector is OPENED — a route priced at undercut in year two stayed there for
the rest of the game.

Rivals now use skim on 6% of route-quarters; flag and legacy carriers skim the
sectors they hold alone and sit at match where they are contested, which is what
those archetypes are supposed to look like.

**Where the dial actually lands**, on 1,218 sectors flown at turn 80 across six
games: match 54.0%, skim 27.8%, undercut 17.1%, premium 1.0%, **stimulate 0.2%**.
Four notches earn their place and the most-used is well under the 80% dominance
line. Stimulate is close to dead, and for a structural reason worth recording: it
trades fare for share, and share is worthless on a sector that is already spilling
— which most are, because carriers here are aircraft-limited. Its niche is
over-supplied sectors, which are rare. Left in rather than tuned into usefulness,
because forcing it would mean pricing it against the metric instead of against the
model. It becomes useful if the capacity constraint ever eases.

**A performance claim I made and then had to withdraw.** The repricing pass looked
like it cost ~50% of headless runtime, so an annual staggered review was built to
avoid it. It costs nothing measurable — 8.71s against 8.78s over six games. The 50%
came from timing a run with repricing disabled, which is not the same work minus a
probe but a different, smaller game, because the AI then flies different routes.
The annual review was reverted: its only remaining argument was that it made
rivals slower to respond than the player.

**And on hard, rivals now hunt.** Difficulty scaled demand, entry pace, aggression,
capital and contest pressure — but never pricing. Measured: contested sectors on
hard were priced at undercut 41.9% of the time against easy's 42.5%. Meeting a hard
rival on a route felt exactly like meeting a gentle one.

`difficulty.predation` is the fraction of a contested sector's best available
profit a carrier will give up in order to price UNDERNEATH the competition instead
of sitting on the margin. Hard is 0.85 — it will surrender most of the margin to
get to the bottom of its band and squeeze.

Two things keep it from being a blunt instrument. It only bites where the cheaper
fare is **still profitable**, so a rival never prices itself into a loss it cannot
fund — which means squeezing a wolf's margin is what stops it biting, and that is
the counterplay. And the deepest affordable cut is found by walking the band by the
FARE TABLE rather than by however the band happens to be written in JSON, so
adding a notch cannot silently change who undercuts whom.

Contested sectors, by difficulty:

| | easy | medium | hard |
|---|---|---|---|
| priced at the deepest notch (stimulate) | 0.1% | 0.4% | **31.4%** |
| priced at undercut | 42.5% | 42.6% | 45.4% |

**Held at zero below hard, deliberately.** The mechanic is sensitive — the notches
sit close together in net, so even 0.08 on medium moved its contested mix from 43%
undercut to 60% — and medium is the tuned baseline the game is balanced against.
Easy and medium are byte-identical to before this change; only hard moved. Hard
survival went 2.3/20 to 1.75/20 across four seed bases, which is inside the noise
it was already living in.

It also, incidentally, gave STIMULATE the niche it was missing: 0.0% of hard
route-quarters before, 42.0% after. The notch was not badly specified, it just had
no reason to exist until somebody had a reason to price below profit-max.

Not built: the suggestion that revenue-management tech should fine-tune the fare
inside the chosen posture. It would be pure fiction — and RM tech was re-pointed
on 2026-08-02 to narrow the demand K-factor instead, which is what a revenue
management system actually does and is already true.

**Two defects found reviewing my own work.** The preview was appended inside the
header's flex row, so it sat BESIDE the buttons and slid the whole dial 32px
sideways every time the text changed length — buttons moving under the cursor,
caught by a browser check rather than by reading. And the spill flag reported the
wrong multiple: seats needed is `(carried + spilled) / carried`, which is 1 + the
ratio, so at 6.6x turned away it said 7x when the answer is 8x, and even that is a
floor because more capacity wins more share.

### Ghost arcs: the map drew routes nobody was flying — 2026-08-03

A playtest reported seeing lines between cities with no carrier underneath them.
Real, and self-inflicted: **6.6% of drawn route-quarters had no market presence**,
measured over six games.

The map read `state.routes` and drew every one. The market board reads the market
index, which deliberately excludes a route whose aircraft are **ordered but not
delivered** — that gate was added on 2026-08-02 to stop a carrier taking share with
metal that does not exist yet, and it was right. What was missed is that the two
sets then stopped agreeing. A rival that opened a sector and placed an order showed
a solid line for the quarter or two before delivery, with nobody on the market
underneath it. Of 1,145 ghost route-quarters, **1,112 were undelivered metal** and
33 were sectors with nothing assigned at all.

Fixed by giving `MapScene` a `flying` set built from the SAME index the board
reads, so the two cannot disagree again, and drawing anything absent from it
dashed and faded. Not hidden: the player needs to see their own dormant sector, and
a rival's announced one is real competitive intelligence. It is drawn as what it
is — a plan, not a service.

One interaction worth knowing: a newly opened route is both `arc-drawin` and
`arc-dormant`, and the draw-in animation's `stroke-dasharray: 1` wins on source
order for exactly one render. It settles to the dashed style on the next, so it was
left alone rather than complicating the animation.

### Archetypes fly different fleets now, and one of them never could — 2026-08-02

A playtest noticed every rival flying widebodies, low-cost carriers included.
Measured across ten games: **the ULCC flew 95.7% widebodies**, and no turboprop
ever left the ground. Two causes, one of them a straightforward bug.

**The shortlist never offered a narrowbody.** `candidateTypes` ranks types by
`|capacity − target|`, but `target` is the traffic the whole ROUTE might win while
`capacity` is what ONE aircraft carries. Above about 20,000 passengers a week the
target exceeds every aircraft in the game, so the ordering collapsed to "biggest
first" and the shortlist came back five widebodies and nothing else — measured, at
every market size from 20,000 up. **No carrier of any archetype could pick a
narrowbody on a decent market, because none was ever priced.** The shortlist is a
budget on how many types get appraised; it must not be the thing that picks the
winner. It now takes one representative of each class the sector can take before
filling the rest by nearest gauge, and the economics downstream decide.

That alone barely moved the mix (95.7% → 90.6%), which was the second finding:
**every carrier appraised every aircraft with the same cost base**, so they all
converged on the same answer. `costAdvantage` was a property of the company in the
abstract. It is now conditioned on the classes actually flown, via the
`flownKlasses` that `conditionsFor` already received — a low-cost carrier's
advantage IS its single dense narrowbody fleet, and it does not travel to a
widebody. The ULCC's widebody figure is deliberately set above `1/costAdvantage`
(0.85 × 1.22 = 1.04) so flying one leaves it worse off than an ordinary carrier
rather than merely less advantaged; at a gentler 1.12 it still flew 65% widebodies.

| archetype | before | after |
|---|---|---|
| ULCC | 4.3% narrowbody | **91.9%** |
| Legacy | 5.7% | 46.5% (widebody-led, mixed — as a real legacy is) |
| Flag | 18.5% | 31.6% (68% widebody: prestige long-haul) |
| Roll-up | 0.9% | 54.5% (no preference — it flies what it bought) |

**This forced a balance decision that had been outstanding since cargo.** With
archetypes making better fleet choices, medium survival went to 17–18/20 against a
~10 target, and `regression.test.ts`'s divergence invariant — the Phase 3
acceptance test, that two seeds feel meaningfully different — **failed on three of
six seed bases**. It tracks survival inversely: when almost nobody goes bankrupt,
outcomes cluster and every game reads the same. That is the cargo overshoot
surfacing, not a flaw in the fleet work.

Two realism-grounded corrections fixed it, and both were checked against sources
rather than dialled:

1. **Cargo recalibrated from 0.016 to 0.012.** The dial is hold utilisation. IATA's
   busiest corridors run 67.5% and 61.4% cargo load factor, and I had calibrated on
   those — but one rate here applies to every widebody sector including thin ones
   that would never fill a hold, so it has to be the industry average, near 50%.
   Cargo is now ~17% of a transatlantic flight's passenger revenue rather than 23%.
2. **Fuel burn corrected to published figures**, which the aircraft review had
   already established sat ~28% low. This was offered and declined as a bundle
   earlier; it is applied now because it is the compensating cost the cargo revenue
   needed, and it is a correctness fix in its own right.

Result: divergence passes on **all six** seed bases (1.03–1.88, threshold 0.5) and
survival is 11–15/20, against 17–18 before and a ~10 target. Not yet on target, but
in range and no longer converging.

**Known cost, and it is worth watching.** The fuel correction hits widebodies
harder in absolute terms, so narrowbodies now win transatlantic sectors (LON–NYC,
NYC–LAX) where widebodies used to. Real transatlantic narrowbody flying exists and
is growing, but this is further than reality goes. TYO–NYC, the route that started
the cargo work, still reads 7/9 widebodies profitable against 1/9 before it.

### Belly cargo, and why widebodies were never going to work without it — 2026-08-02

A playtest asked how Tokyo–New York could lose money: hard, premium, monopoly, 87%
load factor, an A380-class jet, −$511K. The arithmetic checked out and the posture
was the right one — premium beat match by $1.6M there, for every aircraft. The real
answer was that **one widebody out of nine turned a profit on that sector**, by
$310K. On the marquee long-haul route on the map. That is not a player mistake, it
is a missing revenue line.

**Cargo is modelled per available seat-km, not as a share of passenger revenue.**
This is the important design choice. Freight is CAPACITY-driven: the hold fills
whether or not the cabin does, and it is exactly that independence that makes a
widebody worth flying on a long thin route. A percentage of passenger revenue would
have looked similar on a busy sector and been wrong on precisely the sectors this
exists to fix. It is also priced off BASE gauge, so a premium cabin — which takes
space out of the cabin, not the hold — does not shrink the freight business.

**Calibration**, from published figures rather than feel. A full transatlantic
widebody belly earns $40–80k a flight at $2–4/kg; at a realistic 60–70% hold
utilisation a 365-seat twin over 6,000 km earns about $35k, which is `0.016 × 365 ×
6000`. That is ~23% of the same flight's passenger revenue, against belly-inclusive
shares of 23% at Cathay and 8.7% group-wide at Lufthansa (both include freighters,
which this game does not model, so the belly-only share sits below them). Measured
in the sim: **23% transatlantic, 28% trans-Pacific, 1–2% narrowbody short-haul.**
The share rises with distance on its own, because freight revenue is linear in
distance while fares are sub-linear — the real pattern, and it needed no constant.

Narrowbody holds are bulk-loaded and mostly full of baggage, so they earn a tenth
of the widebody rate per seat; regional aircraft earn nothing worth modelling.

**Checked for the degenerate case.** Cargo does not spill, so "buy widebodies for
ever" was the obvious failure mode. It does not appear: net on TYO–NYC peaks at four
aircraft and falls away after, because cargo alone cannot cover an aircraft — the
marginal jet still has to fill seats. Pinned by a test.

**Result:** TYO–NYC goes from 1/9 profitable widebodies to 9/9.

**Balance moved a long way and no compensating tuning was applied.** Median route
margin 20.7% → **28.1%**, unprofitable sectors 8.8% → **3.1%**, and medium survival
10–12/20 → **14–18/20** against a ~10 target. Hard is unmoved at 2–3/20.

Pairing it with the published fuel figures (the roster sits ~28% below them — see
the aircraft review) was tested: it restores margins to 21.8% and unprofitable
sectors to 7.0%, near the pre-cargo baseline, but **does not move survival**, which
stays at ~15.8/20. That is not a failure of the fix, it is the mechanism working:
cargo gives a weak carrier a revenue floor that does not depend on winning
passengers, which is exactly how belly freight cushions real airlines. Bringing
survival back to target is therefore a difficulty-knob question, not a cost one, and
it is left for a deliberate tuning pass rather than bundled in here.

The sector P&L now reads **Fares / Cargo** as two revenue lines, the way an airline
reports them. Not "Passengers": that panel already shows a passenger count a few
lines above, and the same word for a headcount and a revenue line reads as a bug.

### The treasury stops asking through window.prompt — 2026-08-02

Every capital decision in the game — borrow, repay, issue equity, set dividend, buy
a stake, sell a stake, buy back a stake, hedge fuel, acquire a carrier — went
through `window.prompt` or `window.confirm`. Nine of them.

A prompt cannot show a ceiling, cannot offer a default worth accepting, and cannot
say what a number will do, so the player typed millions into an empty box and found
out from an error toast. And `confirm` has exactly two outcomes, which is how
**acquisitions became impossible to cancel**: the dialog read "OK to fund with debt,
Cancel to pay cash only", so Cancel bought the carrier for cash. There was no way
out once it was up. That is a real bug, not a papercut, and it had been sitting
behind the most expensive button on the board.

Replaced with two small sheets, `askAmount` and `askChoice`, both promise-based:

- **askAmount** carries presets, a custom field, and a live preview line. The
  preview is the whole point — "Buys about 8% of Cordillera, taking you to 8%,
  leaves you $780" is a decision; "How much? (in millions of USD)" is a quiz.
  Presets are quarter/half/maximum for the treasury actions and **5% / 10% / maximum
  of the target carrier** for a share purchase, since percent of the carrier is the
  unit the per-quarter cap is written in.
- **askChoice** lists courses of action as full-width rows with their consequences,
  and always offers Cancel — so the acquisition now has three outcomes, which is
  how many it always had.

Two things found by testing it rather than reading it. **`Maximum` was unusable
whenever the ceiling did not land on a clean cent**: the field shows two decimals
and `toFixed(2)` rounded the exact ceiling UP past itself, so the one preset that is
always meant to be valid greyed out Confirm. Presets now round down to a display
step and the ceiling check tolerates one. And **presets that cost more than you hold
are now shown disabled rather than dropped** — filtering them out hid the fact that a
per-quarter cap exists at all, leaving a player who could not afford 5% of a carrier
looking at "Maximum" and no explanation.

The four treasury actions are also a row of controls now rather than four
full-width rules stacked down the sheet. Centred type over a hairline is the same
shape this interface uses for section dividers, so the four most consequential
buttons on the board read as a contents list. Borrow carries the livery.

Not converted: the save-slot and new-game confirms. Those are ordinary destructive
confirmations with two genuine outcomes, and a browser confirm is the right size
for them.

### Aircraft model review, and two wrong diagnoses of my own — 2026-08-02

Prompted by a playtest: an A380-class jet losing money on Jakarta–Tokyo, a 5,784 km
sector with 70,000 passengers a week. **The sector is fine — an A321neo-class makes
$4.3M a quarter on it, on hard.** The aircraft was wrong. But the first two
explanations offered for WHY were both wrong, and both are worth recording because
they were wrong in the same way: asserted from memory, not measured.

**Wrong claim 1: "widebodies have lower seat-mile fuel cost in reality; that is
their purpose."** They do not. Published figures (Wikipedia's fuel-economy tables,
which cite stage length and seat count): A321neo **1.98** L per 100 seat-km,
A320neo 2.25, 787-9 2.31, A350-900 2.39, 777-300ER 2.91, A380 3.16, 747-400 3.34.
Modern narrowbodies are the most efficient aircraft flying, per seat. Airlines buy
widebodies for range, payload, belly cargo and slot scarcity — not fuel.

**Wrong claim 2: "the roster's fuel figures invert the real ordering."** They do
not. Sorted by litres per 100 seat-km the roster reproduces the published ordering
almost exactly, with only A350/787 swapped. What is true is that the whole roster
sits about **28% below published levels** — uniformly, so the ordering survives.
That is a level calibration question on a file whose own `_meta` declares it
balance surface, not the bug that was being looked for.

**What the audit actually found**, sweeping every type across 2,772 city pairs:

| class | best result anywhere |
|---|---|
| Turboprop | **−$0.18M — never profitable on any route in the game** |
| Regional jet | +$0.35M |
| Narrowbody | +$20.66M |
| Widebody | +$6.50M |

Turboprops are dead content and regional jets are close to it. The cause is
**ground handling**, charged as `1200 flat + 4/seat` per departure: that is $20.67
a seat for a 72-seat turboprop against $6.50 for a widebody, and it makes handling
the largest single cost line on a regional sector — 29% of revenue, ahead of fuel.
Widebodies are viable only where nothing else reaches, and are beaten roughly 3:1
by narrowbodies wherever both can fly.

**Reshaping handling was tried and reverted.** Published turn costs (~$400–700
turboprop, ~$900–1,600 narrowbody, ~$3,000–5,000 widebody) fit `200 + 8/seat`, and
that does fix the class: turboprops go to +$0.36M and regional jets quadruple. It
also fails the divergence invariant in `regression.test.ts` — survival at seed base
1000 collapses 12/20 → 5/20 — because doubling the per-seat term hits widebodies,
which were already marginal. A gentler `700 + 5/seat` was worse still and less
stable (survival 14/9/6/8/7 across seed bases). Two reasons to leave it:

1. The fit double-counts. `distributionPerPax` already covers passenger ground
   handling, so the per-departure line should only carry gate, ramp, landing and
   navigation — published turn costs include more than that.
2. Lower costs lift rivals as much as the player, and the second-order effect
   swamps the first-order one. This needs a tuning pass with the harness, not a
   constant swap.

Logged in IDEAS.md. The constant now carries the finding in its comment so the next
person does not have to rediscover it.

**Then a second pass, because the first one only checked ONE field.** The audit
above compared fuel burn against published data and nothing else — nine other
numeric fields per type were never checked against anything, and saying the roster
was accurate on that basis was overclaiming. Checking all of them against published
specs for each type's `basis` found **12 discrepancies**, five of them material:

| type | field | was | published |
|---|---|---|---|
| CIRRO90 (E195-E2) | seats | 100 | **120–146** |
| CIRRO90 (E195-E2) | range | 3,800 km | **4,917 km** |
| AROSN1 (A319neo) | range | 5,900 km | 6,950 km |
| VANTA4 (MD-80) | range | 4,000 km | 4,635 km |
| BOREAL100 (A220-100) | range | 5,700 km | 6,390 km |
| TARN42 (ATR 42) | range | 1,500 km | 1,326 km |

The E195-E2 was the serious one: undersized by a fifth AND short-ranged by a
quarter, and its fuel burn (2.60 L per 100 seat-km) was the only figure in the
roster modelled *worse* than reality while every other type sat ~28% better. Three
compounding errors on one aircraft, which is why the regional-jet class looked
dead. Corrected to 130 seats / 4,900 km / 2.25 L per km, and the class went from a
best-case **+$0.35M to +$8.19M** — now ahead of widebodies. Survival is unmoved
(11.2/20 average across five seed bases, same as before). Turboprops stay dead;
that one is handling, not specs.

The remaining discrepancies are defensible: the cruise-speed gaps are a typical-vs-
maximum-cruise distinction (the A320 family quotes M0.78 and M0.82; this file uses
the high end), and the 747-400 seat count is 1.4% under the low end of its band.

`tests/fleet.test.ts` now carries the published table and checks seats, range and
entry-into-service for every type modelled on a real aircraft, plus a check that no
new real-basis type can be added without an entry. Cost figures are deliberately
NOT pinned — those are balance. Geometry is not.

**And the correspondence is now stated, once, where the question occurs.** A
colophon under the aircraft market: "Aircraft here are fictional, but each one is
modelled on a real type — seats, range, cruise and fuel burn are taken from the
published figures for its class. The names are invented; the numbers are not." It
deliberately does NOT print the real type under each card. The fictional names
exist to keep trademarks off the board, and a per-card "based on the A321neo" would
put them straight back; a reader who knows the industry will recognise the classes
from the figures, which is the payoff for getting the figures right. The README
names the classes outright — that is documentation, and CLAUDE.md §6 already does.

**What was fixed.** The loader validated only that each field was a finite number,
which is exactly why a fleet-wide problem could hide: every value was individually
plausible. It now checks plausible ranges per field, a known `klass`, and — the one
that matters — the **cross-field** check that fuel burn and seat count are only
meaningful together. A 180-seat jet burning 0.4 L/km has two perfectly ordinary
looking fields and cannot exist. Three tests pin it, including a no-dominated-types
check so a new aircraft cannot silently make an old one unbuyable. Also: `canReach`
had its docstring attached to the function above it, and `basis` was in the data
but missing from `AircraftType` — it is the field that makes a number checkable
against published data, so it is now typed.

### MIT, and the repo prepared for a public push — 2026-08-02

CLAUDE.md §11 left name and licence open until the first public push. Both are now
settled: **Air Honcho, MIT**. MIT over GPL-3.0 because the project has no
commercial position to defend, wants the data files and the simulation model to be
reusable with as little friction as possible, and takes no runtime dependencies
whose licences would need to be reconciled.

`package.json` keeps `"private": true` deliberately. It is an application, not an
npm package, and the flag only prevents an accidental `npm publish` — it has no
bearing on the licence. Said so in the README, because the pairing looks
contradictory at a glance.

**The bundled font was a real compliance gap.** `src/assets/fonts/LICENSE`
carried the OFL preamble and a link to the rest. The OFL requires the complete
licence text to travel with the font in any redistribution, and publishing the
repo is redistribution. Replaced with the full OFL 1.1. The MIT licence on the
project does not reach the font, and the README now says so rather than leaving a
reader to assume one licence covers everything.

Also added: CONTRIBUTING.md, which puts the board-meeting test, the `src/sim/`
purity rules, data-before-code, and the requirement for headless before/after
numbers in front of outside contributors instead of leaving them buried in
CLAUDE.md.

### Three defects in the spill model's first cut — 2026-08-02

A review of the entry below, checking the implementation rather than re-reading it.
All three were silent: the arithmetic ran and produced plausible numbers.

**1. `expectedLoad` integrated a tail that runs to minus infinity.** The textbook
form is `mu - E[(D-C)+]`. Because sigma is a fixed FRACTION of the mean, the normal
always keeps `Phi(-1/k)` = 0.2% of its mass below zero, so that tail never goes
away and the error grows with the mean while the true answer is capped at the seat
count. Against 300k Monte Carlo draws it read 0.3 points low at demand factor 10,
4.5 low at 200, and returned a flat **zero** by 2000. Live games top out near 19, so
it was never wrong on the board — a landmine for a scarcer map, not a live bug.
Replaced with the censored form, `E[min(max(0,D), C)]`, which is exact at every
demand factor (worst error now 0.15 points, and that is mostly Monte Carlo noise).
A departure drawn below zero carries nobody, which is why load now tops out at
99.8% of seats rather than 100%.

**2. Rival capacity was counted at half weight.** `capacityWeekly` means one-way in
the market index and round-trip in the struct `computeRouteEconomics` returns, and
the one-way figure was being weighed against `2 * capacity`. Two identical carriers
on a sector scored a rival capacity share of **0.333** where 0.500 is right, in both
the competition load penalty and market saturation — so competition was felt at half
strength everywhere. This is the live one.

**3. Rivals spilled on a hard clamp while we spilled on a curve.** A competitor
turned nobody away until it was literally sold out. At demand factor 1, the median
sector, it should shed ~14% of what it wins; it shed nothing, so `share.spillCapture`
had almost nothing to re-book.

**Measured, medium, 10 seeds x 100 turns.** Fixing 2 and 3 pulled balance back
toward target on its own, with no tuning applied:

| | before | after |
|---|---|---|
| sector-quarters observed | 33,925 | 47,897 |
| median route margin | 17.5% | **21.3%** |
| unprofitable sectors | 13.1% | **9.9%** |
| margin p5 | −23.9% | **−10.1%** |
| contested markets (2+ carriers) | 15.0% | **19.6%** |
| survival, medium | 8/20 | **10/20** |

Load factor barely moved (median 85.2% either way) — these are competition and
recapture effects, not load ones. Survival on medium landing back on its ~10/20
target is a consequence of the fixes, not a tuning pass. Easy 19/20, hard 2/20.

All three are pinned by tests that fail against the old code: see `the spill model`,
`one-way and round-trip capacity are not mixed`, and `rivals spill on the same curve
we do` in tests/economics.test.ts. The units test asserts on the rival capacity share
backed out of the returned ceiling, because a first attempt that checked
`rivalCapacityOf` directly passed against the bug — it tested the producer of the
figure, not the consumer where the fault was.

### Load factor became an outcome — the Boeing spill model — 2026-08-02

The demand audit concluded that load factor could not be unpinned from its ceiling
by tuning, because capacity is chosen in response to demand. That was correct given
a DETERMINISTIC demand model, and the industry has not used one since the mid-1970s.
Research note and sources: docs/supply-model-research.md.

**Demand for a departure is a distribution, not a number.** Normal about a mean with
a coefficient of variation — the K-factor — of about 0.35 (MIT 16.75J). Load is then
`E[min(D, seats)]`, which has a closed form, and load FACTOR falls out of how well
capacity matches an uncertain demand:

```
  demand/seats   0.6    0.8    1.0    1.2    1.8
  load factor   59.8%  76.1%  86.0%  91.4%  96.9%
```

That curve is why a real network averages 82-84% rather than its ceiling: some
departures go out full and others half empty. The sim was clamping
`min(demand, seats x ceiling)`, so load factor was a constant read back.

**Result:** the ceiling now binds on **2.7%** of sector-quarters against 89.7%
before. Piling capacity onto LON-PAR used to read a flat 93.1% until a cliff at
eleven aircraft; it now reads 92.4 / 90.7 / 85.8 / 79.9 / 68.2 / 51.8 as metal is
added. Unprofitable sectors 7.4% -> 13.1%. Median load 85.2%.

**Revenue-management technology was re-pointed at the K-factor.** Those four
programs used to multiply the load ceiling. Revenue management does not raise the
physical limit of an aeroplane — it narrows the uncertainty you hold capacity
against, so you can size closer to the mean. Same buttons, same tree, and now it is
true. A recession dragging loads down still lands on the ceiling, where it belongs.

**The research note's own prediction was wrong and is corrected in place.** It said
the spill model would make `demand.maxLoadFactor` redundant. Removing the ceiling
was tried and gave a median load factor of 96.0% against a published 82-84%: the two
model different things — variance BETWEEN departures versus sellability WITHIN one —
and both are needed. Kept both.

**Balance moved and no compensating tuning was applied.** Median route margin
25.8% -> 17.5%; fixture survival medium 13/20 -> 8/20 (target ~10/20, +/-2 noise
floor), easy 19/20 -> 18/20, hard -> 2/20. That is the owner's call, not a silent fix.

Three tests moved with the model rather than against it, all asserting that a
sold-out sector sits AT the ceiling — the exact behaviour replaced. They now assert
what they were really defending: that the sector spills, and that load stays short
of both 100% and the ceiling. 404 tests green; structural audit clean; determinism
holds on every level.

### The market clears at one fare, and spill no longer vanishes — 2026-08-02

Two audit proposals applied after review, and three declined on measurement. Full
working in docs/demand-audit.md.

**P0, a real bug.** `competitionFareMultiplier` was called per-carrier with its
RIVALS' capacity, so the monopoly premium was a property of the carrier rather than
the market: a dominant operator saw little rival capacity, kept most of the premium,
and priced ABOVE a small rival on the same route even while posturing undercut. A
playtest caught it on CAI-IST — undercut at $126 against a rival at $115. The
function's own docstring asserted the opposite ("the market clears at one fare"). It
now takes the market's total scheduled capacity, and two carriers of any size clear
at $90 on that route.

**P1, applied, and it did not do what the audit predicted.** Spill re-books with
whoever has room instead of being deleted. Better modelling, and demand shocks now
reach a sold-out sector for the first time — but at-ceiling load factor went
87.9% -> 89.7%, the WRONG way, because absorbing overflow only adds passengers to a
carrier that had room and pushes it up to the ceiling.

**The finding that matters, and it corrects the audit.** Load factor cannot be
unpinned by tuning demand, because capacity is CHOSEN in response to demand. Halving
`demand.k` (140,000 -> 65,000) left at-ceiling at 87.2% and the spread unmoved: a
carrier sizes its fleet to the traffic it expects, so `won >= capacity` at any
demand level and `min(won, capacity x ceiling)` collapses to the ceiling. Only two
things move it — rivals arriving after you have built, and demand falling after you
have built. The "load spread 60-95%" target is not reachable from the demand side.

**Declined, each on measurement rather than taste.** P1b (revert saturation): P1 did
not deliver the spread, so reverting would re-break multi-carrier markets for
nothing. P2 (`gaugeElasticity` 0.4 -> 0.6): changed the LON-NYC gauge ranking by
nothing — the narrowbody wins 2.6x either way because six widebodies exceed what a
66,000/wk market can fill. P3 (landing fee): short-haul is already the thinnest
band by median margin, so it would push the wrong one down.

**The gain is in margins, not load.** Unprofitable sectors 4.3% -> 7.4%, and the
5th-percentile margin moved from 0.0% to -11.4%: a real minority of routes now lose
money, which was one of the target-shape criteria.

Two tests moved with the model rather than against it: `phase3`'s "shrugs off a
modest demand shock" asserted revenue was IDENTICAL under a shock and now pins a
band, because P1 makes the shock slightly felt; and the full-history NaN check got
the explicit 150s budget its sibling already had, since carriers now survive far
more often and the run plays all 200 turns instead of stopping at an early
bankruptcy. 404 tests green.

### A rescue that looked exactly like a bug — 2026-08-02

Player, mid-game: "I should be bankrupt. I keep losing money, but my money never
goes under $30 million. Why?"

$30,000,000 is `finance.bailoutCushion`. Reproduced in four lines — park eight
leased widebodies and hold a recession open:

```
turn  cash        debt       bailouts
   4     $15.3M      $0.0M        0
   5     $30.0M     $43.7M        1
   6     $30.0M     $75.2M        2
   7     $30.0M    $108.5M        3
   8      -$5.2M   $108.5M        3   BANKRUPT
```

The mechanic was working exactly as designed — three state rescues, each booked as
debt, then the receivers. **The defect was that the game never said a word about
it.** No alert, no line in the quarter, no mention anywhere in the UI: cash simply
stopped at a suspiciously round number while debt doubled. From the player's seat
that is indistinguishable from a broken clamp, which is how it was reported.

**And the frequency was my doing.** Before 2026-07-29 the only crisis events were
9/11 and COVID, both scripted into the history scenario — so a bailout was a
once-a-generation event that most players would never see. Flagging `recession` and
`pandemic` as crises fixed rivals dying in every downturn, but it also turned a
rare emergency backstop into something that fires in most quarters on hard, where
events run 70-85% of the time. A mechanic can be correct and still be wrong once
its trigger becomes routine.

Three changes:

- `QuarterResult` gained an optional `bailout`, so the rescue is on the record
  rather than inferred from a jump in debt. Optional, so old saves load unchanged.
- The briefing raises a **danger** alert naming the money, the fact that it is debt
  charging interest, and how many rescues are left. Alerts render above the
  headline, so it is the first thing on the quarterly briefing — and `danger` is
  the tone that also sounds the audio alert, so it is hard to miss twice.
- The bailout now requires the MARKET to have refused first: it only fires when
  `borrowingCapacity` is exhausted. A state rescue is a last resort, not a standing
  overdraft. In the repro this changes nothing (a carrier with negative cash has no
  headroom anyway), but it stops the backstop pre-empting a carrier's own credit in
  the cases where it would have.

Rival survival is unaffected — failures 32 -> 36 across 14 hard games, inside the
noise this file records. 404 tests green, including one that pins the alert's tone
and that it names the sum.

Not changed: `maxBailouts` stays at 3. The mechanic reaches bankruptcy on schedule
once it is visible, and cutting it would undo the rival-survival work of 2026-07-29.

### The field was under-capitalised on the setting meant to make it fierce — 2026-07-30

Player, on hard, in Q2 2032: "Nobody is competing with me on my routes and I'm
ranked #1. The game is too easy."

**Every balance figure in this file up to now was measured against the stub
fixture, and the fixture is a weak player.** It was dying in 12 of 14 hard games
while the owner sat at #1 in the same setting. Tuning "hard" against it was
tuning against the wrong opponent, and that — not any single mechanic — is why
hard kept coming out easy for a competent human.

Measuring what the FIELD actually builds by turn 25 rather than whether the
fixture survives:

| | |
|---|---|
| median rival fleet | 6 aircraft |
| rivals with 10+ aircraft | 26% |
| games where NO rival reached 10 aircraft | 4 of 14 |
| aircraft per rival route | 1.8, where the optimum build is ~6 |

A field of six-aircraft carriers cannot contest anybody. And the cause was an
inversion of exactly the kind this file keeps recording: **`startingCash` scaled
only the PLAYER's bank.** Rival capital was a flat archetype figure whatever the
level — so hard handed rivals no more money while making the world they had to
grow in thinner (demand 0.85, yield 0.90). The setting meant to field a fierce
field left it under-capitalised, and sometimes it never developed at all: the
largest rival at turn 25 was 73 aircraft in one game and 2 in another.

New `rivalCapital` knob (easy 0.8, medium 1, hard 3.2), swept:

| rivalCapital | median rival fleet | rivals 10+ | dud fields | player #1 |
|---|---|---|---|---|
| 1.0 (as shipped) | 6 | 26% | 4/14 | 1/14 |
| 1.6 | 7 | 42% | 3/14 | 1/14 |
| 2.4 | 10 | 53% | 2/14 | 0/14 |
| **3.2** | **17** | **69%** | **1/14** | **0/14** |
| 4.0 | 16 | 75% | 1/14 | 0/14 |

**Result on hard:** markets with a single carrier fall from 86.2% to **76.5%**,
two-carrier markets rise to **21.3%** and three-carrier markets to **2.2%** — the
first time contested markets have been common. Rival failures fall 40 -> 32
because a well-funded carrier survives a downturn. Median route margin 17.0%.

**And hard is now genuinely lethal**: the fixture is destroyed around turn 14 in
four games of five, against reaching the full horizon on medium.

**That broke three guards, and the reason is instructive.** All three read the
field at turn 20 — which hard no longer reaches, so they were comparing
survivorship, not the field: hard scored 10.4 markets against medium's 31 purely
because four games in five had already ended before the reading. The window is now
turn 12, inside every level's lifetime, so the levels are compared like with like.
This is the third time a guard here has failed a correct change by measuring the
wrong quantity; the pattern is always the same, an outcome metric standing in for
a behaviour one.

Medium (13/20) and easy (19/20) are unchanged — `rivalCapital` is 1.0 and 0.8
there. 403 tests green, structural audit clean, determinism holds.

### Airlines were dealt homes with no sense of the map — 2026-07-30

Player feedback: "A hard game started in 2026, and in Q2 2032 there are literally
no AI players with routes in the US. Should never happen."

**Not reproduced as stated, and worth saying so plainly.** Across 30 hard games
with the player homed in each of ten US cities, every single one had rival routes
touching North America at turn 25 — 3 to 50 of them. But the investigation found
the mechanism that makes it possible, and it is real.

`chooseHome` picked uniformly from whatever matched an archetype's weight and
population taste, with **no sense of the map at all**. With nine regions and a
cast of eight to twelve, a field with nobody in North America is a perfectly
ordinary roll, and once dealt it is permanent: homes are chosen when a carrier
enters and never revisited. A player based there then flies for years without
meeting anyone, which is exactly the report.

Homes are now weighted by **opportunity over crowding**: a region's share of world
`pop x weight` — the same product the gravity model uses, so "where airlines form"
agrees with "where the passengers are" — divided by the carriers already there.
The player counts toward that load, so a player's own region draws neighbours like
any other.

**Two wrong turns on the way, both measured.** Weighting purely on emptiness
(`1/(1+n)`) was worse than doing nothing: the regions with no carriers are mostly
the economically thin ones, so it seeded airlines into markets that could not
support them and the live field fell from ten carriers to two, with rival routes
at a US hub dropping from 89 to 6. And a linear crowding divisor was too strong
for a large field — on hard, which deals 1.25x the rivals, it pushed them out of
the rich regions fast enough to cut sectors opened by a third and failed all three
difficulty guards. The exponent is 0.7, chosen because 0.35 and 0.7 both passed
the guards while only 0.7 also gave zero games with an empty North America.

**Also measured, and left alone.** A dominant incumbent repels entry hard: pricing
a rival's entry into NYC–CHI gives $16.41M against an empty market and $2.33M
against a twelve-aircraft incumbent, an 86% deterrent that `playerFocus` of 1.9
cannot come close to closing. Entering at scale barely helps — a contested market
yields $1.49-2.00M per aircraft against a virgin market's $5.36-5.50M, a 3x gap at
every entry size. With ~20,000 city pairs on the map there is always somewhere
quieter to go, so a profit-maximising carrier is being RATIONAL when it declines
to attack a strong player. Closing that needs a scarcer map or the deferred slot
mechanic, not another multiplier — the same conclusion the trunk-market work
reached from the other side.

**Note for an existing save:** homes are assigned when a carrier enters, so a game
already past its entry schedule keeps the cast it was dealt. This reaches a game
started after the change.

403 tests green; medium 13/20 and easy 20/20 survival unchanged.

### Everyone could see only their own hubs, so the best markets went unflown — 2026-07-30

Player feedback: "Hardly anyone competes with me. They never take the best routes —
NYC to LON should be a no-brainer and nobody opens it. And only ever ONE airline
competes with me; some routes should have 3-5, like real life."

Measured over 10 hard games, all three were true and two shared a cause.

**97.9% of served markets ended with exactly one carrier.** 2.1% had two. None
ever held three. And the richest pairs on the map were never flown at all — Tokyo–
Osaka (217k/wk), London–Paris (137k), New York–Washington (107k): 0 of 10 games.

**Route discovery was entirely hub-anchored.** `bestNewSector` searched from a
carrier's own cities, and `bestIncursion` had
`if (!reachable.has(target.from) && !reachable.has(target.to)) continue` — so a
market was invisible unless the carrier ALREADY touched one endpoint. The set of
carriers that could even see a given pair was tiny, which is both why the trunk
routes went unflown and why nobody ever joined one. Every carrier now also weighs
the world's richest pairs (`ai.trunkMarkets`, 40), wherever it is based: opening a
base to fight for a top market is what airlines do, and the candidate still has to
clear the same appraisal as everything else.

**Nobody would join a market, because company was punished like overcapacity.**
`competitionLoadPenalty` scaled on rivals' share of capacity and nothing else, so
on a pair with 434,000 passengers a week three carriers between them serving a
seventh of the demand were penalised as though scrapping over the last few seats.
It is now scaled by SATURATION — how much of the market's demand the industry's
seats actually cover — so a roomy market carries more carriers and an oversupplied
one still empties everyone's aeroplanes.

**And every archetype refused sectors the engine allowed.** Floors were 400km
(ULCC, roll-up), 500km (legacy) against `routes.minDistanceKm` of 250, which made
the dense short-haul corridors structurally invisible. ULCC now goes to 260,
roll-up 280, legacy 400. `maxOrigins` went 4 -> 7.

**Plus two knobs.** `fare.monopolyPremium` 0.28 -> 0.18 with `competitionHalfShare`
0.35 -> 0.50: being alone was a 28% yield windfall, which both made monopolies too
profitable (the previous complaint) and made sharing look ruinous by comparison. A
carrier with moves to spare now also spends its first TWO on contesting rather than
one, at a lower bar — because a carrier is limited by AIRCRAFT, not demand, so on
pure cash a thin monopoly beats a share of a dense market nearly every time.

**After:**

| | before | after |
|---|---|---|
| markets with one carrier | 97.9% | 86.2% |
| markets with two | 2.1% | 13.3% |
| markets with three or four | 0% | 0.4% |
| player's markets shared with anyone | 22% | 87% |
| median route margin, hard | 27.8% | 20.3% |
| Seoul–Tokyo served | — | 7/10 games, 2.0 carriers |
| Shanghai–Tokyo served | — | 9/10 games, 1.7 carriers |

**Honest limits.** Six of the 25 richest pairs are still never flown and should be:
Shenzhen–Hong Kong (27km), Osaka–Nagoya (140km), New York–Philadelphia (130km) and
their like sit below `routes.minDistanceKm`, where the game says surface transport
wins. That is a deliberate rule, not a defect.

**And the depth target is not met.** "Three to five carriers on a trunk route" is
still rare — 0.4% of markets. The structural reason is that a carrier is limited by
aircraft rather than demand, and the map offers ~20,000 city pairs: spreading into
a quiet one beats sharing a loud one almost every time, however rich it is. Closing
that properly needs either a scarcer map or a real slot constraint (the deferred
slot-scarcity item above), not another multiplier. A smaller trunk pool was tried —
`trunkMarkets` 20 and 12 — and bought a little depth at the cost of thinning metal
per route 14% below medium, undoing the previous round's work; 40 is the balance.

**Two guards had to be re-specified, not relaxed.** `has more of the board flying
on hard` counted rival sectors standing, which stopped describing the goal once
carriers could see the whole map: hard now expands by BREADTH (38.4 markets against
medium's 27.8 at turn 20) while medium concentrates on fewer. It now asserts markets
reached. `puts more metal on a rival route` became a floor at 90% of medium, because
the same fleet spread over more markets converged the two (1.49 against 1.51) — a
real trade of the discovery work, recorded rather than hidden.

Medium remains the tuned baseline: 13/20 survived, easy 19/20. 403 tests green.

### The retreat spiral, not the recession, was killing the field — 2026-07-29

Player feedback after the difficulty work: "It's still too easy. The downturns kill
the AI players. Routes are too profitable, and AI players are too stupid."

All three measured true, 14 games a level.

**Downturns kill the AI: 100% of the 62 rival failures on hard happened while an
event was running**, and rivals dropped 503 sectors during events. Two causes,
both structural rather than tuning.

*The bailout backstop never fired in a present-day game.* Only `sept11` and
`covid` carried `crisis: true`, and both are history-scenario scripted events. So
the mechanism written to stop a downturn wiping the industry out was unreachable
in the default scenario, while `recession` runs demand 0.8 and fare 0.9 for up to
TWELVE quarters. Both `recession` and `pandemic` are now crises: bailouts are
capped at three per carrier and booked as debt, so a slump is survivable but
scarring — which is the design that already existed, finally reaching the game
most people play.

*A rival could not borrow in a downturn, by rule.* `maybeBorrow` opened with
`if (trailingEarnings <= 0) return state; // only the profitable lever up` — right
for borrowing to GROW, exactly wrong for borrowing to SURVIVE, which is what an
airline does precisely BECAUSE it is losing money. So a rival in a recession
raised nothing, fell under its reserve, and retreated. Split in two: a liquidity
draw capped at the reserve it restores, which cannot fund growth through a slump.

*And `retreat` cut on today's cash alone.* It fires whenever cash dips below the
carrier's comfort buffer — a positive number, far above insolvency — so through a
three-year recession a solvent rival shed one sector a quarter, lost that revenue,
and shed the next. It now applies the same both-tests rule `pruneLosers` already
used: a sector is abandoned only when it fails THIS quarter AND over the horizon,
and the horizon discounts a temporary shock to the quarters it has left. Sectors
shed during events on hard: **503 -> 373**. Rival failures: **62 -> 49**.

**Routes were too profitable, and `demand` could not fix it.** Hard's median route
margin was 27.8% against medium's 31.0% despite demand at 0.85 — because most
sectors are capacity-constrained rather than demand-constrained (docs/demand-audit.md),
so thinning traffic mostly removes spill nobody was carrying. New `yield` knob
(easy 1.08, medium 1, hard 0.90) scales the fare every carrier clears, which
reaches the money directly. Hard median route margin is now **23.3%**.

**And the AI was stupid in a specific, measurable way: absolute thresholds in a
scaled world.** Two of them, found by the field going QUIETER as the world got
harsher. `minProjectedNetPerQuarter` is a fixed dollar bar, so a thinner-yield
world filtered out more candidates; `expandAboveCash` is a fixed cash gate, so a
carrier that banks slower sits under it longer. Both now scale with `yield` —
sign-aware, because a flag carrier's bar is negative and scaling a negative the
naive way raises it. The safety reserve is deliberately NOT scaled: a leaner world
is a reason to grow at a lower cash bar, not to hold a smaller cushion.

**After**, 14 games a level:

| | rival failures | shed in events | median route margin | fixture died |
|---|---|---|---|---|
| medium | 18 -> **13** | 239 -> **181** | 31.0% -> 30.9% | 8/14 -> 7/14 |
| hard | 62 -> **49** | 503 -> **373** | 27.8% -> **23.3%** | 11/14 -> **12/14** |

Hard now opens the most sectors of any level (**85.0 ever opened** against medium's
83.2 and easy's 64.8) and stands **39.2** rival sectors at turn 20 against medium's
30.6 — while its rivals die a third less often and its routes make a quarter less
money. The fixture survives 2 of 14 games.

**A test that measured the wrong quantity.** `difficulty actually reaches the
field` compared rival sectors STANDING at turn 40, and failed this change: hard
fields fewer at that moment because hard also fails three times as many carriers,
and a failed carrier's routes leave the market. Stock, used for a flow claim. It
now asserts on sectors ever OPENED and on the standing field at turn 20, before
attrition muddies the count — the quantity "expands faster" actually means, and
the one a player feels. 403 tests green.

### Hard was the gentlest setting, and every constant said otherwise — 2026-07-28

Player feedback: "AI players should be much more aggressive on hard. They should be
opening routes much faster, putting more aircraft on routes, and trying to buy my
stock. None of it is happening."

**Measured, and the first two were inverted.** 12 games a level, full horizon:

| level | rival routes @20 | @40 | end | a/c per route | player survived |
|---|---|---|---|---|---|
| easy | 49.0 | 110.0 | 236.3 | 1.91 | 67% |
| medium | 40.0 | 92.3 | 243.3 | 1.61 | 42% |
| hard | **31.9** | **68.8** | **180.5** | **1.48** | 33% |

Hard opened routes a third slower than EASY and put less metal on them.

**The cause is one line, and it is a ceiling rather than a threshold.** A rival's
turn ended with `const pick = options.sort(...)[0]` — at most ONE growth move a
quarter: a sector, a raid, or an aircraft. `aggression` (1.35 on hard) only lowers
the bar a move must clear; it cannot make a carrier move twice. So a harsher world
— demand 0.85, contestPressure 1.6 — made rivals fail the bar more often against an
unchanged ceiling, and the harder the setting the slower the field grew. Every
difficulty constant was correctly ordered the whole time, which is why the existing
tests passed: they assert the KNOBS, never the behaviour.

Fixed with a `growthActions` difficulty knob (easy 1, medium 1, hard 3): the growth
block loops, each pass judged against the board the last one changed, stopping on
cash or on a move that no longer clears the bar. A fast field, not a reckless one.

**That alone made hard EASIER**, 33% -> 50% survival, above medium's 42%: a bigger,
faster field simply spread out over virgin markets and left the player alone. Pillar
4 says success attracts sharks, so the teeth needed their own knob — `playerFocus`
(easy 0.6, medium 1, hard 1.9) scaling how much harder a rival is drawn to a market
the PLAYER flies. Raising `stockActivity` past 1.9 was tried and reverted: it drains
into stock the cash that opens routes, and cost more pace than it bought appetite.

**That still did not reach the player, and the reason took two more findings.**
Player report after playing the fix: "2029, nobody has even started competing with
me and I'm ranked #1." Measuring what a player actually SEES, 16 games a level:

| turn 12 (2029) | rivals in | rival routes | someone on YOUR market |
|---|---|---|---|
| easy | 5.2 | 20.1 | 13% |
| medium | 5.3 | 19.1 | 44% |
| hard | **4.2** | 22.8 | **38%** |

Hard had FEWER rivals on the board at year three than medium, and in 62% of games
nobody had touched the player's markets.

**Nothing scaled how fast the cast ARRIVES.** `firstEntryTurn` (3) and the 3-9
entry gap were difficulty-independent; `rivalCount` only decides how many rivals a
game has, so hard dealt more carriers onto exactly the same queue. Worse, the
early-entry accelerator triggers on trailing PLAYER PROFIT — and on a thinner world
the player earns less, so the pillar-4 "success attracts sharks" mechanism ran
BACKWARDS with difficulty. New `entryPace` knob (easy 0.7, medium 1, hard 2)
divides both the first entry turn and the gap, and lowers the attention threshold.

**And rivals still would not fight, because a raid can never win on profit.** An
empty market is worth more than a shared one by construction, and the harder the
setting the truer that gets — `contestPressure` 1.6 makes a contested route emptier,
so hard rivals had the strongest possible reason to leave the player alone. Scaling
the raid's score cannot fix that: measured, `playerFocus` 1.9 -> 3.0 -> 4.5 moved
the share of games where anyone contested the player by **nothing at all**.

Two changes. First, a real sign bug in `bestIncursion`: `appraise(...) * appetite *
focus` multiplies a NEGATIVE appraisal, so a bolder carrier avoided a marginal fight
harder — the same trap `effectiveConfig` already documents for the flag carrier's
loss tolerance. Willingness now divides a negative and multiplies a positive.
(Correct, but it moved no metric on its own: a negative raid never beat a positive
virgin sector anyway.) Second, and the one that worked: **appetite gets a slot
rather than a multiplier.** A carrier with more than one move a quarter spends its
FIRST on contesting someone, if a contest clears its bar and is worth at least half
the best alternative. Reserving the slot for ANY viable raid was tried and cost the
field two carriers over a run — they picked fights worth a fraction of what they
passed over.

**After**, same seeds. What a player sees, at turn 12 and turn 20:

| | rivals in @12 | rival routes @12 | on YOUR market @12 | @20 |
|---|---|---|---|---|
| easy | 5.2 | 20.1 | 13% | 27% |
| medium | 5.3 | 19.1 | 44% | 38% |
| hard | **7.2** | **42.6** | **44%** | **50%** |

And over full games: hard fields **79.5** rival routes by turn 20 against medium's
40.0, first rival route on turn **3.0** against 3.9, largest stake taken in the
player **38.8%** against 23.9%.

**Hard is now lethal for the balance fixture: 0 of 12 games survived**, against
medium 42% and easy 100%. That is a steeper curve than this project has ever shipped
and it is deliberately left there for the owner to judge — the fixture is a stub, not
a person, so 0% for it is not 0% for a player, but if hard proves punishing rather
than hard the first knob to pull back is `entryPace` and the second is `growthActions`.
Note also that hard's late-game route counts now read LOWER than medium's purely
because hard games END sooner; the turn-20 figures are the honest comparison.

**The third complaint was not a bug.** Rivals were already buying player stock in
83% of medium games and 92% of hard ones, reaching ~30% of the company. What the
player never got was a warning proportionate to that: the briefing only escalates a
stake to a `danger` alert at 40%, so a rival crossing a quarter of the company
produced one `warn` line among several. Left as-is pending the owner's call — the
behaviour is real and the fix is a threshold, not a mechanic.

**Regression guard.** `tests/difficulty.test.ts` gains three assertions that run
actual games and compare the FIELD, not the settings — hard must expand faster than
medium, fly more metal per route, and not fall behind easy. The old tests all passed
throughout the inversion. 402 tests green.

### A review pass: phantom aircraft, seed zero, and 2.7x off the clock — 2026-07-27

Five defects found by reading the code against the model it claims to implement.
Two of them had been quietly shaping every balance figure since Phase 4.

**Ordered aircraft were already competing.** `buildMarketIndex` grouped every tail
with a `routeId` into the presence that drives share splits and the monopoly fare
premium, and never checked `deliversTurn` — while the settlement beside it did,
explicitly. So the two disagreed. A carrier with nothing delivered still read 3,401
seats a week on the market, and ordering a second frame doubled it. The metal won
share it had no capacity to seat, so the demand was spilled and (per the open
spill note above) deleted; the rivals it was taken from simply lost it. Delivery
lead times arrived 2026-07-22 to make fleet planning cost something, and this had
been refunding it ever since — for rivals as much as the player, since they order
on the same clock. **Before: 30/60 games survived across three seed sets (10, 9,
11). After: 24/60 (8, 10, 6).** The noise floor on a single 20-game read is ±2, so
only the aggregate means anything: the game is modestly harder, because rivals no
longer lose demand to aircraft that do not exist. Medium now sits nearer 8/20 than
the 10/20 it was tuned to. Whether to give `contestPressure` back what was taken
is a tuning decision and deliberately not made here.

**Every new player got seed 0.** `Number(params.get('seed'))` — and `Number(null)`
is 0, which is an integer and not negative, so it passed the guard. A first visit
with no share link set `pendingSeed = 0` and announced "Shared game 0". Invisible
after the first game, because the autosave suppresses the path, so every player's
first world was the same one and nobody could see why.

**62% of the runtime was re-scanning history.** `trailingEarnings`,
`operatingEarnings` and `growthFactor` each filtered the whole history array to
keep the last four or eight rows, and they sit under `sharePrice`, `creditRating`
and `interestRate`, so one valuation cost O(holdings x history). They now walk back
from the end and stop. Order is preserved deliberately — floating-point addition is
not associative, and summing newest-first would have moved results in the last bits
and broken the byte-identical reproducibility the save tests assert. Output is
identical across three seed sets. A second pass memoizes the walk on the history
array itself: a carrier that has stopped trading never gets another row, so the
walk never fills its quota and reads everything — 2.9% of calls, a third of all
rows scanned. Keying on the array is sound because the engine replaces history
rather than pushing to it. **A 200-turn game: 5,306ms -> 1,993ms. The test suite:
148s -> 35s.** The profile is now flat, with no function above 9%.

**An import accepted structurally-valid nonsense.** The shape check never asked
whether numbers were numbers, so a hand-edited save loaded clean and `cash` of
`"plenty"` became `"plenty0"` on the first settlement — string concatenation, not
arithmetic — while `fuelPrice` went NaN and spread. Checked at the door now, where
it can still be reported as a bad file. Not a security matter: the only person who
can feed you that file is you, and nothing in a save executes.

**And the export may have raced its own download** — `URL.revokeObjectURL` fired
synchronously after `click()`, which some browsers lose. Deferred a tick.

Two smaller things while in there: the slot cap is enforced in `saveSlot` and not
only on the button that calls it (overwriting at the cap is still fine, minting a
new one is not), and the migration ladder is back in ascending order with each
comment attached to the migration it describes, plus a load-time check that the
ladder has no gaps — the same idiom demand.ts uses on its seasonality table.

389 tests green, up from 385: the delivery rule, the three save-validation cases.
An invariant audit over 30 full 200-turn games on hard — orphaned tails, tails
flying another carrier's route, NaN, over-issued shares — came back clean, and
rival order books stay sane after the delivery fix (max 7 pending, mean 1.27).

### Bounded sidebar panes, not tabs — 2026-07-27

A player asked about putting the sidebar sections behind tabs, since a long route
list pushes everything down.

**The cause is narrower than it looks.** The fleet list is already grouped by type
and ownership, so it stays about five rows however many aircraft are owned, and the
rival list caps at twelve. The route ledger is the only unbounded list in the rail:
one row per sector at ~31px, so a 25-route network is ~775px of ledger sitting above
three more panels, and Fleet ends up a screen and a half down.

**Tabs were the wrong instrument for it.** The loop is cross-referential — you read
a sector's net, then check whether you have idle metal and who is contesting it.
Tabs put a click between those, and §8 explicitly wants density ("a game for people
who like annual reports"). Tabs fix length by hiding, which fights the whole design.

Instead each panel takes a weighted share of the rail (schedule 5, competition 2,
fleet 2, conditions natural) and scrolls INSIDE it, so all four headings are on
screen whatever the network looks like and nothing is behind a click. The ledger's
column headers are sticky over their own pane. `overflow-y: auto` stays on the
container as a fallback: where the panes' minimums do not fit, the rail scrolls as
it used to rather than crushing every panel. Budgeted the minimums against real
window heights — 170/88/88 plus conditions fits from 720px up, so a 1366x768 laptop
keeps all four; only genuinely short windows fall back.

Two things the change forced. "Read their books" was being appended INSIDE the rival
list, so once that list scrolled the button would have scrolled away with it — it is
now a static control below the pane, like "Acquire aircraft". And below 900px the
board already stacks and the page itself scrolls, where bounded panes would nest a
scroller inside a scrolling page; the media query now unwinds the flex sizing, the
inner overflow and the sticky header, so narrow viewports keep their natural-height
column. Verified in the built CSS that all four resets are scoped inside the query.

### Phase 5 closed out: keys, sharing, slots, coaching, sound — 2026-07-25

The five remaining polish items, all built to the same rule — decoration may never
be load-bearing, so every one of them degrades to nothing without breaking a game.

- **Keyboard shortcuts.** Enter closes the books; T/R/F/Y open treasury, rivals,
  the aircraft market and technology; +/− zoom; Escape backs out one step at a
  time; `?` prints the list. Unmodified single keys, but suppressed while a field
  has focus or a dialog is open, so a shortcut can never fire under a modal the
  player thinks they are answering.
- **Seed sharing.** The game is a pure function of (seed, scenario, difficulty,
  home city), so a link carrying those four IS the game — same rivals, same shocks,
  same aircraft timeline. Share copies one; opening one preselects the settings and
  holds the seed for the city you pick. It never overwrites a game in progress: a
  resumed autosave wins, and the link applies on the next New game. Falls back to a
  prompt when the clipboard is blocked, so the link is never simply lost.
- **Save slots.** The autosave is a safety net you never think about; a slot is a
  decision — the save before betting the company on a widebody order, so you can
  come back and play the other branch of the same seeded world. Same serialized
  format, so a slot migrates exactly as an autosave does, and `listSlots` reads only
  the header, so a slot written by an older build still lists and still says what it
  is even when it would need migrating to open.
- **First-turn coaching, not a tutorial.** Five notes anchored to real controls.
  Keyed to GAME STATE rather than to clicks, so a player who works a step out for
  themselves never sees the note telling them to do it. Never blocks, never takes
  the controls; one dismissal ends the sequence for good. Writing the test found the
  flaw: a player three quarters in who had deliberately bought no aircraft was
  nagged about it forever, so the whole sequence now retires after two quarters
  however much of it went unread.
- **Sound, off by default.** Synthesised with a pair of WebAudio oscillators rather
  than sampled: no audio files, no dependency, still builds in ten years — the same
  reasoning that keeps the map in SVG. Verified the shipped assets are still exactly
  one JS and one CSS file. A dry, narrow palette — a click per split-flap leaf as it
  lands, a two-note terminal chime that rises on a profitable quarter and falls on a
  loss. Nothing loops; the audio context is not even created until the switch is
  thrown, which is also the only moment a browser would allow it.

385 tests green. Phase 5's remaining backlog is empty.

### Rivals plan over a horizon, and a tuner to prove it — 2026-07-25

A player asked whether the rival brains could be made smarter, "maybe using AI".

**Runtime LLM: no, and the reasons are this project's own rules.** Pillar 6 requires
same seed + same inputs = same game; a model is non-deterministic and drifts under
you. The non-goals forbid server-side anything, so a call needs a backend or an API
key shipped in the browser. It is free and unmonetised, so per-token cost per player
does not fit. And the headless suite — tens of thousands of decisions per run, each
fanning out into thousands of route/aircraft evaluations — is the balance
instrument; making it network-bound would end it. AI belongs OFFLINE, producing
deterministic artifacts.

**The actual defect: no horizon.** `probe()` — the one function behind opening
sectors, contesting them, reinforcing them AND closing them — returned a single
quarter's cash at today's spot fuel. Carriers judged fifteen-year aircraft on this
quarter's fuel price, piling into markets during a glut and abandoning them when it
passed. Churn that read as stupidity.

Split in two. `probe` still prices today's reality — the right question when
deciding to CLOSE something, because that is the cash the bank sees. New `appraise`
prices an INVESTMENT over `ai.appraisalQuarters` (8), where fuel is pulled toward
its long-run anchor (closed form from the sim's own reversion rate, so a spike is
discounted by exactly as much as the model says it decays) and a temporary shock
counts only for the quarters it has left. Technology, being permanent, counts in
full. A hedge is deliberately excluded — a four-quarter financial position should
not price a decade of flying.

**The review loop earned its keep.** The first A/B said the horizon was worthless
(39.4% vs 39.0% share, inside noise). Reviewing the diff turned up three real
defects: `pruneLosers` still cut on today's numbers alone, so a carrier opened a
route looking through a shock and closed it two quarters later on the very numbers
it had decided to ride; the prune's appraisal ignored the carrier's own horizon,
so the control arm of the A/B was getting half the treatment; and the stub fixture
passed no config, so it never got the cut-when-broke escape. With all three fixed
the same A/B is decisive: **legacy on an 8-quarter horizon takes 18.9% of industry
value against 9.8% on a 1-quarter horizon, with survival 61% -> 76%.** A sector is
now only cut when it fails on BOTH the quarter and the horizon.

**`npm run tune` — the offline instrument.** `compare` A/Bs one knob head to head,
giving it to ONE archetype and leaving the rest at baseline, so it measures whether
a change WINS rather than whether the world moved — the distinction that exposed the
broken plumbing above. `search` walks (knob, direction) pairs by coordinate descent
(random sampling spent every iteration on one knob and never tried the other),
scoring an archetype's share of industry value and rejecting outright any candidate
that pushes anyone past 60% — §9 enforced in the tuner itself. It writes nothing;
it prints numbers a human pastes after re-running the suite. The in-process override
hook it needs is empty in every real game, and a test asserts it.

**Balance, honestly.** Smarter rivals are harder rivals: medium fell from 14/20 to
8/20 on the fixture. Pulling medium's `contestPressure` 0.35 -> 0.22 — withdrawing
artificial pressure now that the opposition is genuinely better — brings it to
~10/20, load ~37%. It is still harder than before, and that is the honest trade for
rivals that plan. Also measured the noise floor first: the SAME configuration across
three seed sets gives 10/20, 11/20 and 8/20 with medians $432M, $1809M and $0M, so a
single 20-game reading cannot separate 8 from 10 and none of these knobs deserves
finer tuning than that. Present: easy 16/20, medium 10/20, hard 8/20. 377 tests green.

### Dividends were valued twice, and mergers needed a regulator — 2026-07-25

A player asked whether market cap was buggy because theirs kept climbing. It was.

**The bug: investment income under the operating multiple.** `netIncome` includes
dividends received on stakes, and `trailingEarnings` fed that straight into the 9x
franchise term — while `holdingsValue` was *already* carrying the stake at market.
The same asset was counted twice. Isolated it with two otherwise identical carriers
earning $40M a year: from operations, cap $560M; as dividends from a stake, cap
$920M. Fixed with `operatingEarnings` (net income less dividends received), used by
the franchise multiple and `growthFactor`. Both cases now value at $560M.
`trailingEarnings` is unchanged everywhere else — solvency, credit rating, "is this
carrier profitable" — because there the cash that actually arrives is the right
measure. Buying a stake was already correctly cap-neutral (cash swapped for an
asset) and still is; no save migration, since `dividendIncome` was already optional.

**A monopoly the invariants missed.** The valuation change shifted every AI decision
and shook out a latent regression: history seed 105 ended with ONE survivor holding
276 of 276 rival routes after 16 takeovers — a §9 violation created by making legacy
and flag carriers acquisitive. It only showed in the 200-turn history scenario; the
100-turn present games never ran long enough to snowball. Added
`finance.minCarriersAfterMerger` (5): an AI will not complete a deal that would leave
fewer solvent carriers than that — merger review, exactly as regulators block airline
mergers. **Not applied to the player**, whose victory by clearing the board is a
designed win condition: a player consolidating the industry is winning, an AI doing
it is a broken world. All six history seeds now recover, top carrier share peaks at
46% (was 100%), and M&A stays lively at 13 acquisitions on the consolidating seeds.

**A guardrail that measured the wrong thing.** The "games differ meaningfully" test
divided the interquartile range by the MEDIAN, and with takeover now a real loss
condition outcomes are bimodal — a seized carrier finishes at exactly zero, a
survivor in the billions. Nine of twenty games ending at 0 put the median on 0 and
read as "no variety" when the spread was in fact maximal
(`[-9, -5, 0x9, 6, 950, ... 19136]` $M). Rescaled to mean magnitude, which has no
such blind spot, and added an assertion that games must end for different *reasons*.

Present benchmark after all of it: easy 12/20 (median $6950M), medium 14/20
($2980M), hard 5/20 ($0M, load 16%). 368 tests green.

### The free float is visible, and greenmail is the buy-back — 2026-07-25

Two asks: show how many shares each carrier has available, and let the player buy
back their own stock.

**Free float.** A new column in the stock table (and "Your free float" in your own
figures) shows the shares no carrier holds — which is all anyone can still buy, and
therefore the ceiling on any raid. It was invisible before, so a capped purchase had
no visible explanation; it also explains why a subsidiary can be unreachable (a
parent holding 60% leaves only 40% buyable, so control can never be bought on the
market). Greyed out below 50%, where control is no longer purchasable at all.

**A plain buy-back would have been a trap, so it was not built.** Measured against
the real model: a repurchase at fair value is exactly price-NEUTRAL (you retire
precisely the value you spend), it lowers your market cap — which *is* the score —
and because a non-selling raider's shares become a bigger slice of a smaller
company, it *raises* their stake. Buying back 20% took a raider from 40% to 55.6%
and handed them control. It is an anti-defense.

**Greenmail instead.** New `BUY_BACK_STAKE` action: pay one shareholder
`greenmailPremium` (1.4x market) for their entire stake in you, and retire it. The
premium sits above `acquisitionPremium` because the raider knows you are the
desperate party. Retired rather than held, so they cannot buy back in cheaply from a
float you just refilled — though nothing stops them re-accumulating later at market
having sold to you high, which is precisely the criticism greenmail attracted in the
1980s. Costs are real and stack: the cash is gone, market cap falls by what you
paid, the smaller share count lifts every *remaining* holder's percentage (the
confirm dialog spells this out, and warns when it would hand the next raider
control), and it permanently reduces how much equity you may still issue against the
authorized ceiling. It joins dilution-by-issuance as the second, more surgical
defense. AI carriers do not use it yet — they still defend by diluting.

367 tests green; new tests pin the buy-out, the concentration side effect, and the
funding/non-holder guards.

### Rivals commit to a fight — the real reason hard was easy — 2026-07-25

Hard was still easy after the load-penalty work: "I never feel like my routes are
going to fail... my routes are minting money, even when other companies compete with
me."

**The diagnosis was not the economics.** Instrumented a *good* player (8 fattest
routes from a hub, 4 jets each, 60 turns) rather than the headless stub, and the
mechanics were fine when contested — a rival with 4 aircraft against 12 already took
the route from a 37% margin to 11%, and 8 aircraft made it negative. Entry was also
plainly profitable for the entrant ($5.3M/qtr, above every archetype's bar). The
failure was **persistence**: on one seed 6 of the player's 8 routes had been
contested at some point, but only **1 was contested at the end**. `pruneLosers`
closed any route that printed a single negative quarter, so an entrant into a market
the player already dominated got squeezed out in a quarter or two. The player won
every war of attrition by default, and competition never lasted long enough to bite.

**Fix: a route commitment window.** `routes.commitmentQuarters` (7, scaled by the
difficulty `contestPressure` mod) stops an AI closing a sector it opened recently —
a route ramp-up period, which is what real airlines do (18-24 months before judging
a new route, eating losses to build share in a market they have decided to contest).
Escape hatch: a carrier that has fallen below its own cash reserve cuts anyway, so
commitment is not a suicide pact and the field does not bankrupt itself. Commitment
runs 1 quarter on easy, 2 on medium, **11 on hard**.

Also raised hard's `contestPressure` 1.15 -> 1.6 (load penalty 0.48, and the longer
dig-in above).

**Effect on the same good-player probe (hard):** routes now stay contested (8/8 on
several seeds, rivals holding 63-70% of market capacity), and the outcomes spread
from −$15.3M/qtr and −$9.0M/qtr *route losses* and one takeover, through +$12.6M, to
+$93M on a lucky seed. Routes fail now.

**Medium is untouched** — the 20-game present benchmark is byte-identical to before
(13/20 survived, median $2122.3M, load 46%, 9.0 rivals). Easy 18/20 / $8.9B. Hard
5/20, median $0, load 22%, 8.7 rivals alive — punishing but not a collapsed world.
All 26 regression invariants and §9 hold; new tests pin the commitment window, its
reserve-cash escape hatch, and that hard digs in longer than medium.

### Competition you can feel, and a stock frenzy on hard — 2026-07-25

A player on hard: "there's really no competition — even where I compete, there's no
noticeable difference when a rival enters. Certain routes should become
unprofitable." And separately: "on hard nobody is buying anybody's stock; it should
be a feeding frenzy."

**Why entry was invisible.** Measured it: on a big trunk (LON–IST, ~63k pax/wk) an
EQUAL rival took 0% of the incumbent's passengers — you stayed 88% full — because
the market so dwarfs a few aircraft that you're always capacity-constrained and just
fill from the huge spill. The only effect was an 11% fare dip. Share loss never
became traffic loss; you'd need 3–4 rivals before a plane flew emptier.

**Fix: overcapacity bites LOAD, not just fare.** New `share.competitionLoadPenalty`
scales the load ceiling by `(1 - penalty * rivalCapacityShare)`. A contested route
now flies emptier however large the market — the thing that makes a competitor's
entry felt. Carried through `Conditions` so it is **difficulty-scaled** by a new
`contestPressure` mod (easy 0.045 effective, medium 0.105, hard 0.345): one equal
rival now costs about −28% profit on easy, −33% on medium, **−52% on hard** (load
88%→73%), and a second or third rival pushes a hard route into the red — exactly the
ask. Medium stays close to its old balance (present 20-game: 13/20 survive, median
$2.1B vs the old 14/20, $2.4B); hard sharpens hard (7/20, median $0, load 20% for
the stub — a skilled human survives by flying uncontested secondary markets rather
than the trunk bloodbaths).

**The tension, and its resolution.** A load penalty makes entering a contested
market less profitable, so rivals initially avoided overlap and the "carriers
contest each other" invariant broke. Rather than globally cranking aggression (which
wrecked medium — a first pass took its median from $2.4B to $20M), the entry drive
is difficulty-scaled: incursion appetites left at baseline, `playerFocusMultiplier`
nudged 1.9→2.1, and the difficulty `aggression` mod (hard 1.2→1.35) does the rest —
so hard rivals hunt the player's routes (focus 2.8) while medium plays as before.

**Stock frenzy: `stockActivity` mod** (easy 0.5, medium 1.0, hard 1.9) scales how
often non-roll-ups take stakes and how often acquirers open campaigns, and lowers
the surplus-cash bar to buy as it rises — so hard carriers speculate with thinner
buffers. Present 6-game: hard runs ~142 quarters with fresh stake purchases vs
medium's 111, and 7–14 of the field holding stakes. On hard the register is a market.

All 26 regression invariants hold; §9 intact (no monopoly). New tests pin the load
penalty (a contested route flies emptier and earns less) and the difficulty scaling.

### The stock market buys, and buys out — 2026-07-24

A player, doing well, noticed nobody ever bought their stock and rivals rarely bought
anyone's — then asked directly why buy-outs weren't happening. They were right: the
register was almost dead. Only the roll-up (1 of 4 archetypes) ever bought stakes, it
only chased weak bolt-ons, and it explicitly skipped the player ("left to the
hostile-takeover mechanic"). So most games had zero or one acquirer and a strong
player was never touched. That caution — avoiding a "bought out while winning" loss
and protecting §9 — had drained the whole financial layer of life.

Opened up, on two tracks:

- **Buy-OUTS, from more than the roll-up.** Legacy and flag carriers are now
  `acquisitive` too (real majors consolidate constantly), each with a lower
  `acquisitionAppetite` (0.3 / 0.35 vs the roll-up's 1) so the roll-up stays the
  keenest and the archetypes stay legible. ULCCs still grow organically. `maybeAcquire`
  now also targets the PLAYER — but only as a weak bolt-on (poor return AND small
  relative to the buyer), so a *strong* player is never on the menu (§9, and no
  losing-while-winning). A rival that accumulates a controlling (>50%) stake in the
  player seizes it past the grace turns — a new, telegraphed loss vector (the alerts
  fire every 10%/quarter; the player can dilute a raider by issuing equity), distinct
  from the crater-panic seizure.
- **Buy-ING, of the strong too.** `maybeTakeStake`: a cash-rich non-acquirer puts
  surplus into a profitable rival — or a profitable player — as a minority position
  (capped below control). This is what a *winning* player now feels: sharks circling
  its shares (pillar 4). The register went from ~1 holder to 9 of 12 carriers holding
  stakes; ~4-5 buy-outs a present game (was ~0-1).

**§9 held:** peak single-carrier route share 28% (present, cap is <90%), field stays
within its cap, all 26 regression invariants green — the guardrails (bolt-ons only,
one deal at a time, integration drag, appetite scaling) keep consolidation off a
monopoly path.

**Cost:** every stake buy / buy-out clones the state (the known 74%-of-runtime hit),
so a busier market is a heavier sim. Gameplay is unaffected (~40 ms/turn), but the
headless/test harness slowed — mitigated with a cheap early-out in `maybeAcquire`
(skip the scan when a carrier holds no stakes and isn't opening a campaign) and a
frequency trim; the two full-game invariant tests got realistic timeouts. A deeper
`clone()` optimization is the lever if the balance tool ever feels slow.

### Harder: a bigger field, and boards that fight a raid — 2026-07-23

A player reported taking control of every rival and sitting on $8B with nothing to
spend it on — the field was too small and the AI never resisted a takeover. Two
fixes, plus a nudge:

- **A fuller field.** Cast size 5-9 -> 8-12, the live cap 9 -> 12, and the entrant
  pool 16 -> 24 names so churn doesn't exhaust it. Startups spawn sooner
  (minTurn 20 -> 12) and more often (chance 0.14 -> 0.22), and the refill gate
  loosened (a third of survivors profitable, was half) so failures and crises get
  refilled rather than leaving a sparse world. Present now runs ~9.8 live rivals
  (was 7.0), history ~7.4 (was 5.5).
- **Boards defend against a raid.** New `maybeDefend`: once an outside holder's
  stake reaches `takeoverDefenseThreshold` (35%), the carrier issues equity to
  dilute the raider — the Railroad Tycoon defence — about half of quarters
  (`takeoverDefenseChance`). A quiet accumulation becomes a war of attrition: a
  determined, cash-rich raider can still win control, but pays for every point
  against a moving target, so no one quietly owns the whole field. Applies to the
  player's raids and to AI-on-AI. The roll-up still completes buyouts (it borrows
  to outpace the dilution), so M&A stays lively.
- **A touch more aggressive.** The personality band widened (aggression 0.7-1.5 ->
  0.9-1.7), so rivals contest markets more readily and accept thinner margins.

**Headless, 20 games each:** live rivals up as above; the weak fixture's peak route
share falls (present 12% -> 9%, history to 4%) and its survival tightens — the world
pushes back harder. History stays bimodal on the fixture (crisis seeds where the
passive bot dies early still thin out; the idle-player recovery test confirms the
FIELD itself refills). All 26 regression invariants hold; new tests pin the defence
(dilutes at the threshold, leaves a small holder alone) and the wider cast range.

Evasive equity issues now show in the quarterly briefing's Markets section — a
rival minting shares reads as "issued new stock — evasive action against a
takeover," and when the player is the raider being fought, "diluting your stake to
N%." A share-count jump is read as a split (ratio ~>=2) or an issue (ratio
1.02-1.9), so the two don't get confused. The defensive dilution was invisible
before; a raider needs to see the target fighting back.

### Contradictory events can't run at once — 2026-07-24

A player saw an oil spike and an oil glut active in the same quarter. The deck only
blocked the *same* card from running twice (`!running.has(id)`); nothing stopped the
two poles of one market condition from overlapping and composing (fuelPrice ×1.55 ×
0.72). Nonsense.

Fixed as data, per §6 (no bespoke per-event code): a `group` field marks
mutually-exclusive cards, and `drawEvent` won't open a card whose group is already
live. Three axes tagged — **fuel** (oil-spike/oil-glut), **economy**
(boom/recession), **fare** (capacity-discipline/fare-war). Same-direction shocks
still stack (a recession *during* a pandemic is real, 2020), and ungrouped cards are
unaffected; only the good/bad poles of one axis are made exclusive.

Because `scheduledEvent` runs before `drawEvent`, the group check on the running set
also stops a random card opening on top of a scripted historical one. The reverse —
a scripted beat firing while a conflicting random card lingers (a random glut into
the 2008 spike) — is handled at the insertion point: a scripted event is
authoritative and clears any running card on its axis first. Empirically, 0 gluts in
4000 draws while a spike runs, while 910 non-conflicting cards still drew — the axis
closes without deadening the deck.

### Phase 5 opens with a split-flap results board — 2026-07-24

Phase 4 plays and is winnable, so the final phase (feel & polish) begins. First
slice: the quarterly board briefing's net-income headline now reveals as an airport
**split-flap (solari) display** — each digit in its own flap cell, riffling through
glyphs and settling left to right when the briefing opens. It is the one moment the
game earns a flourish, and it is the aesthetic the whole thing is built on
(timetable typography, departure boards), so the flourish is on-brand rather than
decorative noise.

Deliberately restrained to fit the light theme: paper-sunk cells with a hairline
fold seam and a printed top-light/bottom-shadow, ink glyphs (loss red when the
quarter is negative), *not* a dark departure board — a black board in a paper-white
game would have been the bolder default, and the wrong one here.

Correctness before flourish: `splitFlap` writes the true final value into the cells
and an `aria-label` on the first frame, so a screen reader, a no-JS render and
`prefers-reduced-motion` all get the answer, never the churn — the animation only
obscures a value that is already right. Verified via a stub-DOM smoke (cells sum to
the figure, reduced-motion shows it instantly with zero flapping cells) since the
test suite is Node-headless by design and carries no browser env. Visual QA is the
one thing that needs a human on the running build.

Remaining Phase 5 backlog (unordered): sound (off by default), a 5-tooltip
first-turn onboarding, keyboard shortcuts, save-slot UI, seed sharing.

### The map zooms and pans — 2026-07-24

Cities were hard to see at world scale, especially the European cluster. Added
`+`/`−` buttons (bottom-right of the plate), plus drag-to-pan and scroll-to-zoom so
the zoom is actually useful — buttons alone would zoom to the plate centre and strand
anyone whose network is elsewhere.

Done by narrowing the SVG `viewBox` to a sub-rectangle of the existing plate rather
than a CSS transform: cities and labels are in user units so they scale UP as you
zoom (the whole point — bigger, easier to read), while arcs keep `non-scaling-stroke`
and stay thin. The plate bounds moved from a VIEWBOX string into numbers
(`VIEW_MIN_X/Y/W/H`) so the map can compute clamped zoomed boxes; the string is now
derived from them, so the two can't drift. Pan is clamped to the plate edges, a drag
past a 4px threshold suppresses the click so it doesn't select a city, wheel zooms
toward the cursor, and the buttons grey out at the 1×/6× limits. Zooming fully out
returns to exactly the original world view. Verified the viewBox arithmetic against
the real plate constants (visual QA still needs a human on the build).

Two selection bugs surfaced and were fixed:

- **Pointer capture ate city clicks.** Capturing the pointer in `pointerdown`
  retargets `pointerup` to the SVG root, so the browser fires the `click` on the
  root, not the city — nothing gets selected. Fixed by capturing only once a drag
  crosses the 4px threshold; a plain click never captures, so it reaches the city.
- **Overlapping hit-boxes stole clicks — "can't click New York."** Each city had a
  fixed 6-unit invisible hit circle, and NYC (first in the data) sits 3.9 units from
  Philadelphia (and ~9 from Boston/Washington), all drawn later, so their circles
  painted over NYC's and swallowed its clicks. Replaced per-city hit circles +
  listeners with **nearest-centre hit-testing at the map root**: a click (and hover)
  resolves to the closest city within a zoom-scaled reach, so dense clusters can't
  steal each other's clicks by draw order. The marks are now purely visual.

### Feel, second slice: arcs draw in, masthead figures tick — 2026-07-24

Extended the same restrained motion language to two more moments.

- **A newly opened route draws itself in** along the great circle. The map fully
  rebuilds each render, so `RouteMap` remembers the player route ids it drew last
  time and animates only the one that just appeared — via a `pathLength="1"` +
  dash-offset trick, so no `getTotalLength` and any arc length works. The id set is
  *seeded* on the first render, so a resumed network doesn't re-animate — only
  routes opened in play flourish. Player routes only; rival arcs appearing each turn
  would be visual noise.
- **Cash and market cap tick** to their new value when the books close, instead of
  jumping. `tickNumber` remembers each element's last figure (unchanged re-render =
  instant, so hovering doesn't re-roll), eases out over 500ms, and a generation
  token makes a newer update cancel an in-flight one rather than the two fighting.

Shared `motion.ts` guards both (and the split-flap) on `prefers-reduced-motion`.
Ticker and flap contracts verified by stub-DOM smokes (first paint, unchanged,
change-to-completion, reduced-motion instant); arc draw-in is CSS, eyeballed on the
build. No new deps.

### Difficulty is a set of data multipliers, chosen with the scenario — 2026-07-24

A player won and asked for difficulty levels. Rather than a slider (pillar 4 rejects
one) this is three named presets picked on the pre-game chooser next to the scenario,
each a set of multipliers on the tuned baseline. **Medium is the current game
unchanged — every lever 1.0**, enforced by a test, so existing balance work is never
silently altered.

The levers (all in `constants.json` under `difficulty`, read through one
`difficultyMods(level)` helper so adding a lever is a data change and each
consumption point is a single lookup):

- **demand** — seeds world traffic in `conditionsFor` (easy 1.2, hard 0.85). More
  passengers to win on easy.
- **eventChance** — scales the RANDOM disaster deck's draw (easy 0.6, hard 1.4).
  History's *scripted* crises come through a separate path and are deliberately
  untouched — living through 9/11 and COVID is the point of that scenario.
- **rivalCount** — scales both the dealt cast size and the live field cap (easy 0.7,
  hard 1.25), clamped to a floor of 2 and the roster.
- **entrantChance** — how fast startups fill vacancies (easy 0.65, hard 1.4).
- **aggression** — multiplies every rival's rolled aggression, which flows through
  `effectiveConfig` to incursion appetite and loss tolerance (easy 0.85, hard 1.2).
- **startingCash** — the player's opening runway (easy 1.3, hard 0.8). My addition;
  the clearest early-game difficulty knob and a Tycoon/Aerobiz staple.

`difficulty` is a first-class GameState field like `scenario` (schema 13 -> 14,
migration tags every old save medium). Threaded through `newGame`, `runGame(s)` and
the `--difficulty` headless flag.

**Headless, 20 games each, present, same stub AI (measures the WORLD, not player
skill):**

| level  | survived | median net worth | load factor | rivals alive |
|--------|----------|------------------|-------------|--------------|
| easy   | 17/20    | $8413M           | 66%         | 7.3          |
| medium | 14/20    | $2442M           | 53%         | 9.2          |
| hard   | 10/20    | $5M              | 37%         | 10.4         |

A clean monotonic curve on every axis: easy is forgiving and lucrative, hard is a
knife-edge (median net worth near zero, half the field dies). The demand lever shows
directly in load factor; the field levers in rivals-alive.

### Equity issuance is a finite well, not a market-cap pump — 2026-07-23

A player noticed that issuing stock "raises the valuation with no apparent limit"
— a genuine exploit. In the model, issuing $X adds $X cash -> $X book value -> $X
market cap, and the only cap was per-issue (25% of cap) with **no lifetime
ceiling**, so repeated issues (there is no per-turn accumulation either) pumped the
win metric without bound.

Reality: issuing shares doesn't *create* value — it's dilutive, the price drops
~11% on a secondary offering, and crucially a company has a fixed number of
**authorized shares** in its charter; going past it needs a shareholder vote. The
raised cash only builds value if it's *deployed*.

Fix: an authorized-share ceiling. `authorizedIssuanceFraction` (0.4) caps cumulative
issuance (split-adjusted, tracked in the new `Carrier.issuedShares`) at that
fraction of the float, so a carrier can grow its share count by at most ~f/(1-f) =
67% through issuance across a whole game. Splits scale `issuedShares` with `shares`
so a split hands back no headroom. A fresh $120M carrier can raise ~$74M total over
~3 issues, then the well is dry — a real one-time capital raise, not a renewable
pump. Debt, retained earnings and sale-leaseback remain the other capital taps.

Nice side effect: a raided board's `maybeDefend` dilution now runs *out* — after
~67% share growth it can't mint more, so a determined raider eventually overwhelms
the defence (the intended war-of-attrition end state) and the share count can't
balloon indefinitely. The field is not tuned to scale the ceiling with company size
on purpose: letting a bigger company issue more would re-open the grow->issue->grow
pump the ceiling exists to close. `issuedShares` is an optional field defaulting to
0, so old saves need no migration. All 345 tests green; new tests pin the ceiling
(hammering the issue button halts at 0.4) and its invariance across a split.

### Market cap marks the portfolio to market, and dividend income is a P&L line — 2026-07-23

Two holes in the financial layer, both surfaced by the same question — "are my
stock gains captured?":

1. **Market cap excluded the stakes you hold.** `marketCap` returned
   `standaloneEquity` (cash + fleet − debt + earnings multiple) and ignored
   `holdingsValue`. So buying a stake *lowered* your market cap (cash out, stake
   uncounted), a holding rising or falling never showed until you sold, and your
   portfolio counted for nothing toward the win condition — which undercuts the
   whole buy-early-sell-late play. The building block was already there
   (`equity = standalone + holdings`), just wired only to the leasing cap. Pointed
   `marketCap` at it. Now a stake is value-neutral to buy, unrealized gains AND
   losses flow straight through (a held carrier's value cratering — or its going
   bankrupt, which drops the stake to zero in `holdingsValue` — dents your market
   cap without a sale), and the win/net-worth/takeover figures all count your book.
   Still non-recursive: a stake is marked at the target's STANDALONE worth, so a
   ring of cross-holdings cannot spin to infinity. Balance held — most carriers
   carry little stock, so the change is second-order: 26 regression invariants
   pass, consolidation and the no-one-owns-the-world cap are unchanged.

2. **Dividends received were invisible in the P&L**, like interest used to be. The
   cash landed but no line explained it. Added a `dividendIncome` line to
   `QuarterResult` (optional, so old saves load), folded into net income so the
   quarter reconciles with the cash that arrived, and shown in both quarterly
   result views when non-zero.

### The stock market comes alive: AI dividends, telegraphed roll-ups, sell + cross-holdings — 2026-07-23

The stock layer existed but sat inert: no rival ever declared a dividend, the
player couldn't sell a stake or see who was buying whom, and — worse — the
control-gate added earlier had silently broken the roll-up: `maybeAcquire` still
called `ACQUIRE_CARRIER` through `applyAction`, which now rejects a buyout without
a majority stake, so roll-ups had quietly stopped acquiring anything. This makes
the layer active.

- **AI dividends.** Each archetype carries a dividend policy (legacy 30%, flag 18%,
  ulcc 5%, roll-up 0), set at spawn — mature carriers return cash, growth carriers
  reinvest. The world now pays dividends the player can earn on with a minority
  stake, and the payout visibly lifts a payer's share price. (Only paid from a
  profitable quarter, so a struggling carrier's policy is dormant until it earns.)
- **The roll-up runs a campaign in the open.** Rewrote `maybeAcquire` from an
  instant swallow into: fold in anything it already controls (debt-funded); else
  continue any raid already under way — committed, even if the target's earnings
  wobble back up; else, now and then, open a new one on the cheapest weak bolt-on.
  It buys a 10%-a-quarter slice, borrowing the shortfall mid-raid (debt to buy
  control is exactly what makes a roll-up powerful and fragile). So a buyout is now
  a visible, defensible multi-quarter accumulation, not a one-click seizure — and
  it fixes the gate regression. This is also the groundwork for a telegraphed
  hostile takeover of the player.
- **Sell, and see who owns whom (UI).** The treasury gained a Sell action (buy in
  early, sell the appreciation — the `SELL_SHARES` action already existed, it just
  had no button), a "Held by" column showing each carrier's largest outside
  stakeholder, and a "Your shareholders" line that turns red when a rival crosses
  25% of the player — the warning before a bid.

**Headless, present, 20 games:** survivors 9/20, 31 rivals acquired across the
suite (M&A is lively again but telegraphed), max single-carrier route share 10% —
no runaway. All 26 regression invariants hold; new tests pin the archetype dividend
policies and that a spawned carrier inherits its archetype's.

### The hub-feed bonus, at last — 2026-07-23

CLAUDE.md §6 always called for a "hub connectivity bonus (simple: carriers with
more routes touching an endpoint get a feed multiplier — do NOT model itineraries
in v1)", but it was never built — share was decided purely by frequency, gauge and
posture, so a carrier's 31st route out of a city drew no better than its first.
That gap was the reason regional aircraft could not earn their keep as feeders, and
why the fortress-hub and legacy archetypes had only a behavioural identity, not a
mechanical one.

Built as the simple v1 version, no itineraries: a carrier's attractiveness on a
sector is multiplied by `feedMultiplier(connections)`, where `connections` is the
count of its OTHER routes touching the two endpoints, summed. The curve saturates —
`1 + maxBonus x n / (n + halfRoutes)` — so the first few feeders matter most and a
giant hub cannot run away (maxBonus 0.4, halfRoutes 6: +20% at six connecting
routes, approaching +40% at a huge hub). It lands exactly where share is decided,
and is applied consistently in three places that must agree: `buildMarketIndex`
(baking it into every carrier's stored score, so rivals see each other's hubs),
`computeCarrierQuarter` (the settlement of a carrier's own routes), and `feedFactor`
(the UI and AI probes) — all excluding the sector being priced from its own endpoint
counts, both hot paths using a precomputed city-count so it stays O(routes). The
route dossier shows the bonus on the "Your share" line; the AI values opening at an
established hub more highly.

**Headless, 30 present games, feed off (maxBonus 0) -> on (0.4):** survivors
21 -> 18/30, thriving 19 -> 18, mean rival routes 191 -> 174, max single-carrier
route share 12% -> 11%. A modest, intended tightening — networks concentrate
slightly and the thinnest-spread carriers are squeezed — with no runaway (the "no
carrier owns the world" invariant holds). All 26 regression invariants pass; three
new economics tests pin the multiplier's shape, the connection count (own routes
only, self excluded), and that a hub lifts share on a contested sector.

### The stock market grew up: chunked buying, control, dividends, splits — 2026-07-23

Modeled on Railroad Tycoon (researched first), and built to make a takeover
something you see coming rather than a click. The engine already had shares,
stakes and a majority-control helper; this made them a game:

1. **Chunked buying.** No one — player or AI — may accumulate more than
   `stakePurchaseCapPerQuarter` (10%) of a carrier's shares in one quarter. A
   controlling stake is therefore built over several turns, in the open. The
   counter (`Carrier.stakeBought`) resets each turn.
2. **Control at a majority.** Past `controlThreshold` (50%) you control a carrier:
   you may set its dividend and force a buyout. Below that you are only an investor.
3. **Acquisition gated on control.** `ACQUIRE_CARRIER` now refuses unless the buyer
   already holds a majority — a buyout is the culmination of a visible campaign,
   not an opening move. (This gates the PLAYER's action; the AI roll-up still folds
   weak carriers in directly for now — telegraphing the AI's raids is the takeover-
   dynamics change coming next, and this is its foundation.)
4. **Dividends.** `Carrier.dividend` is the share of the quarter's profit paid to
   shareholders. In-game holders take their slice in cash, the public float's share
   leaves the game. It never pays more than earned or held, so it cannot bankrupt
   the payer — but it drains the balance sheet, which is how a controller pulls a
   subsidiary's cash upward, and the cost of using it to prop a price. Raising the
   dividend **lifts the share price** (`dividendPricePremium`, the earnings multiple
   scaled by `1 + dividend x premium`) — but only on a carrier actually profitable
   enough to pay, so a loss-maker cannot fake a high price with an empty promise.
   You may set your own dividend (a defensive price lever) or a subsidiary's.
5. **Stock splits.** When a price closes a quarter above `splitPriceThreshold`
   ($24), the stock splits `splitFactor`-for-1 (shares and every stake in it
   multiply, the price divides) until it is back under. Value-neutral and
   ownership-neutral — legibility and a mark of success.

The board briefing carries the telegraph: a rival raising its stake in you is an
alert, taking control of a rival is reported, and splits show in Markets. Schema
bumped to v13 (carriers gain `stakeBought` and `dividend`; the migration gives old
carriers an empty counter and a zero dividend).

**Balance:** the all-AI economy is unchanged — AI carriers declare no dividend
(neutral), splits carry no value, and the AI's roll-up path does not go through the
gated player action. All 26 regression invariants still hold; 8 new finance tests
pin the cap, the control gate, dividend payout and valuation, and splits.

### Fares carry a monopoly premium, so uncontested routes pay — 2026-07-23

**The complaint.** In a 2000-start game some aircraft looked unprofitable on every
route. Investigation confirmed it: a per-route P&L sweep showed everything under
~115 seats — turboprops and regional jets — lost money on its *best* route, at a
full 88% load factor. A third of the roster was dead content, and the small metal
that flies thin routes in real life had nowhere to earn.

**The real cause.** Not that small aircraft are expensive (they are — their
per-seat fuel/crew/maintenance run 1.4-1.9x a mainline jet's, which is roughly
right). The cause was that **fares had no competition term at all**: a route one
carrier flew alone earned the exact same yield as a five-carrier dogfight. So even
a monopolist filling a turboprop lost money — its fare per seat sat below its cost
per seat and it had no way to price up. That is backwards. In reality a monopoly
route commands the highest fares, and *that* is what sustains small aircraft on
thin uncontested markets.

**Grounded in real data** (researched before building): DOT airfare reports show
the least-competitive routes carry the highest fares. Competitive entry compresses
yields 15-25% — MIT finds an LCC entry cuts fares ~8%, a ULCC ~21%; Southwest's
entry averaged -15% (up to -32% at MSP), and it flies ~60% of its network with no
direct competitor. The first entrant bites most; later ones matter less. Our own
arithmetic said a turboprop needed about +28% to break even on a monopoly route —
smack in the observed monopoly-premium band.

**The mechanism.** `competitionFareMultiplier(rivalCapacity, market)` lifts the
fare `1 + monopolyPremium / (1 + rivalShare/competitionHalfShare)`, where
rivalShare is rivals' scheduled seats over market demand. A route no rival serves
clears at +28%; the premium decays toward the base competitive fare as capacity
piles on, first entrant biting hardest. It applies to every carrier on the market
equally (the market clears at one fare, so share is undistorted) and as a level
rather than a posture deviation (so it does not suppress demand through elasticity
— a monopoly market is captive, which is exactly why the premium holds). The
`MarketIndex` now carries each carrier's scheduled capacity; the dossier shows the
premium on the Fare line.

**Small aircraft, best monopoly route, before -> after:** Tarn 72 (72-seat TP)
-$500K -> +$498K; Cirro 70 (76-seat RJ) -$696K -> +$688K; Cirro 90 (100-seat RJ)
-$144K -> +$1,651K. On a *contested* route the premium erodes and they fall back
to break-even — small metal wins its niche, not head-to-head, which is realistic.
The 48-seat turboprop stays marginal, as it should between world capitals.

**Headless, 40 games/scenario, premium off -> on** (monopolyPremium 0 -> 0.28):

- Present: survive 17 -> 29/40; **thriving (>$500M) 3 -> 27**, withered (<$50M) 10 -> 2.
- History: survive 38 -> 18/40; thriving 0 -> 2, withered 38 -> 16.

The headline is not the survival counts, it is the *shape*. Before, present was a
withered stalemate (survivors mostly limping) and **history was a zombie world —
38 of 40 "survived" but every one withered at ~$0, nothing ever happening.** After,
both have a real distribution: clear winners and losers. History now models the
brutal post-2000 reality — a decade where most regional startups died or were
consolidated and a few broke out — instead of a flat line. Load factors rose from
an unrealistic 26% (carriers dumping capacity because fares were too thin to
discipline) to a realistic 57%. All 26 balance invariants still pass; no carrier
runs away with the map. Base fare left unchanged: cutting it to "re-center" just
pushed both worlds back toward the zombie state, because most routes in a
200-major-city map are uncontested and the premium is doing honest work there.

**A test that measured the wrong thing.** The history market-recovery invariant ran
the field through the AI *player fixture*; once the richer economy let that weak
bot go bankrupt in the crises, the sim froze and the field read as dead. Rewritten
to run with an idle player (who never fails, so never ends the game early) and
watch the rivals alone — the world recovers robustly (169-337 routes every seed).

### History 2000: an optional 50-year run through the real shocks — 2026-07-23

CLAUDE.md lists "no historical eras" as a non-goal and parks a compressed history
start as a post-1.0 open question. The owner chose to bring it forward as an
**opt-in second scenario**, not a replacement: the game now asks which game you
want before you pick a home city. Present-day (2026, 25 years) is unchanged and
the default. History (2000, 50 years) layers three things on the same engine:

1. **Real events on their real dates.** A `historical` schedule in `events.json`
   maps year/quarter to an event id — recession 2001, 9/11 2001 Q3, SARS 2003,
   the 2008 oil spike and crash, Eyjafjallajökull 2010, the 2015 oil glut, COVID
   2020, the 2021 pilot shortage, the 2022 spike. `scheduledEvent` fires them in
   history mode only, on top of the random deck. No bespoke code per event — they
   are the same JSON cards the deck already understands, two of them (`sept11`,
   `covid`) given `weight: 0` so they are scripted-only and never drawn at random.

2. **Aircraft anchored to their launch dates.** Every `AircraftType` carries an
   `introYear`; `rollAircraftIntro` turns that into a turn, clamped to 0 for
   anything already flying at the start. So a 2000 start offers period metal
   (a 1980s narrowbody, a mid-90s widebody) and withholds the A320neo-class jets
   until they arrive — and the four fictional next-gen types launch on a *seeded,
   uncertain* future date, so adopting a new aircraft fast is a real edge. The
   same machinery gates the four next-gen types in present-day mode. This was
   built first, as the owner asked, because it stands on its own in both scenarios.

3. **COVID is survivable, because bailouts happened.** A card marked
   `crisis: true` puts the world into a declared crisis. A carrier that would go
   bankrupt *during* a crisis instead takes a government bailout — cash lifted to
   a small cushion, booked as debt — up to `maxBailouts` (3) times. This is what
   stopped a realistic COVID from wiping the entire industry out. It is scarring,
   not free: the loan sits on the balance sheet and interest compounds.

**The one real fix the mode forced.** With the scripted crises gutting the field
in 2001-2008 and again in 2020, the AI market collapsed to zero routes and never
recovered — a dead world for the back forty years. The cause was the new-entrant
gate: a startup would only spin up if half the surviving carriers were already
profitable, so a fully depressed field locked itself out of new blood forever.
Reality is the opposite — a vacuum is exactly when a Breeze or an Avelo enters.
Added a `vacuumRoutes` escape: when the rivals between them fly almost nothing,
an entrant may bootstrap the market regardless of incumbent profitability. With
it, all six sampled history seeds rebuild a living field after COVID (30-293
rival routes by 2050 versus mostly zero before), and present-day balance is
unchanged — the escape only fires in a collapsed market, which a healthy 2026
game never reaches. Guarded by a new `tests/history.test.ts` invariant.

Schema bumped to v11 (adds `scenario`, `startYear`, `horizonTurns`, and a
per-carrier `bailouts` counter); the migration tags every existing save as the
present-day game it always was.

### Making it harder: delivery lead times, lessor gating, and rivals that fight — 2026-07-22

The game was too easy for a competent human — build $4B, buy three carriers, win
— even though the headless fixture found it hard. That gap is the tell: the
fixture is a passive bot, and a real player was walking over three things that
were unrealistically frictionless. Researched real aircraft leasing first —
53-60% of the world fleet IS leased, so leasing heavily is realistic, but Airbus
sits on a 10-14 year backlog, lessors demand deposits and creditworthiness, and
leases are long commitments. The game had none of that. Built all three levers:

**1. Delivery lead times.** An ordered aircraft — leased or bought — now takes
quarters to enter service (turboprop 1, narrowbody 2, widebody 3), a compression
of the real backlog. You pay the deposit now and it flies later; you can earmark
it to a route, but it carries no capacity and costs no lease until it arrives.
This is the honest answer to "can you lease all you want?" — no, and even what
you order takes time. It paces growth for everyone, strong or weak, so you cannot
out-expand the field overnight.

**2. Lessor and credit gating.** The lease deposit tripled (one month to three);
lease rates now scale with credit rating (a junk balance sheet pays up to 50%
more, from a new `leaseCost` in Conditions); and total lease commitments are
capped at 2x equity — lessors will not extend unlimited leases against a thin
book. Lever up and your leasing gets dearer and then refused, which brakes the
borrow-and-lease-everything play.

**3. Rivals that fight.** The biggest lever. Profitable rivals now BORROW to fund
expansion, exactly as the player can (`maybeBorrow`, half their capacity, never
into losses), and their appetite to raid each other's markets was raised. The
result: rivals carry real debt and grow far larger — mean routes across an all-AI
game went from 49 to ~102 — and 20 of 30 all-AI seeds now see markets genuinely
contested, against far fewer before. A passive field became an active one.

Tuning it was the whole job, and it had a §9 cliff. Cranked too hard, rivals
borrowed and raided each other into mutual destruction and one carrier ended
owning 100% of routes — monopolies in 3-4 of 30 seeds. That was not bolt-on M&A
(the size cap held); it was a bloodbath leaving a last carrier standing. Backing
off the borrow fraction (0.5 to 0.35), the incursion boost, and the deal chance
(0.30 to 0.20) brought it to **0 monopolies over 30, 20/30 contested, ~100 routes
a game, ~6 rivals surviving** — vibrant, not annihilating.

Player-facing, the world is now meaningfully harder to dominate: thriving fell
and the 90th-percentile net worth dropped from ~$7B to ~$4.9B, so even strong
play no longer runs away to a lonely $4B. Schema bumped to v9 (aircraft delivery
dates) with a migration that lands every existing tail as already-delivered; a
50-seed sweep confirms delivery, gating and the tougher AI leave economics finite
and saves round-tripping, and an old v5 file still migrates all the way up and
plays on.


### M&A bumped, and acquirers now inherit the target's technology — 2026-07-22

Asked to bump merger activity a little (short of monopoly), and whether a buyer
gets the target's technology. It did not — `mergeCarrier` absorbed cash, debt,
fleet, holdings and routes but left the tech behind. Now the acquirer takes the
union of both delivered programs and carries over the target's in-flight ones it
is not already running. That is realistic — you buy the systems, the booking app,
the loyalty base — and the integration drag is the price of bolting them on. It
also gives acquisitions a strategic pull beyond the routes: buying a tech-heavy
rival is a shortcut through a now-expensive tech tree.

Bumping the rate was a tuning problem with a cliff in it. The target gate is
"underperforming" — trailing earnings below a small return on the target's own
market cap (never relative to the buyer, which is what monopolised before). But
that gate is nearly binary: strictly-losing catches ~0.6 deals a game, and the
moment the threshold goes positive it jumps to ~4.7, because a crowd of carriers
sit near break-even. So the RATE is throttled separately, by a per-quarter deal
chance — deals are negotiated over quarters, not struck the instant a target
looks cheap. At a 0.30 chance and a tighter bolt-on cap (a target must be under
35% of the buyer, down from 50%), the settled numbers over 30 seeds are **~2.4
acquisitions a game, zero monopolies, and no carrier ever past 58% of routes** —
a livelier M&A scene that still cannot run away.

Balance drifted a little harder (thriving 63 -> 50 over 150), because acquirers
that inherit tech are tougher and fewer weak rivals simply die. That is a
side-effect worth the owner's feel-test, not a blind re-tune; the difficulty has
been creeping up across the last several changes and a holistic pass is due.

A 50-seed sweep confirms the tech transfer never duplicates a node or leaves an
invalid one, conditions still resolve finite after a merge, and saves round-trip.


### New airlines spin up to fill the vacuum — 2026-07-22

Asked whether M&A matches reality and whether new carriers appear after buyouts.
The answers, researched: consolidation really does buy the WEAK (America West took
US Airways, Delta took Northwest, AA took US Airways — each a stronger carrier
absorbing a distressed one), which is what the model does. But the field only ever
shrank: the cast was dealt once at game start and never replenished, so a game
ground down toward a static duopoly, which is not how the real market behaves.

In reality a thinned, profitable market draws new low-cost entrants — Breeze and
Avelo launching into exactly the secondary cities the merged majors walked away
from. So the field now regenerates. Once the scheduled cast has fully arrived and
a carrier has left the board and the survivors are mostly profitable, a fresh
ULCC may enter from the unused roster names (16 names, only 5-9 dealt per game, so
there is always a pool). Startups are low-cost point-to-point, so they enter as
the ULCC archetype — the right shape for the gap-filler.

Measured over 25-year games: ~3.3 new entrants each — a few startups a decade,
which is about right — and the active field stays capped at the roster maximum.
Determinism holds (they are dealt from the seeded stream), and a 50-seed sweep
confirms every entrant is a valid carrier with a clean balance sheet, no
duplicate ids, and saves that still round-trip.

Two guards earned their place. Entrants wait until the whole scheduled cast is in
— otherwise a startup and a late-arriving scheduled rival could both claim the
last slot and overflow the field past its cap (seen at 10 against a cap of 9).
And entry needs a genuine vacancy plus a profitable market, so the mechanic is
pillar 4 generalised: not just the player's success, but the whole industry's,
attracts new sharks.

**Still not modelled, and noted:** consolidation in real life comes in crisis-
driven WAVES (9/11, 2008) rather than a steady trickle — tying merger appetite to
the recession and pandemic events would capture that, and is a natural next step.
And the AI M&A rate remains deliberately low (~0.6/game) to avoid the monopoly the
review caught; the new entrants matter more for keeping the world alive than the
mergers do for thinning it.


### Phase 4 review: three real bugs, and M&A that ate the world — 2026-07-22

A review-and-fix pass over the Phase 4 code found four things, three of them
genuine correctness bugs the tests had missed:

1. **Merging a rival could leave the buyer flying a market twice.** Route ids
   embed the owner (`rival:LON-NYC`), so an absorbed route kept the old prefix.
   If the acquirer already flew that market, it ended up with two route records
   on it and competed with *itself* in the share split. Fixed: the merge now
   folds a duplicate market's tails onto the existing route and drops the second.

2. **The same hole in reverse — `OPEN_ROUTE` guarded by route id, not market.**
   After an acquisition a carrier could open a *second* route on a market it
   already served through an absorbed route, because the ids differed. Now the
   guard is by (carrier, city pair), which is what "you already fly this" means.

3. **`BUY_SHARES` let total stakes exceed the shares that exist.** It sized the
   float as `shares − my own holding`, ignoring other carriers' stakes, so two
   holders could each "own" 60% — phantom shares, value from nothing. Now the
   float excludes every carrier's holdings.

4. **The roll-up AI consolidated the field into a monopoly.** Left unconstrained,
   a roll-up bought any affordable smaller rival every few quarters; over 20
   all-AI games, 8 ended with one carrier holding >90% of routes and 16 had zero
   contested markets — a §9 violation and the death of the competitive core. The
   fix is the archetype's actual thesis: **roll-ups buy the WEAK, not the
   strong** — a target must be *losing money*. A profitable competitor is dear
   and left alone. That took monopolies to 0/20 and restored contested markets
   (5.9 average). A "minnow relative to the buyer" clause was tried and reverted:
   as the roll-up grows its minnow threshold grows with it, and it swallows
   mid-size carriers again. The cost is a quieter M&A rate (~0.6 AI acquisitions
   per game rather than the runaway consolidation before) — the player can still
   buy freely; rivals only pick off the dying.

Each fix has a regression test, and a 50-seed sweep confirms no double-served
markets, no phantom shares, finite valuations and clean save round-trips.

**Balance note:** with roll-ups no longer absorbing failing rivals, more
independent carriers survive and compete, and the (weak, undefended) fixture
fails a little more — 44/150 bankrupt against 30 before. Left for the owner's
feel-test rather than tuned blind; the review's job was correctness, not
calibration.


### Phase 4: the financial layer, Railroad Tycoon style — 2026-07-22

The next phase, built in one session. Researched how Railroad Tycoon did it —
bonds priced by credit rating (cheap when strong, a trap when weak), buy and
issue stock, become a majority owner then buy out the rest, mergers pouring the
target's cash into you — and built a modern airline version.

**Valuation (`market.ts`).** Market cap = book value + a P/E multiple on trailing
earnings, scaled by a growth factor. Legible and non-recursive: a stake in
another carrier is valued at that carrier's *standalone* worth, never at its
worth-including-its-own-stakes, so a ring of cross-holdings can never spin the
numbers to infinity. Market cap is now the headline score.

**Debt.** Borrow against gross assets up to a leverage ceiling; the interest rate
comes from a credit rating that is the best band the carrier's leverage fits,
knocked down a notch if it is losing money. Interest is serviced below the
operating line each quarter and shields tax. Exactly RRT's trap: cheap at AAA,
punishing at CCC.

**Equity & stock.** Issue new shares for cash (dilutive, capped per turn, clears
below market). Buy and sell stakes in any carrier at the live price; past the
control threshold you own it.

**Acquisitions.** Buy a rival outright at a premium, funded with cash or — a
leveraged buyout — with debt. The target's routes, fleet, cash, debt and stakes
fold into the acquirer; other shareholders are paid out; a few quarters of
integration drag follow (merging airlines is messy). The roll-up archetype does
this to weak rivals every quarter, which is where the AI-vs-AI M&A drama comes
from (51 of 60 games).

**Winning and losing.** Win by finishing the most valuable carrier at the
horizon, or by clearing the board (every rival bankrupt or bought). Lose by
bankruptcy or — pillar 5 — a **hostile takeover**: past a grace period, once the
player's share price has cratered below 30% of its own peak while it bleeds money,
a roll-up three times its size will seize it. Tuning that trigger was the whole
balance problem: the first cut fired in 68% of games (any big rival, one bad
quarter, no grace). Requiring a real crater from a tracked peak, sustained losses,
a long grace period, and an acquisitive predator brought it to ~7% — rare and
dramatic, which is what a takeover should be.

**What it cost to get right.** Acquisitions share the "out of the game" flag with
bankruptcy, which broke three invariant tests (an acquired carrier has zero cash,
not negative, and is not a "failure"). Fixed by adding `acquiredBy` and teaching
the regression suite the difference. Two schema bumps (v7 for the AI gauge bias,
v8 for the whole balance sheet) with migrations that default an old save to a
clean, debt-free balance sheet and a zero interest history — a pre-finance game
resumes unchanged and simply cannot yet borrow. All valuations are pure functions
of state and were swept over 60 unseen seeds for non-finite numbers, negative
caps, holdings exceeding the float, and dead carriers still flying: clean.

**Deferred, honestly:** short-selling and margin (RRT's expert tier); a real
order book (share trades clear against an infinite counterparty at the current
price); the player defending a takeover by buying back stock (the fixture does not
defend, so the 7% is an upper bound — a real player faces it less); and an
end-of-game report card beyond the one-line reason (Phase 5 polish). Cost of
capital / interest on owned aircraft is still out — that is the financing layer,
and only debt-financed metal would carry it.


### Rivals fly different aircraft, and some plan their fleet badly — 2026-07-22

Player: "the fact that all of the AIs pick the same aircraft bothers me," and
separately, some carriers should be smart and some stupid. Both are one cause —
every AI optimized to the single profit-max aircraft, so on a given route they
converged.

Each carrier now rolls a `gaugeBias` (fleet-planning accuracy): the multiplier on
the capacity it aims for. Near 1 it flies the right-sized aircraft; away from 1 it
chronically over- or under-gauges. A biased planner also weighs a tighter
shortlist (3 vs 5), so its wrong target actually sticks rather than the true
optimum sneaking back in. The player fixture and sharp rivals keep the full
shortlist, so the balance baseline stays near-optimal.

Effect, measured over 40 games: contested markets flying more than one aircraft
type went 11% -> 71%, and the competence gradient is real and three-way —
**sharp planners build the most valuable airlines (median $960M, 84% survive),
over-gaugers go bust most (62% survive, $47M — too-big jets fly empty),
under-gaugers survive but stay small ($484M, 95% — too timid to grow).** Smart
wins, reckless dies, timid muddles — exactly the spread asked for.

The first cut tightened the shortlist for everyone, which quietly dumbed down the
player fixture too and cratered the balance (thriving 93 -> 25). The gradient even
came out backwards because sharp carriers were being handicapped alongside the
sloppy ones. Fixed by keeping sharp carriers on the full shortlist; the lesson is
that the player fixture is the balance instrument and must not be touched to
change rival behaviour.

### Technology is a real commitment, not a formality — 2026-07-22

Player: tech is too easy, make it more expensive and slower. Costs raised ~30%,
lead times ~35% (the whole tree now ~$570M, the longest node lands two years
out). A first pass at 1.6x/1.5x cratered the game (thriving 93 -> 50) because
technology is a large profit lever and starving access starves everyone; 1.3x/
1.35x lands it "harder but playable." Per-node effects unchanged — the barrier is
access, not power. Final balance to be re-judged after the Phase 4 financial
layer, which moves everything.


### Owned aircraft are charged depreciation at the route level — 2026-07-22

The player, reading a Beijing-Shanghai board: a 50% sector margin, and owned
aircraft showing $0 for their cost of capital. Correctly flagged as unreal. This
is the "owned aircraft look free at route level" item, now closed.

A leased tail charges rent to the sector; an owned tail charged nothing, because
the P&L is cash-based (Phase 1) and the purchase was paid up front. So an
owned-fleet trunk route read as pure cash with no cost for the metal.

Owned tails now carry **depreciation** on the sector — book value times the
quarterly rate, the exact write-down engine.ts already applies to the balance
sheet. It is the owned-aircraft counterpart to the lease line, and it is what a
real airline income statement carries: *Depreciation* for owned metal,
*Aircraft rent* for leased. The dossier shows a Depreciation line and Sector net
is now the economic contribution; the market board's old "Rent" column became
"Metal" (rent or depreciation) and its Net is economic too.

Two decisions kept it honest:

- **First cut benchmarked the charge to the lease rate (0.85x). The player asked
  whether that mirrored real depreciation. It did not** — it was an opportunity-
  cost proxy — so I switched to literal depreciation on book value. That answers
  "yes, this is the Depreciation line," and it earns two real properties the
  proxy lacked: it **reconciles exactly with net worth** (the sector charge is
  the same number that writes down book value, so economic net = the route's true
  contribution to net worth), and it **falls as an aircraft ages** (older owned
  metal costs less to own and more to maintain, as in life).

- **It is non-cash and never touches bankruptcy.** netCash is unchanged; the
  charge lives only in a new netEconomic. Proven display-only: the headless
  outcome distribution is byte-identical with the charge at 0% and at full
  (37/40, $2745.3M both). Cost of capital / interest is deliberately not modelled
  here — that is the owned aircraft's financing, and it belongs with debt in
  Phase 4. Real operating P&Ls charge depreciation, not interest, above the line.

What it does *not* do: fix the Beijing-Shanghai margin on its own. On that route,
depreciation is ~$7.6M against a ~$77M net — the bigger distortion there is that
the market itself is ~1.6x the real corridor (the gravity model runs hot at the
very top). That is a separate question (whether to damp the largest city pairs)
and was left open rather than bundled in.


### Price and gauge drive demand, grounded in real airline economics — 2026-07-22

Two player observations, one turn apart: "cheaper seats should fill, no?" and
"why are the rivals' shares identical?" Both were the same hole — the demand
model used a **fixed** fare per posture and a share formula that saw only
frequency. Seats did not affect share, and the fare a carrier actually charged
did not affect demand at all. On the user's instruction I researched real
behaviour before building (sources in the session), and it reshaped the model:

**(b) The S-curve — capacity share drives market share.** Market share tracks
capacity, not just frequency: a carrier gains share "whether from a larger
proportion of smaller aircraft or a smaller proportion of larger ones"
(ScienceDirect, s-curve vs schedule-delay). `attractiveness` now carries a gauge
term, seats-per-departure over a reference narrowbody, exponent 0.4. A 325-seat
widebody wins ~1.26x the share of a 180-seat jet at equal frequency; a turboprop
~0.72x. Kept sublinear — and frequency kept sublinear too — because the empirical
curve is closer to linear than to a dramatic S, and chasing it is what causes
real-world overcapacity (DECISIONS: no degenerate pile-on).

**(a) Price elasticity, scaled by how leisure the route is.** A carrier's own
posture stimulates or suppresses the demand it captures: undercutting pulls in
price-sensitive travellers who would not fly at full fare. Magnitude follows
Gillen/InterVISTAS — elasticity near -1.9 on leisure, -0.5 on business — and the
route interpolates on combined city weight, weight already being business-travel
intensity. So undercutting Cancun stimulates ~20%, undercutting Zurich ~8%. This
is new demand the discounter captures, applied after the share split, so it does
not come out of rivals.

The user's exact complaint — a 5x widebody stuck at 67% load, losing money — now
reads +$8.5M at 73%, because the gauge wins more share and undercutting fills it.
And two rivals on different aircraft no longer tie (8.94 vs 8.01 attractiveness);
two on the *same* aircraft still do, which is correct.

**Predation now bites, which answers the follow-up "the model should respond to
predation."** It is the same two mechanics that make it possible. Demonstrated on
NYC-CHI: an entrant flying 4x narrowbody undercut nets +$17.3M unopposed, +$14.7M
if an incumbent merely matches, but is driven to **-$3.4M at 42% load** when the
incumbent dumps 10 widebodies and undercuts — and the predator burns ~$2.4M/qtr
to do it, exactly the Northwest-vs-Spirit dynamic. Before these changes, dumping
capacity barely moved share and predation had no teeth. The predatory *behaviour*
(an AI choosing this) is the next piece of work; the *mechanics* that make it
hurt are now in place.

**Balance.** Same-seed A/B over 150 games: bankruptcies 16 -> 9, withered 36 ->
38, thriving 89 -> 93 — landing at 6% / 25% / 62%, inside the long-established
healthy band (9% / 27% / 61%). A touch easier at the bottom. A `k` sweep to
restore the exact prior bankruptcy count also dragged thriving carriers down into
withered (k=124k gave 81 thriving vs 93), so I left the base market alone:
blanket-starving the world to offset a realism improvement is the wrong lever.
Per pillar 4, difficulty belongs in the rivals — which is where the predation
work will put it. System load factor is 88.9%, essentially unchanged; that gap is
the spill-vanishing issue, not this change, and must not be chased here.


### Rivals buy the technology they are the sort of airline to buy — 2026-07-22

Reported from play: nine rivals in the competition table, seven of them holding
all fourteen programs. No diversification at all — which is §9's named failure
mode, a single dominant strategy, arriving through the technology tree.

The cause was two lines: `maybeInvestInTech` funded the **cheapest available**
node whenever cash cleared a threshold, every quarter. Over a hundred quarters
with billions in the bank, every carrier bought the whole tree in the same order.
Nothing was ever forgone, so nothing distinguished anyone.

Each archetype now has a `tech` block in archetypes.json — `avoid` (never funded,
whatever the cash), `prefer` (funded first), and `appetite` (the share of the rest
it will ever pursue, divided by its per-game thrift roll so two carriers of the
same type still differ). What a carrier *will not* buy turns out to be as
characterful as what it will, and it is grounded rather than invented:

| | never buys | because |
|---|---|---|
| ULCC | alliance, loyalty | Ryanair has neither; the model is cost and ancillary revenue |
| Legacy hub | ancillary revenue | unbundling carries a brand penalty it will not take |
| Flag carrier | alliance, ancillary | Emirates and Qatar built global networks outside any alliance |
| Roll-up | alliance, network planning | leveraged, buying carriers rather than five-quarter systems projects |

Measured over 190 surviving rivals: **nobody holds all fourteen** (previously
almost everyone), program counts spread 4 / 8 / 12 at p10/median/p90, and there
are 30 distinct portfolios. Mean holdings by archetype: legacy 10.1, flag 9.0,
ULCC 7.2, roll-up 4.9.

**The median net worth is not a usable headline for this game, and I nearly
misreported because of it.** The A/B over the same 150 games showed median
falling $2303M to $1912M, which reads as a 17% hit. The full distribution says
otherwise:

| | buy everything | archetype appetites |
|---|---|---|
| bankrupt | 18 | 16 |
| withered (<$300M) | 33 | 36 |
| thriving (>=$1B) | 89 | 89 |
| p25 / p75 / p90 | $35M / $4628M / $8468M | $36M / $4716M / $7917M |

Every quantile is flat and the thriving count is identical. Outcomes are
**bimodal** — a cluster near zero and a cluster in the billions — so the median
sits in the sparse valley between them and a couple of games crossing over moves
it by hundreds of millions. Quote bankrupt/withered/thriving counts and the
quartiles; do not tune on the median.

A 40-game subsample moved the *opposite* way (median $2344M -> $2971M) for the
same reason. If two sample sizes disagree on direction, the statistic is wrong,
not the change.


### Technology is legible from wherever you are looking — 2026-07-22

Reported from play: "I can't find them after refreshing the page." Entirely
fair. The disclosure existed only inside the market board, which needs a sector
*selected* and a rival *on it* — and a refresh selects nothing, so the whole
thing vanished. On an uncontested sector the competition table returns early,
so a carrier could not see its own programs at all.

It is now reachable from the two places that survive a refresh:

- **The competition sheet.** Rows expand the same way the market board's do, and
  carry the quarter as well as the technology: full P&L, net margin, and the
  trailing four quarters of net income. One quarter says nothing about
  direction; four says whether a rival is climbing out or sliding in, which is
  what decides whether to fight them.
- **The technology sheet.** A standing panel above the program list: what is
  delivered, the resolved effect, and what it is returning across the network.

The cash figure is a counterfactual — every sector priced twice, once as it
stands and once with the same fleet and rivals but no programs — because eight
multipliers spread across revenue and four cost lines cannot be compounded by
hand. `technologyValue` sums it per carrier, and a test pins it to exactly the
sum of the per-sector figures the market board reports, so the two views can
never disagree.

Row expansion is deliberately local DOM state, not game state: it survives
clicking around but not a re-render. Persisting it would mean threading UI
state through the sim's render path for a disclosure triangle.

`el`, `figure` and `costLine` moved out of inspector.ts into the shared panel
module, so a rival's quarter is drawn by the same code as the player's own
rather than a lookalike that could drift.


### US spelling throughout, and `colour` became `color` — 2026-07-22

Owner's call. 154 replacements across 34 files: programme, centre, litre,
licence, colour, serialise/deserialise, optimisation, memoisation,
recognisable, behaviour, modelled, cancelled, labelled.

`colour` is a serialized field on both `Carrier` and `PlannedRival`, so this is
not a cosmetic change — SCHEMA_VERSION goes 5 -> 6 with the first real migration
the project has had. Two things it gets right that are easy to get wrong:

- **Renamed in place, not appended.** `{...rest, color: colour}` moves the key to
  the end of the object. The determinism checks compare states as serialized
  strings, so a moved key reads as a divergence that is not there. The migration
  rebuilds the object preserving key order, and a test asserts a migrated v5 save
  serializes byte-identically to a fresh v6 one.
- **Both lists.** The rival cast carries colors too, and missing `rivalPlan`
  would have left half the save on the old spelling.

Verified against a real v5 file, not just a synthesized one: it migrates, plays
on, and the autosave is rewritten at v6 with a `color` key.

**A bulk find-and-replace over a whole repo is more dangerous than it looks.**
Two things bit:

1. `aria-labelledby` is a standard HTML attribute containing `labelled`. I
   guarded it with a placeholder — and put the word `LABELLEDBY` in the
   placeholder, so the replacement pass rewrote the guard itself and the restore
   never matched. Three dialogs lost their accessible names to a literal
   `\x00ARIA_LABELEDBY\x00`. Vite warned; the tests did not, because nothing
   asserts on accessible names.
2. The first pass missed every noun and adjective form — `serialisable`,
   `optimisation`, `memoisation`, `recognisable` — because none of them contains
   the verb stem I was matching (`serialise` is not a substring of
   `serialisable`). Grep for the stem, not the word.

**A second pass, by pattern class rather than word list, found nine more.** The
list-based approach had missed an entire category (`ageing` -> `aging`) plus
`emphasised`, `Labelling`, `finaliser`, `maths`, `liberalisation` (in a
player-facing event blurb), `judgement`, `backwards` and two of `capitalised`.
The scanner that found them regexes on the *shape* of the difference — `-ise`,
`-our`, `-re`, `-ce`, `-ogue`, ae/oe ligatures, doubled consonants, and a list of
irregulars — against exception sets for the many words that legitimately end that
way in US English (`feature`, `posture`, `promise`, `four`). It is kept at
`scripts/britscan.py` — a dev utility, deliberately not wired into CI, because it
needs judgment to separate real hits from `feature` and `posture`.

The remaining British spellings in the repo are the ones in this entry, which
have to name the old forms, and in `save.ts`/`save.test.ts`, where the migration
has to know the key it is renaming from.


### A hedge is priced against the market it is written in — 2026-07-22

Reported from play: the masthead read $0.59/L while the hedge dialog said "spot
is $0.81" and offered a lock at $0.85.

The dialog was quoting `state.fuelPrice` — the bare random walk — while
everything else showed `marketFuelPrice`, the walk with any running fuel event
applied. An oil glut was running, so the two differed by the event's 0.72
multiplier. But the display was the smaller half of it: `HEDGE_FUEL` **priced the
contract off the bare walk too**, and `blendedFuelPrice` charges the hedge against
the market price. The hedge was struck against a number nobody ever pays.

| | market | hedge locked | |
|---|---|---|---|
| calm | $0.80 | $0.83 | correct, 4% premium |
| during an oil spike | $1.24 | **$0.83** | 33% *below* market |
| during an oil glut | $0.58 | $0.83 | 43% above market |

The spike row is the serious one: a carrier could wait for the spike, *then* buy
the hedge, and take fuel a third below the market with no risk at all. That
inverts the mechanic — a hedge is a bet made before you know, and this made it a
discount available after. The glut row is what was reported: an offer 43% over
market, presented as though it were sensible.

This is the same bug as "A hedge has to shelter against the event, not just the
walk" (below), which fixed the *blend* and left the *pricing*. Both halves have to
read the market price. Now priced off `marketFuelPrice` in the sim, quoted from it
in the dialog, and the AI's trigger reads it too rather than deciding on a price
it does not face. Three tests assert the premium is constant across calm, spike
and glut.

Cost: 132/150 survivors against 135 before, median net worth unchanged. Removing
a free lunch should make the game slightly harder, and it does.

### Fuel is priced per liter, and the number looks high — open 2026-07-22

$0.80/L is $3.03/US gallon, or $127/barrel — well above the real ~$0.62/L (2024)
and ~$0.55/L (2025), and close to the 2022 crisis peak.

It is not simply wrong, and **must not be lowered on its own**. Fuel is 23.3% of
operating cost in the model against a real 25-30%, so the share is if anything
slightly *low* despite the high unit price — the price is compensating for fuel
burn that is understated somewhere. Dropping it to $0.62 would take fuel to
roughly 18% of costs and pull the whole structure away from the published one.
Refit burn and price together, against the cost-composition table, or not at all.


### The map plate is sized by its own proportions — 2026-07-22

The map jumped down the page whenever an aircraft was acquired, and on some
window sizes the whole shell scrolled. Two causes, both in the same place.

**An SVG with a `viewBox` reports an intrinsic aspect ratio.** `.map` was
`height: 100%` inside a grid row of *indefinite* height, so the percentage never
resolved and the plate fell back to its natural height — pushing its row past the
viewport. That is why the page scrolled at all.

**The inspector below it was `auto`-height.** Acquiring an aircraft clears the
sector selection, so the panel collapsed from the sector dossier to the shorter
quarter result, the map's row grew into the freed space, and the centered plate
visibly moved. A third contributor: grid items default to `min-height: auto` and
refuse to shrink below their content, so the growing fleet list in the rail was
also forcing the board taller — `.rail` and `.chart` needed `min-height: 0`.

The fix is to give the frame a definite height of its own, from the plate's own
proportions: `aspect-ratio: var(--map-aspect)`, where `MAP_ASPECT` is exported
from `projection.ts` and derived from the same two numbers that build `VIEWBOX`,
so the frame and the plate cannot drift apart. The map is then sized by the
column's *width*, which nothing during play changes, and the inspector takes
whatever is left and scrolls inside it.

This also removed the bands of empty paper above and below the map — the plate is
2.535:1 against a much squarer frame, so it had been letterboxing by ~96px top
and bottom.

One guard is needed: on a wide, short window the aspect height alone exceeds the
row, and the plate would overlap the panel beneath it. `max-height: calc(100vh -
var(--chrome-reserve))` caps it, and when the cap bites the plate letterboxes
side-to-side instead. Verified at 1280x620 through 2560x700: no overflow, no
overlap, and the map holds position through repeated acquisitions at every size.


### Route traffic is quoted in one unit — 2026-07-22

Found in a review pass. `RouteEconomics` mixed two conventions: `marketDemandWeekly`
and `capacityWeekly` were per-direction, while `paxCarriedWeekly` counted both.
`spilledWeekly`, added the same day, followed the one-way side.

The sector dossier printed them side by side, all labeled `/wk`, so the panel
said things that could not be true:

| shown | LON–NYC, one widebody | |
|---|---|---|
| Seats/wk | 1,668 | one direction |
| Passengers | 2,936 | both |
| Turned away | 3,158 | one direction |

**More passengers than seats, at a stated load factor of 88%.** This is the panel
that prompted two separate questions about the numbers not making sense, and I
read past it both times — the incoherence was in front of me in the pasted dump.
Spill was also understated twofold against the passenger count sitting directly
above it, which blunted the single figure meant to signal "add capacity here".

The codebase had been compensating rather than fixing: `headless.ts` and two
tests carried a `/ 2` to line the fields back up. That is the tell — a convention
that needs correcting at every call site is not a convention.

Now every traffic and capacity figure leaving `computeRouteEconomics` is a route
total across both directions, which is how route traffic is quoted in the
industry. The one-way arithmetic stays internal and doubles once, on the way out.
Two invariants are asserted over a grid of sectors, aircraft and postures, and
are written into the type as well:

    paxCarriedWeekly + spilledWeekly === marketDemandWeekly * demandShare
    paxCarriedWeekly <= capacityWeekly * loadCeiling

Purely presentational: a 150-game headless run is bit-identical before and after,
because the AI reads the demand *function*, never these fields.


### Demand has a season — 2026-07-22

Asked whether the 88% load-factor baseline matches real-world data. Measured: the
model produced a **system-wide load factor of 91.7% against a published 82-84%**.

The constant itself is defensible — as a cap on a sold-out sector, 88% is if
anything conservative, since Ryanair sustains 94-95% system-wide. The error was
category, not calibration. `maxLoadFactor` is a *supply-side* limit on one route
in one quarter; published load factor is a *network annual average* over full
Julys and half-empty Februaries. With no seasonality in the model those two
numbers collapsed into one, so the ceiling became the average. The old comment on
the constant admitted as much — it justified 88% by citing peaks "by day and
season" that the sim did not have.

So the season is now modeled rather than averaged into a constant:

- A quarterly index, `[0.86, 1.02, 1.16, 0.96]`, which **must average to 1.0** or
  the level of world demand moves along with its shape.
- Amplitude ramps from zero below 12° latitude to full at 45°. Singapore does not
  have a summer; Oslo very much does.
- Southern-hemisphere cities take the same curve shifted half a year, so a Sydney
  carrier's best quarter is a London carrier's worst, and a pair spanning the
  equator is naturally flat because the two ends partly cancel.

It is applied in `endTurn`'s per-market shock, **not in `conditionsFor`**, and
that placement is the load-bearing decision. Route appraisal therefore sees
annual economics while settlement sees the actual quarter, which is how airlines
plan. Had it leaked into `conditionsFor`, every AI would expand each summer and
prune the same routes each winter.

Effect: system load factor 91.7% → 89.5%, sectors pinned at the ceiling 84% →
73%, and a real Q1/Q3 spread where there was previously none. Outcomes are
unchanged (A/B over 150 seeds: 130 vs 135 survivors, median $2.03B vs $2.30B —
inside the established noise), which is what a realism fix should do.

**It does not close the gap on its own, and cannot.** The residual is spill: a
sector already turning traffic away does not notice a good summer, so the peak is
invisible above the ceiling. The rest needs market clearing — see the open entry
above.


### Technology and hedging belong to the carrier, not the world — 2026-07-22

Found in review. Both were stored on `GameState`, and `HEDGE_FUEL` ignored its
`carrierId` argument entirely. The consequences were severe and silent:

- A rival funding a program delivered it to **everyone**, the player included.
- The player paying $438M for the full tree handed it to all seven rivals.
- `techStatus` reported nodes a rival had bought as already in service.

It also invalidated the Phase 3 skill-gradient measurement: disabling tech via
`techAboveCash` turned it off for every carrier, so what got measured was "a
world with technology" against "a world without", not "the player invests"
against "the player doesn't". Re-measured properly once fixed, the gradient still
holds — **failures 3/40 against 8/40, median 11.7x against 3.2x.**

`Carrier` now owns `tech`, `techInProgress` and `hedge`; `GameState.effects`
became `GameState.events` and holds only world events.

### A hedge has to shelter against the event, not just the walk — 2026-07-22

Also found in review. `conditionsFor` applied an oil-spike event's multiplier
*after* blending in the hedge, so the locked share was multiplied along with
everything else and a hedge gave no protection against precisely the shock it is
bought for. The multiplier now applies to the market price first, and the hedge
blends against that. Measured on an oil spike: hedged pays $0.914/L against
$1.240/L unhedged.

### Archetypes needed a real cost position — 2026-07-22

The "ultra low-cost" archetype was low-*fare*, not low-*cost*: it carried a
legacy carrier's cost base and undercut on price. It was consequently the most
fragile carrier in the game — hazard **0.31** failures per 100 quarters against
the roll-up artist's **0.04**, the exact reverse of the CLAUDE.md §9 invariant.

Archetypes now carry a `costAdvantage` on the lines a carrier controls (crew,
maintenance, ground handling; fuel is a world price and is excluded), and the
ULCC also got the cash conservatism that real low-cost carriers are known for.
That took its hazard from 0.31 to **0.132**, level with the roll-up's 0.126.

**§9's "median ULCC outlives median roll-up artist" is still not satisfied**, and
it is being left that way rather than forced. At 150 games the two are within
noise of each other (27 failures against 24). The residual fragility is not the
cost base any more, it is that undercutting everything is a thin-margin strategy —
which is defensible, and matches an industry that has buried a long line of
low-cost carriers. Forcing the ordering would mean overriding a plausible model
outcome to satisfy an assumption in the spec.

**Do not try to tune `costAdvantage` finely.** The difference between 0.76 and
0.90 is not resolvable at any sample size this project can run; a 50-game sweep
produced non-monotonic garbage. Only the extremes are measurable.

### Statistical invariants do not belong in the test suite — 2026-07-22

The §9 survival ordering was briefly asserted in `tests/regression.test.ts` and
flaked immediately: at hazards near 0.1 per 100 quarters the 20-game CI sample
had **zero** roll-up failures, so the comparison was meaningless. Measuring it
needs of the order of 150 games.

What is pinned in CI now is the *mechanism* — that the ULCC has a genuine cost
advantage, that the flag carrier has the deepest pockets, that the roll-up is
thinly capitalized. Those are exact and cheap. The outcome is tracked by hand
through `npm run simulate`.

### Events and technology share one mechanism — 2026-07-22

`sim/conditions.ts`. Both work by moving the same small set of multipliers —
fuel price, demand, fare, maintenance, crew, handling, completion — an event for
a stretch of quarters, a tech node permanently. Nothing downstream knows what an
event or a tech node *is*; it only sees resolved conditions for a route.

That is what makes CLAUDE.md §6's "no bespoke code per event" true rather than
aspirational: adding either is a JSON entry. Effects compose multiplicatively and
can be scoped to regions or to an aircraft class, which is how a volcanic ash
cloud or a type grounding works without special-casing anything.

### The event deck works through cost and capacity, not demand — 2026-07-22

Designed around the spill-cushion finding recorded above. A sector already
turning traffic away does not notice a demand shock — it just spills less. So a
demand event has to be severe (the pandemic card halves the market) to register
at all, and most of the deck moves **cost** or **completion** instead, both of
which bite regardless of how much spare demand a route has.

Completion is the important new quantity: the share of the schedule that
actually operates. It removes *seats*, so it reaches a sold-out sector where
nothing else could. There is a baseline draw every quarter (airlines cancel a
small, variable slice to weather, technical faults and air traffic control) on
top of whatever events are running.

There is a test pinning all three cases: a sold-out sector shrugs off a 10%
demand shock, and feels a cancellation or a fuel spike immediately.

### The deck was 80% bad, which is a tax rather than variance — 2026-07-22

First cut had 109 points of "bad" weight against 27 of "good". That is not
uncertainty, it is a permanent drag with extra steps, and it showed: median
outcome went to roughly break-even over 25 years. Rebalanced to 58/42 with two
more upside cards. Keep it near there.

### Fuel surcharges are what make a fuel spike survivable — 2026-07-22

`fare.fuelPassThrough`. Without it, the fuel walk killed **two thirds** of
well-run airlines. Costs moved and fares did not, which is not how the industry
works: every carrier faces the same fuel bill, so when it rises they all reprice.

Pass-through is 0.38, well below 1, so a spike still hurts — you recover only
part of it. Critically it keys off the **spot** price rather than what the
carrier actually pays, because the market reprices on what everyone pays. That
is precisely what makes a hedge valuable, and it falls out of modeling it
correctly rather than being bolted on.

### Hedging is a gamble, not free insurance — 2026-07-22

It costs a premium over spot, and because the fare surcharge tracks spot, a
carrier that locks in and then watches fuel fall pays the high price while fares
drop around it. Airlines have lost fortunes doing exactly this.

Measured: hedging every time fuel dipped below 0.95x its long-run level actively
*hurt* the fixture — median outcome was higher with hedging switched off. Lowered
the AI's trigger to 0.82x, where it behaves like insurance should: failures fall
from 3/40 to 1/40 and both tails improve, at a small cost in the median.

### The technology tree was worth 27 points of margin — 2026-07-22

First cut gave a fully-teched carrier +25% fare, +25% demand and −17% fuel.
Median outcome was 47x starting capital and failure fell to 5%; a carrier that
finished the tree could not lose. Every effect was halved toward neutral. The
whole tree is now worth roughly 12% on fare and demand and about 10% off the main
cost lines — a real improvement for a $438M program, but not a different game.

It is nonetheless the largest single lever a player has. Measured with the
fixture: **without tech investment, failures go 4/40 to 9/40 and the median
outcome falls from 14.3x to 1.3x.** That gradient is the intended shape — the
game should reward the operator who invests through a downturn.

### The economy is anchored to published airline unit economics — 2026-07-22

Prompted by a player asking whether routes were making too much "by a factor of
2-10x", and whether the numbers could be tied to real data.

Route-level **profit** is one of the most closely-guarded figures in aviation and
is not published anywhere. But the quantities that determine it are public and
standardized — **yield** (revenue per revenue passenger-km), **RASK** (revenue
per available seat-km), **CASK** (cost per available seat-km) and load factor —
and route profit is just their arithmetic. Those are the anchor, and they are a
better one than route P&L would have been.

Measured ASK-weighted, the way airlines report:

| | model | published |
|---|---|---|
| yield | 10.31 c/km | 10-12 |
| RASK | 9.07 c/km | 8.5-10 |
| CASK | 8.34 c/km | 8-9.5 |
| operating margin | 8% | 5-12% |

Five genuine errors came out of the comparison:

1. **Every route flew 100% full.** No airline fills every seat on every
   departure — traffic peaks by day and season, the two directions never
   balance, there are no-shows. Industry load factor is 80-86%. Since
   RASK = yield × load factor, perfect filling inflated revenue about 20%
   against realistic costs. Capped at `demand.maxLoadFactor` 0.88.
2. **Lease rates were about double market.** An A320neo-class aircraft leases
   for roughly $390k a month, not $720k. Ownership was eating **24-27%** of
   operating cost against a published **10-13%**, crowding fuel down to 15%
   against a real 25-30%.
3. **Maintenance was roughly 1.8x real** per block hour.
4. **Corporate overhead did not exist.** Head office, IT, sales, scheduling and
   admin run 10-15% of airline operating expense and sit inside every published
   CASM figure. The model had no line for it.
5. **Tax did not exist.** Every dollar earned compounded straight back onto the
   balance sheet.

The fare curve's three constants were **fitted by least squares** to published
yield-per-km by distance rather than tuned by hand, landing within ~5% across the
whole range. Aircraft prices are now market transaction values rather than list —
airlines never pay list — with lease at the real 0.7-0.8% of value per month.

**Refit the fare constants together, not one at a time**, and check the cost
*composition* against the published opex split, not just the headline CASK. Every
error above showed up as a composition anomaly first.

### Realistic average economics do not make the game hard — 2026-07-22

Worth recording because it is counter-intuitive and cost a lot of effort to
establish. After the anchoring above, difficulty measured **slightly worse**:
median growth went from 8.1x to 12.3x and losing quarters after year five went
from 15% to 0%.

The reason is that neither the AI nor a competent player flies the *average*
route. Both probe and select the profitable subset, so moving where the average
sits barely moves what a good operator earns — it just changes which routes make
the cut. **Difficulty cannot come from the level of the economics.** It has to
come from variance and from commitments that cannot be exited:

- Revenue is effectively deterministic. Demand noise is the only stochastic input
  and it does nothing at all on a route that is selling out — which, with the
  load-factor cap, is every strong route.
- Costs are entirely deterministic.
- Bad routes can be exited cheaply, so a mistake is not durable.

That points at operational variance that bites regardless of spill (a baseline
completion factor — cancellations and irregular operations, which the Phase 3
tech tree already presumes exists via "predictive maintenance"), and at Phase 4
leverage. Demand-shock events alone will glance off, for the reason in the
deferred entry above.

### Pricing posture is a cabin decision, not just a price one — 2026-07-22

Player feedback: "premium currently feels like a cheat code, but it's not like
that in the real world."

Correct, and the cause was the spill cushion again. Posture only moved fare and
attractiveness. On a sector already turning traffic away — which, with the load
factor cap, is every strong sector — the share premium sheds was being *spilled
anyway*, so it was a free uplift on revenue with no offsetting cost. Strictly
dominant, and it won 80% of profitable configurations map-wide.

Two things were missing, both real:

- **Posture changes the seat count.** The same narrowbody carries about 160 seats
  in a legacy config with a business cabin and about 190 in a low-cost one. This
  is the defining difference between the two kinds of airline and the model had
  no representation of it. Premium now trades capacity for yield and undercut
  does the reverse.
- **A premium cabin is expensive to serve.** Catering, lounges, more cabin crew
  per passenger, corporate distribution. Per-passenger cost now scales with
  posture — 3.4x for premium, 0.6x for no-frills.

`fare.posture` and `share.posture` were consolidated into one `posture` block
with `seats`, `fare`, `attractiveness` and `paxCost`. They only make sense
reasoned about as a set, and having them in two places is exactly how `seats`
went missing in the first place.

The multipliers were swept for balance rather than picked. The resulting pattern
matches the real industry closely and was not designed in:

| sector | premium | match | undercut |
|---|---|---|---|
| short (400-1,200 km) | 0% | 0% | **100%** |
| medium (1,200-3,500) | 0% | **62%** | 38% |
| long (3,500-7,000) | **70%** | 25% | 5% |
| ultra-long (7,000+) | **100%** | 0% | 0% |

Low-cost carriers own short-haul with dense fits; long-haul is where a premium
cabin pays. The choice changes the answer by more than 10% on 57-100% of routes
depending on band, so it is a real decision rather than a default.

Carriers with no fixed posture (the balance fixture, and a human player) now
weigh all three when opening. An archetype with a posture in its config keeps it
— that posture is its identity, and a ULCC that starts flying premium is no
longer a ULCC.

### Rival route economics are shown in full, not estimated — 2026-07-22

The sector dossier lists every carrier on the market with their aircraft,
frequency, share, load factor, fare and quarterly net — the real figures the sim
settles, not fuzzed estimates.

Airlines do not publish route-level accounts, so there is a case for showing only
what is observable. It was rejected: an operator really can read a competitor's
schedule and gauge off the departure board and get close, and a player who cannot
tell whether a rival is bleeding or thriving on a sector has no basis for the
decision the sector is asking them to make — fight, or fold. Legibility wins,
consistent with the "show the components" rule in CLAUDE.md §6.

### Most city pairs are unprofitable, and that is correct — 2026-07-22

Sampling 1,095 city pairs against every aircraft gauge at 1, 2 and 4 aircraft:
**81% cannot be made profitable in any configuration.** This matches reality —
the overwhelming majority of city pairs have no nonstop service, because none
would pay.

Raised as a possible gap ("some segments should not be profitable under any
circumstances") but the model already does this. It is not *felt* because a
player self-selects plausible routes and because exiting a bad one is cheap: the
opening fee is sunk, and closing costs nothing beyond any lease break.

### Rivals are dealt per game, not a fixed cast — 2026-07-21

`rivals.json` holds a pool of sixteen carriers and a `draw` block, not a roster.
Each game draws 5–9 of them, deals each an archetype, an entry turn and a
personality (aggression, thrift, reach), and stores the result in
`GameState.rivalPlan`. The draw uses a stream derived from the seed
(`seed ^ 0x9e3779b9`) so planning the cast does not perturb the RNG the quarters
run on — same seed, same cast, same game.

The first cut had a fixed cast in a fixed order with fixed archetypes, so every
game faced Kestrel Air the ULCC at turn 4. A player who learned one cast could
coast on it forever. Now the archetype mix, the size of the field and the entry
cadence all move run to run.

Personality multiplies the archetype's knobs rather than replacing them, so a
carrier still legibly *is* its archetype — you can watch it for a few quarters
and name the strategy — it just has a temperament.

### Rivals must be pulled toward the player, not left to wander — 2026-07-21

`bestIncursion` in `sim/ai/common.ts`, plus `playerFocusMultiplier` in the draw
block.

Making rivals exist was not enough to make them matter. With carriers ranking
destinations by demand from their own hubs, only **5% of the player's sectors
were ever contested** — the map has 22,300 city pairs and eight carriers simply
never collided. The player would not have noticed rivals existed, which fails
Phase 2's acceptance test outright.

Two changes fixed it. Carriers now also evaluate markets *someone else has
already proven*, ignoring their own hub-ranked shortlist — that is how a
profitable route draws entrants in reality. And a market flown by the **player**
scores higher than an equally good one flown by another AI, because pillar 4 says
competitors enter in response to visible player profits. The player is the
newsworthy operator; this is the design, not a thumb on the scale.

An incursion must still **touch the carrier's own network** — one endpoint has
to be a city it already serves. Letting a carrier contest any market anywhere was
tried and it dissolved the whole geography: home base stopped mattering, fortress
hubs became indistinguishable from point-to-point carriers, and a Port Moresby
operator with no business anywhere grew to 69 sectors and $8.4B by opening
transatlantic trunk routes. Reach has to be earned.

Result: **34% of player sectors contested, and a rival costs 28% of the share on
the sectors it contests.**

### The ambient incumbent was cut once named rivals existed — 2026-07-21

`share.incumbentBase` 0.18 → 0.10, with `demand.k` 160,000 → 140,000 to hold the
absolute level.

In Phase 1 the incumbent *was* the competition and was tuned to give sensible
shares on its own. With named carriers on the board it swamped them: one rival
entering cost only a sixth of your share, which is not enough to change any
decision. It now represents only the small operators the game does not model.
Raising it back makes rivals irrelevant.

### Deep-cloning the state was 74% of the runtime — 2026-07-21

`engine.ts` `clone()` no longer uses `structuredClone`.

Every `applyAction` deep-copied the whole game — including a history that grows
to hundreds of quarterly records — and rivals take several actions each per turn.
A CPU profile put 74% of a headless game in `structuredClone` alone; a 100-turn
game took 2.6 seconds, and the browser 26ms a turn before any AI thinking.

The replacement copies only what actions actually mutate (carriers, their tails,
routes) and **shares** `history`, `rivalPlan` and `enteredRivals`, which are
always replaced wholesale rather than edited. **2586ms → 174ms, a 15x speedup,
with byte-identical results.**

That sharing is load-bearing and invisible: mutating any of those three arrays in
place would silently corrupt earlier states. `tests/purity.test.ts` enforces it.

Bounding the AI search (capped hubs, shortlisted incursion targets, gauge
shortlist) was worth ~2.3x on top and is worth keeping, but note it was *not*
where the time was — three rounds of optimization there moved almost nothing
because the profile had not been taken yet. Profile first.


### Demand model calibrated against real traffic, but only loosely — 2026-07-21

`demand.k = 160000`, `populationExponent = 0.55`, `distanceExponent = 0.6`,
`weightExponent = 0.7`.

A player noticed that LAX–LAS lost money at every aircraft gauge, which is absurd
for one of the densest corridors on earth. Checking modeled market sizes against
approximate real traffic showed a *structured* error: accurate for small city
pairs, up to 13× too high for big×big pairs. Population entered the gravity
product linearly, so mega-pairs ran away. London–Paris came out at ~230,000
one-way passengers a week against a real figure nearer 32,000.

**A naive four-parameter least-squares fit was tried and rejected.** It returned a
population exponent of 0.26 (published air-travel gravity models sit at 0.6–1.0)
and a *negative* weight exponent, which would mean richer cities fly less. The fit
was chewing on noise: across the reference pairs, a 210× range in population
product produces only a 4× range in traffic, because the variables that actually
decide a corridor — competing high-speed rail, island geography, hub structure —
are not in the model at all. Tokyo–Osaka and London–Paris are suppressed by rail;
Seoul–Jeju is an island pair with no alternative.

**The best-fitting distance exponent (0.40) was deliberately not used.** The
reference set is survivorship-biased: it samples the *busiest* route in each
distance band, so it measures the decay of the envelope rather than of typical
routes. 0.60 was taken instead — inside the literature range, and with a better
worst case.

Result: median error against the reference set fell from 2.94× to **1.76×**, worst
case from 13.2× to **5.40×**. The three worst residuals are exactly the pairs the
model cannot represent: Seoul–Jeju 0.19×, Tokyo–Osaka 5.17×, London–Paris 4.89×.

**Do not chase a better fit without adding a surface-competition term.** The
remaining error is not calibration slop, it is missing physics.

**Reference set** (approximate pre-2020 one-way passengers/week; recalled, not
authoritative — treat as a shape check, not ground truth):

| pair | /wk | pair | /wk | pair | /wk |
|---|---|---|---|---|---|
| SEL–CJU | 134,000 | LON–PAR | 32,000 | LON–HKG | 12,000 |
| SYD–MEL | 88,000 | NYC–BOS | 30,000 | OSL–CPH | 12,000 |
| BJS–SHA | 67,000 | DXB–LON | 30,000 | LAX–SYD | 8,000 |
| DEL–BOM | 65,000 | BCN–MAD | 29,000 | DUB–MAN | 8,000 |
| SAO–RIO | 50,000 | LAX–SFO | 27,000 | DXB–SYD | 5,000 |
| TYO–OSA | 48,000 | CHI–DEN | 26,000 | ZRH–PRG | 4,000 |
| JNB–CPT | 40,000 | SIN–HKG | 25,000 | | |
| NYC–CHI | 38,000 | LAX–LAS | 24,000 | | |
| NYC–LON | 38,000 | SIN–SYD | 13,000 | | |
| MEX–CUN | 35,000 | LAX–TYO | 12,000 | | |

### Fare and cost weight exponents must move together — 2026-07-21

`fare.weightExponent` and `fleet.costWeightExponent` are both 0.45 and should be
kept equal.

City economic weight scales fares. It must scale the *local* cost lines — crew and
ground handling — by the same amount, or margins depend on how rich a route's
cities are rather than on how well the route is run. An earlier pass had costs at
0.9 against fares at 0.45, which quietly made every wealthy market unprofitable;
that is what kept LAX–LAS negative after the demand fix.

Fuel and lease rates are world prices and are deliberately excluded from the cost
scaling. That leaves low-income regions at a real structural disadvantage, which
is intended and true to life.

### Fleet aging: saturate, commit, and give owners a lever — 2026-07-21

Three changes, made together because each alone makes things worse.

1. **The maintenance curve saturates.** It was a straight line, unbounded — 3.66×
   new by year 25 and still climbing. Every carrier that held a fleet two decades
   died of maintenance regardless of how well its network was run; headless games
   bankrupted at turns 56–87 with flat revenue and maintenance tripling. Now
   approaches `maintPerBlockHour + maintAgeSlope × maintAgeSaturationYears`
   (~1.84×). CLAUDE.md §6 always said "maintenance cost *curve* by age"; the line
   was the bug.
2. **Leases carry an 8-year term with a break fee.** Resetting an airframe's age
   previously cost only the one-month deposit, so leasing could churn to a fresh
   aircraft essentially free and strictly dominated owning. That gutted the
   lease-vs-buy pillar.
3. **Owned aircraft can be overhauled** at 10% of list price, resetting effective
   age. Without it, owning was a one-way bet against the curve with no answer.

Overhaul cost was swept: at 22% nobody ever overhauls, at 6% it is automatic. 10%
makes it situational, which is the point.

Result: over 25 years on one sector, buy-and-hold returns ~$455M against
lease-and-churn's ~$338M — owning wins long-run, leasing preserves the capital you
would need up front. That is the intended trade-off.

### The Phase 1 "passive AI carrier" is an ambient term, not an entity — 2026-07-21

CLAUDE.md Phase 1 calls for "one passive AI carrier as a demand sink". It is
implemented as the incumbent term in `demandShare` rather than as a carrier in
`GameState`. A lone player therefore never captures a whole market, which is the
stated purpose, without half-building Phase 2's rival system. Phase 2 replaces the
ambient term with named archetypes.

### Vanta 5 re-based from 737-800 to 737 MAX 8 — 2026-07-21

It was strictly dominated on every absolute stat by the A320neo-class Aros N2 —
a generational mismatch, pairing a 2000s airframe against a 2020s one, not a
judgment about the manufacturer. Re-based on the true current-generation peer, it
now wins 355 sectors against the A320neo's 342.

Vanta 6 (757-200) remains dominated by the A321neo-class Aros N3, and that is
**left deliberately**: the 757 went out of production in 2004 precisely because
the A321neo family replaced it. The model is being accurate.

### Phase 0 groundwork — 2026-07-21

- **Equirectangular projection**, not Robinson. Separable (x depends only on
  longitude, y only on latitude), which makes antimeridian splitting and
  hit-testing trivial. Great-circle arcs still bend correctly because they are
  sampled in spherical space before projection.
- **No `tsx`/`ts-node`.** Node 23+ runs the TypeScript scripts natively. One
  fewer dependency to justify.
- **Save v1 has no migration to v2.** Phase 0 saves have no fleet and cannot be
  reconstructed into a Phase 1 game. `loadAutosave` swallows the error and starts
  fresh; an explicit import reports it. Real migrations start from v2.

### The AI planned against an O(n^2) price — 2026-08-07

`feedFactor` and `stationOverheadFor` each scanned every route in the world on every
call, and the planning loops call them per route, per posture and per aircraft type.
On a 1,131-sector field they were the two largest costs in the whole simulation —
**26.0% and 7.1%** of a game's runtime — which is why `buildMarketIndex`, the usual
suspect, turned out to be 2.1% and the earlier guess about it was wrong.

The settlement path never had this problem: it tallies each carrier's cities once and
divides. The AI's probe path simply never got the same treatment. `buildNetworkTally`
now builds that tally once per board and both functions take it as an optional
argument, so the two paths share the arithmetic instead of one of them re-deriving it.

Profiled game 19.5s -> **10.9s**; both functions left the top eight entirely.

Two details worth keeping:

- The cache is keyed on the **identity** of `state.routes`, not its contents. `clone()`
  replaces that array wholesale whenever routes change, so a stale tally cannot outlive
  the board it describes. If that ever stops being true this cache is the first thing
  to suspect, which is why it says so at the definition.
- The tally carries an `onBoard` Set purely so the one caller that needed
  "is this route live?" does not answer it with `routes.some()` — which would have put
  the O(n) scan straight back and silently undone the whole thing.

The cross-layer test that pins `probe` to the settlement to the cent covers this: it
is what makes a shared-arithmetic change like this safe to make at all.

### A shape test that was measuring its own noise — 2026-08-07

The Territorial test asserted two things: that the archetype ends up holding more of
its hub than a legacy carrier, and that it prices its hub dearer. It ran 12 seeds and
compared MEDIANS.

About one Territorial and half a legacy carrier survive per seed, so those medians
were taken over roughly a dozen observations drawn from distributions that almost
entirely overlap — Territorial 7-100%, legacy 13-75%. Going from 12 seeds to 16 moved
the legacy median from 34% to 62% and flipped the assertion, with no change to the
game at all.

This is the dangerous kind of failing test, because the obvious response is to tune
the game until it passes — fitting the balance to the sampling noise and calling it
an improvement. It nearly got that treatment here.

Now 24 seeds compared on pooled means, with the minimum sample sizes asserted so the
comparison cannot silently go vacuous. It costs 217s, which is most of why the suite
is slow, and that is the right trade for a test whose whole job is to pin an
archetype's identity.

### The rent beat stopped firing when rivals got their money — 2026-08-07

The funded growth allowance let every carrier deploy cash as fast as it earns it.
A second-order effect: hubs are contested much harder, a Territorial's median
dominance settled at ~44%, and `cornerRentThreshold` of 0.55 therefore almost never
fired — the archetype quietly stopped charging rent, which is the entire point of it.

Swept 0.55/0.45/0.38/0.30/0.24 over 16 seeds. Premium share of its own hub against a
legacy carrier: 17%/49%/84%/97%/98% against 11%/13%/22%/11%/10%, with 14/12/10/9/8
Territorials surviving. Set to **0.45**.

Below 0.45 the archetype starts working against itself. At 0.38 the legacy carrier
ends up holding MORE of its hub (60% against 53%) because the Territorial prices
itself off its own city, which inverts the thing the archetype is for; by 0.30 nearly
every home sector is premium, which is a constant rather than a decision. At 0.45 the
rent fires on about half its home network.

### fleetBookValue, memoised on the fleet array — 2026-08-07

Second-largest cost in the sim once the route scans were dealt with, for a function
that is one `reduce` over a fleet. It sits under `bookValue` -> `sharePrice`, which
every carrier evaluates for every other carrier when weighing share purchases, so it
runs O(carriers^2) a turn over fleets the funded allowance made much larger.

Same pattern and same caveat as the network tally: keyed on the identity of the fleet
ARRAY, which is replaced wholesale on any change including quarterly depreciation, so
a stale entry cannot outlive the metal it describes. A whole game went 4.0s -> 3.6s.

After this the profile is flat — the largest single cost is 6.8% — so the next
optimisation here would have to be structural rather than another memo.

### A determinism canary, because the suite could not see a runtime change — 2026-08-07

An `npm update` (Node 26.6.0 -> 26.7.0, vite 7.1.7 -> 7.3.6, vitest 3.2.4 -> 3.2.7)
prompted the question of whether the sim still replays identically. It does — a
24-seed 100-turn fixture came back byte-identical across the Node bump.

The gap it exposed is that the suite could not have told us. Every determinism test
here compares two runs INSIDE ONE PROCESS, so all 505 would pass on a runtime that had
quietly changed what `Math.log` returns, while every save in the wild diverged on
reload. `Rng.normal` is Box-Muller (`log`, `sqrt`, `cos`), distance is spherical
trigonometry (`sin`, `cos`, `atan2`, `asin`), and ECMAScript specifies none of them to
bit precision — V8 has changed its own more than once.

`tests/runtime-canary.test.ts` pins literal values with `toBe`. It covers the RNG
stream and the distance function and deliberately NOT any game outcome: outcomes
depend on `constants.json` and are meant to move when the balance is tuned, and a
canary that fired on every constant change would be switched off within a week.
Nothing in it moves unless the arithmetic itself does. Costs 1ms.

A failure there is not a balance regression. It means the ground moved, and every
existing save is suspect until someone establishes what changed and whether a
migration is owed.

### Softening the posture cost spread — tried and reverted 2026-08-13

A player opened London-Paris with three widebodies on Skim, lost ~31M a quarter and
reported it as a handling bug. Not a bug, and not the aircraft: switching Skim -> Match
recovered **28 of the 31M**; the aircraft were worth 3-6M.

The mechanism is a units mismatch. `paxCost` multiplies a FLAT $22 a head, while `fare`
multiplies a fare that scales with sector length — so Skim costs +$79 a head everywhere
but earns +$61 on a 343km sector against +$353 on a 5,570km one. Premium postures
therefore destroy value on short sectors and win on long ones. Defensible; invisible.
Three observers (player, author, a second model) each diagnosed it wrongly.

**The legibility half shipped** — the tooltip now discloses the live rate ("Skim costs
about $101 a head to serve, against $22 at Match").

**The tuning half did not.** Skim already removes 28% of the seats, so 4.6x per head on
top looked like double-counting. Swept as `1 + (old - 1) * k`, protecting the number of
DISTINCT best postures across six sector lengths:

| k | skim | distinct winners | LON-PAR penalty | verdict |
|---|---|---|---|---|
| 1.0 (kept) | 4.60 | 3 | 14.8M | — |
| 0.7 | 3.52 | 3 | 6.9M | **fails 3 tests** |
| 0.6 | 3.16 | 2 | 4.5M | collapses diversity |

k=0.7 looked like the knee on my own metric and on a 16-seed survival check (55% -> 60%,
posture mix undercut 84% -> 73%). The suite disagreed, and it was right:

1. **history**: two of six worlds never recover from the scripted crises.
2. **economics**: undercut stops winning at LON-FRA (720km, 4x AROSN2). My sweep used one
   fleet size on six routes and missed the boundary moving under a different config.
3. **finance**: quote-vs-charge divergence (below).

k=0.9 fixes 1 and 2 and still trips 3. **The lesson is about the sweep, not the constant**:
six routes at one fleet size is not enough to characterise a change that moves a boundary,
and a survival check on `present` says nothing about `history`.

### A latent quote-vs-charge bug in acquisitions — found and FIXED 2026-08-13

Falling out of the above, and worth more than the tuning was. `acquisitionCost` and
`mergeCarrier` do not always agree:

| constants | target | quoted | charged | gap |
|---|---|---|---|---|
| current | solstice / tessera / talon | — | — | agree to 1e-13 |
| k=0.9 | **harrier** | $0.588B | $0.583B | **-$4.91M (-0.84%)** |

The buyer is charged LESS than quoted — the same direction as the dominance-premium bug
this test was written for. It is carrier-specific, not precision drift: `harrier` does not
exist in the current-constants run at all. The change did not cause this; it changed which
rivals a seed produces and one of them exposed it.

So the test passes today partly by luck about which carriers seed 41 has at turn 40, and
ANY future change to the economy can trip it. That makes it a live correctness bug in the
financial layer, and it should be fixed before this constant is retuned — otherwise the
next sweep will keep tripping over it and reading it as its own fault.

this change's job and the sweep should not be tuned to it.

### The stale fleet book value behind it — fixed 2026-08-13

The quote-vs-charge gap above was a symptom. The cause was the `fleetBookValue` memo
added on 2026-08-07, keyed on the identity of `carrier.fleet` — sound only while nothing
changes what an aircraft is WORTH without replacing that array. Quarterly depreciation
did exactly that, mutating `bookValue` in place, so the cache kept serving last quarter's
figure.

Its own comment named this failure mode ("if aircraft ever start being mutated in place,
this is the first thing to suspect") and the mutation was already three lines away in
`endTurn`. Writing the caveat is not the same as checking it.

Nothing failed loudly. Book value feeds `sharePrice` -> market cap -> borrowing capacity,
acquisition quotes, takeover triggers and the score, so the whole financial layer was
running a little rich. Measured on seed 41 at turn 40: four carriers carrying up to
**$9.8M** of phantom book value, and an acquisition quoted **0.84% above** what the merge
charged — the buyer tested against one price and charged another, which is the third time
this file has been bitten by that shape.

Fixed by making depreciation REPLACE the array rather than mutate the aircraft in it. The
two remaining in-place writes both set `routeId`, which `fleetBookValue` never reads.

Pinned by `tests/finance.test.ts` -> "the fleet book value cache cannot go stale", which
compares the memo against a fresh sum for every carrier every quarter of a 40-turn game.
Verified to FAIL on the old code (harrier, turn 4, $1.98M out) before being kept.

Found only because a rejected balance experiment changed which rivals a seed produces and
one of them tripped it — the suite was passing on luck about seed 41's cast.

### The fix did not destabilise the economy — the two tests are under-powered — 2026-08-14

The stale-book-value fix turned two suite tests red, and the obvious reading was that
correcting book values had made the world fragile: `grossAssets` fell, so
`borrowingCapacity` (1.2 x assets - debt) fell, so carriers failed the crises. Several
hours went into finding a compensating constant on that theory.

**The theory was wrong, and the matched control is what showed it.** Running the SAME
criteria on seeds the tests do not use, on the pre-fix engine that ships on main today:

| criterion | main today | with the fix |
|---|---|---|
| history recovery, 12 unused seeds | **10/12** | **11/12** |
| antitrust, 10 seeds | **9/10** (seed 200: ZERO survivors) | **9/10** (seed 100: one) |

The failure RATE is unchanged. The fix perturbs trajectories, and on the six seeds the
history test happens to use, one world flipped from 2 surviving carriers to 1. That is a
coin landing differently, not a margin being crossed.

Two things follow.

**No compensation is warranted.** `maxLeverage` stays at 1.20. The sweep said 1.21+ makes
both tests pass, but the value that actually restores the lost borrowing capacity is
**1.2038** — owned fleet is only 17.6% of gross assets, so a 1.8% book correction moves
assets by 0.32%. Anything above that is not restoring what the fix removed, it is buying
a green tick.

**The tests are the defect.** Both assert absolutes — six of six worlds recover, every
seed keeps more than one carrier — on outcomes that fail roughly one time in ten by
nature. At an 8% per-world death rate, six seeds all passing has about a 60% chance; that
test fails two times in five on an arbitrary draw. And the proof does not depend on the
fix at all: **main, today, produces dead worlds on history seeds 201 and 203, and a world
with zero surviving rivals on antitrust seed 200.** Those tests are green only because of
which seeds they picked.

Left for a decision rather than changed here, because widening an invariant is not a call
to make unattended: both should measure the RATE across more seeds with a stated
tolerance instead of asserting perfection on six. The antitrust test additionally
conflates two things — a bankruptcy cascade trivially gives the last survivor 100% share,
which is not the consolidation the §9 doctrine is about.

**The methodological lesson, third time this week.** The `paxCost` sweep, the phantom
handling defect, and this all failed the same way: measuring the thing that changed
instead of measuring whether it changed anything. The control run costs one extra
command and would have replaced a whole evening here.

