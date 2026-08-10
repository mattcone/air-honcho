# Ideas

Cut scope and deferred work. CLAUDE.md §10 says to log ideas here rather than in
code, so this is where things go when they are worth doing but not now.

An entry here is not a commitment. [DECISIONS.md](DECISIONS.md) records what was
decided and why; this file records what was noticed and parked.

*Belly cargo and the absolute fuel calibration were both on this list and were built
on 2026-08-02 — see DECISIONS.md.*

---

## Reshape the ground-handling split

**Why:** handling is charged as `1200 flat + 4/seat` per departure, which is $20.67
a seat for a 72-seat turboprop against $6.50 for a widebody. It makes handling the
largest single cost line on a regional sector — 29% of revenue, ahead of fuel — and
it is why no turboprop route is profitable anywhere on the map. Four of the
twenty-four aircraft types are effectively unbuyable.

**What was tried:** `200 + 8/seat`, fitted to published turn costs. It fixes the
class (turboprops +$0.36M, regional jets quadruple) and breaks balance: the
divergence invariant in `regression.test.ts` fails and survival at seed base 1000
falls 12/20 → 5/20. `700 + 5/seat` was worse and less stable.

**What it needs:** a tuning pass, not a constant swap. Two specific traps —
`distributionPerPax` already covers passenger ground handling, so the per-departure
line must only carry gate, ramp, landing and navigation (published turn costs
include more than that); and cutting costs lifts rivals as much as the player, so
the second-order effect has to be measured, not assumed. Full workings in
DECISIONS.md, 2026-08-02.

## Payload-range trade

**Why:** `canReach` is binary — an aircraft flies its full seat count at any
distance up to `rangeKm`, then nothing. Real aircraft trade payload for fuel near
maximum range; an A321XLR at full range carries about 180 passengers, not 220.
The current model lets narrowbodies fly their absolute maximum sector fully loaded,
which flatters them on exactly the long thin routes where widebodies should start
to win.

**Caveat:** measured at the distances the game actually flies, the effect is small
— a few percent of seats on the sectors where it bites. Worth doing for honesty and
for ultra-long sectors, not as a fix for the widebody problem.

## Slot scarcity

Already noted as deferred elsewhere. Would do more for market depth than anything
else on this list: it is the reason real carriers cannot simply answer demand with
more frequency, and its absence is why spreading beats sharing and why 3+ carrier
markets stay rare (2.9% of served markets).
