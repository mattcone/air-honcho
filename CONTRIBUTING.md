# Contributing

Thanks for looking. This is a small, opinionated project with a written design
intent, and the fastest way to have a change accepted is to know what that intent
is before you write code.

Read [CLAUDE.md](CLAUDE.md) first. It is the source of truth for what this game is
and — just as usefully — what it refuses to be. [DECISIONS.md](DECISIONS.md)
records why things ended up as they are and what has been deliberately deferred;
if an idea looks obviously missing, it is worth checking whether it was already
considered and cut.

## The one rule that decides most pull requests

**The board-meeting test.** Every mechanic has to be a decision a CEO makes in a
board meeting. Fleet plans, route entry and exit, pricing posture, capital
structure, technology roadmap: in. Crew rostering, refuelling, gate assignments,
per-seat fares: out. If a real airline delegates it below the C-suite, this game
does not model it.

This is not a style preference; it is the thing that keeps the game playable in
two minutes and keeps the simulation small enough to reason about. A feature can
be well built, well tested, and still be declined for failing it. Say in your pull
request description how your change passes.

## Ground rules for the simulation

`src/sim/` is pure. Enforced by `tests/purity.test.ts`, not by good intentions:

- **No DOM.** The simulation runs headless in Node; that is what makes the balance
  tooling possible.
- **No `Math.random`.** Randomness comes from the seeded PRNG in `rng.ts`. Same
  seed plus same inputs must produce the same game, byte for byte.
- **No `Date.now`.** The turn counter is the only clock.

`src/ui/` reads state and dispatches actions. It never mutates state directly.

**Data before code.** Aircraft, cities, events, archetypes and every tunable
constant live in `src/data/*.json`. Adding content means extending the JSON first
and the code second. A magic number in a `.ts` file is a bug.

## Balance changes

Anything that moves the economy needs evidence, not an argument:

```sh
npm run analyze                       # route economics across many games
npm run simulate -- --seed 1 --games 20
```

Include the before/after summary in your pull request. A balance change without
measurements is not reviewable, and "it felt better" is not a measurement — the
headless harness exists precisely so that it does not have to be.

Watch for the known failure mode: a single dominant strategy. If one approach wins
almost every game, the economy is broken even if every individual number looks
defensible.

## Before you open a pull request

```sh
npm test          # vitest
npm run typecheck # tsc --noEmit, strict
npm run build
```

CI runs all of these plus a headless balance summary. Tests should pin the *shape*
of the model — the trade-offs the game is made of — rather than specific balance
figures, which move whenever the constants are tuned.

If you are fixing a bug, add a test that fails without your fix. Please actually
check that it fails; a regression test that passes against the broken code is
worse than none, because it looks like coverage.

## Dependencies

There are five devDependencies and no runtime dependencies, and that is a
feature — this has to still build in ten years. Every new dependency has to be
justified in the pull request. The bar is high and "it saves a few lines" does not
clear it.

## Style

Match the surrounding code. Comments explain *why*, especially where a number was
measured or a simpler approach was tried and failed — much of this codebase's
value is in that record. British spelling is used in prose and there is a
`scripts/britscan.py` that checks it.

## Reporting bugs

A game is a pure function of seed, scenario, difficulty and home city, so the
share link from the game reproduces your exact world. Include it, along with the
turn and what you expected to happen.
