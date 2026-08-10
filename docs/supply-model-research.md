# How the industry actually models this — 2026-08-02

Research note, prompted by "is there a better way to model real-world supply and
pricing dynamics?" Nothing here is implemented. It exists because the demand audit
hit a wall that turned out to be a modelling choice rather than a tuning problem.

## The wall

`docs/demand-audit.md` establishes that load factor cannot be unpinned from its
ceiling by tuning the demand side, because capacity is *chosen in response to*
demand: a carrier sizes its fleet to the traffic it expects, so `won >= capacity`
at any demand level and `min(won, capacity x ceiling)` collapses to the ceiling.
Halving `demand.k` left the at-ceiling share at 87.2%.

That conclusion is correct **given a deterministic demand model**. The industry
does not use one, and that is the whole difference.

## What the industry does

### Supply: the Boeing spill model

Airlines have modelled this since the mid-1970s. Demand for a *departure* is a
random variable, not a number: normally distributed around a mean, with a
coefficient of variation — the **K-factor** — of roughly **0.35** (MIT's airline
management course uses k = 0.35; some market studies report ~0.48). Passengers
turned away are **spill**; those who take another flight are **recapture**.

Load factor is then not a rule at all. It is
`E[min(D, C)] / C` — an emergent property of how well capacity matches an
uncertain demand. For normal demand this has a closed form:

```
  spill = sigma * ( phi(z) - z * (1 - Phi(z)) )     where z = (C - mu) / sigma
  load  = mu - spill
```

Run it at k = 0.35 against a 100-seat departure:

| demand factor (mu/C) | load factor | spill |
|---|---|---|
| 0.6 | **59.8%** | 0.4% |
| 0.7 | **68.7%** | 1.9% |
| 0.8 | **76.1%** | 4.9% |
| 0.9 | **81.8%** | 9.1% |
| 1.0 | **86.0%** | 14.0% |
| 1.2 | **91.4%** | 23.9% |
| 1.8 | **96.9%** | 46.1% |

Against what this sim does today:

| demand factor | our load factor |
|---|---|
| 0.9 | 90.0% |
| 1.0 | **93.1%** |
| 1.2 | **93.1%** |
| 1.8 | **93.1%** |

**That table is the finding.** The spill model produces a smooth 60–95% curve —
precisely the target shape the audit could not reach — and it reaches it without a
single new tuning constant. It also explains the published 82–84% industry average
that `maxLoadFactor`'s comment agonises over: a network sized near demand factor
0.9–1.0 *averages* 82–86% because some departures go out full and others half empty.

Note what it deletes. `demand.maxLoadFactor` and `demand.loadCeilingMax` stop being
needed: the ceiling stops being a constant anyone has to justify and becomes a
consequence of variance. The long comment on `maxLoadFactor` warning not to
conflate "what a carrier fills on a good route" with "what its network averages"
exists only because the model has no variance to produce the difference.

### Share: QSI — we already do this

Boeing's **Quality of Service Index** is the standard share model:
`QSI = a1*x1 + a2*x2 + ...` over frequency, gauge, aircraft type, elapsed time and
connections, normalised across the carriers in a market to give share. Our
`attractiveness()` — frequency^0.62 x gauge^0.40 x posture, divided by the sum over
the market plus an incumbent term — **is** a QSI model. This part of the sim is
already industry-standard in shape, and no change is proposed.

### Pricing: EMSR, and why we should NOT adopt it

Revenue management is Belobaba's **Expected Marginal Seat Revenue**: nested fare
classes with booking limits set so the marginal seat is sold to the class with the
highest expected revenue, `EMSR_i(S) = R_i * P_i(S)`.

**This fails the board-meeting test (CLAUDE.md pillar 1) and should not be built.**
Fare-class nesting and booking limits are delegated well below the C-suite; the
plan explicitly rules out per-seat fares. The *consequence* of running revenue
management well — a higher achievable load — is already modelled at the right
altitude, as technology programs that lift the load ceiling. Under a spill model
those same programs would instead **reduce the K-factor**, which is exactly what
revenue management does in life: it does not raise the physical ceiling, it narrows
the uncertainty you have to hold capacity against. That is a more honest mapping of
the same tech tree onto the same buttons.

## What I would change, in order

**1. Replace the deterministic clamp with the spill formula.** In
`computeRouteEconomics`, replace

```ts
const paxOneWay = Math.min(directedOneWay, capacity * ceiling);
```

with the closed-form expected load above, using `sigma = k * directedOneWay` and
`C = capacity`. One new constant, `demand.departureKFactor` (0.35). Deletes
`maxLoadFactor`, `loadCeilingMax`, and the `contestedCeiling` arithmetic.

*Predicted effect:* load factor becomes an outcome across roughly 60–95%, varying
with how well each carrier's build matches its market — the audit's target shape,
reached structurally rather than by tuning. Spill falls from ~48% to the 5–25% band
the table shows, because most of today's "spill" is an artefact of pretending a
week's demand arrives as one lump.

*Risk, and it is real:* every route's economics shift at once. A route at demand
factor 1.4 currently books 93.1% of its seats and would book 94.3% — barely moved —
but one at 0.8 drops from 80% to 76.1%. Margins would need re-measuring across the
board, and the difficulty knobs re-checked against them. This is a day of work with
`npm run analyze` as the instrument, not a constant change.

**2. Re-point the revenue-management tech at the K-factor.** The four programs that
currently multiply `loadCeiling` would divide `departureKFactor` instead. Same
buttons, same tree, and it becomes true: revenue management narrows demand
uncertainty rather than raising a physical ceiling.

**3. Retire `share.spillCapture` in favour of a real recapture rate.** The
`spillCapture` constant added today is a crude stand-in for the industry's
recapture rate. Under a spill model it can become what it is actually called, and
be applied to the *expected* spill the formula produces rather than to a
deterministic remainder.

**4. Leave QSI and pricing alone.** The share model is already right in shape, and
EMSR is below the altitude this game models.

## What this does not fix

Nothing here makes short-haul thinner, widebodies competitive, or markets more
contested — those are separate findings in the audit with separate causes. This is
specifically the answer to "why is every route at the same load factor", and it
answers it by removing the constant that was answering it.

## Sources

- [MIT 16.75J Airline Management — Airline Demand Analysis and Spill Modeling](https://ocw.mit.edu/courses/16-75j-airline-management-spring-2006/f990b2cd2141f75cd9b348051af762e7_lect4b.pdf)
- [Spill Modeling for Airlines](https://www.academia.edu/28296239/Spill_Modeling_for_Airlines)
- [Airline spill analysis – beyond the normal demand (ScienceDirect)](https://www.sciencedirect.com/science/article/abs/pii/S0377221799001940)
- [Scaling a market spill-recapture model for estimating airline demand](https://www.osiopt.com/blogs/scaling-a-market-spill-recapture-model-for-estimating-airline-demand-with-kubernetes-part-1)
- [Understanding Quality of Service Index (QSI Fundamentals)](https://www.scribd.com/document/363980903/QSI-Fundamentals)
- [Airline Partner Selection Optimization Based on an Improved QSI Model](https://tnuaa.nuaa.edu.cn/html/2018/5/20180508.htm)
- [Belobaba — Evolution of Airline Revenue Management](http://aviation.itu.edu.tr/img/aviation/datafiles/Lecture%20Notes/Network%20Fleet%20Schedule%20Planning%202015-2016/Lecture%20Notes/Module%2022%20-%20Evolution%20of%20Airline%20RM.pdf)
- [MIT 1.201J — Airline Revenue Management I](https://ocw.mit.edu/courses/1-201j-transportation-systems-analysis-demand-and-economics-fall-2008/0fc64f08e8343d2c4b0f2c27bc13690d_MIT1_201JF08_lec17.pdf)
- [Expected marginal seat revenue (Wikipedia)](https://en.wikipedia.org/wiki/Expected_marginal_seat_revenue)

---

## Built — 2026-08-02, and one prediction here was wrong

Implemented: `expectedLoad()` in `demand.ts` (Boeing spill model, closed form over a
normal demand with Abramowitz & Stegun 26.2.17 for the CDF), a new
`demand.departureKFactor` of 0.35, and `Conditions.kFactor` threaded to the
settlement. The revenue-management programs now divide the K-factor instead of
multiplying the load ceiling, exactly as proposed — same buttons, same tree, true
for the right reason.

**The prediction that `maxLoadFactor` becomes redundant is WRONG, and measurement
says so.** Removing the ceiling entirely was tried: median load factor came out at
**96.0%** against a published industry 82–84%, because carriers size to demand and
land where the spill curve is already flat. The two constants model different
things and both are real — the curve is variance BETWEEN departures, the ceiling is
sellability WITHIN one (seat mix, no-shows, the last middle seat nobody wants). Kept
both; together they give a median of **85.2%**, which is the right neighbourhood.

**Before and after**, medium, ~34,000 sector-quarters:

| | before | after |
|---|---|---|
| load factor p25 / median / p75 | 87.5 / 88.3 / 89.1 | **82.7 / 85.2 / 86.4** |
| at the load ceiling | 89.7% | **2.7%** |
| unprofitable sectors | 7.4% | **13.1%** |
| margin p5 | −11.4% | **−23.9%** |

The ceiling has stopped being the answer to "what is my load factor" — it binds on
2.7% of sector-quarters instead of 89.7%. Load is now an outcome of how well a build
matches its market: the back-fill experiment that used to read a flat 93.1% until a
cliff at eleven aircraft now reads 92.4 / 92.0 / 90.7 / 85.8 / 79.9 / 68.2 / 51.8
as capacity is added. A playtest sitting on eleven aircraft at LON–PAR would see
~80% where it used to see 92.6%.

**Balance moved, and it is worth a decision.** Median route margin fell 25.8% →
17.5% and unprofitable sectors roughly tripled, so the fixture's survival went
medium 13/20 → **8/20**, easy 19/20 → 18/20, hard → **2/20**. Medium's target is
~10/20 with a ±2 noise floor recorded in DECISIONS.md, so 8/20 is at the edge rather
than outside it. No compensating tuning was applied — that is a separate call.

## Reviewed — 2026-08-02, and the balance question answered itself

A review of the above found three defects, all silent, all recorded in full in
DECISIONS.md. Two matter to this note:

**The closed form was the wrong one.** `mu - E[(D-C)+]` integrates a normal tail
running to minus infinity, and since sigma is a fixed fraction of the mean that tail
never leaves — so the error grows with the mean while the answer is capped at the
seat count. It returned **zero** at demand factor 2000. Live games reach about 19,
so nothing on the board was wrong, but the model was only accidentally right.
Now the censored form `E[min(max(0,D), C)]`, exact everywhere, validated against
300k Monte Carlo draws at demand factors from 0.1 to 5000 (worst error 0.15 points).

**Item 3 of the plan above — retire `share.spillCapture` for a real recapture
rate — is now half done.** Rivals' spill was still a hard clamp while ours was a
curve, so `spillCapture` was being applied to a remainder that was almost always
zero. It now multiplies the expected spill the formula produces, which is what the
plan asked for. What is still outstanding is the constant's *name and calibration*
against a published recapture rate.

**And the balance question above is withdrawn.** Fixing the two live defects moved
medium survival 8/20 → **10/20**, dead on target, with no tuning applied: median
route margin 17.5% → 21.3%, unprofitable sectors 13.1% → 9.9%, contested markets
15.0% → 19.6%. The shift the spill model appeared to cause was mostly these bugs
being made visible by it.
