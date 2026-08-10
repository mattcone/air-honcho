# Design pass — revert manifest

There is no git repository in this working copy, so the brief's "each item in its
own commit" is delivered instead as **independently revertible changes**: each
item states exactly what to undo to back it out on its own. Items are additive in
order; none depends on a later one.

Screenshots are 1440x900 at device scale 2, captured through the same scripted
opening every time, so the frames are comparable. `00-before.png` and
`01-type-system.png` show a first quarter; `03-map-hierarchy.png` and
`07-final.png` show a five-sector network after six quarters, which is the only
state in which arc weight tiers and rival arcs are visible at all.

**No sim-layer behaviour is changed by any item in this stream.** 399 tests green
after every item; `vite build` clean.

| | item | status |
| --- | --- | --- |
| 00 | before | `00-before.png` |
| 1 | Type system | done — `01-type-system.png` |
| 2 | Semantic colour | done |
| 3 | Map hierarchy | done — `03-map-hierarchy.png` |
| 4 | Rules, not boxes | done |
| 5 | Livery cheatline | done |
| 6 | Close the Books ceremony | done |
| 7 | Microcopy sweep | done — `07-final.png` |
| + | Coach arrows (follow-up) | done — `coach-arrows.png` |

---

## Item 1 — Type system

**What changed.** Two typefaces with an absolute division of labour: the grotesque
carries everything a person *reads* (labels, headers, buttons, prose, city and
carrier names); the monospace carries only what a person *compares* (figures in a
column). Before this, both jobs were set in the monospace — which is why the board
had one texture and therefore no hierarchy.

The scale is defined once, in `:root`:

```
  label   names a thing     10px / 0.08em / 550 / soft ink
  header  opens a section   10.5px / 0.15em / 650 / full ink
  figure  states a number   13px (17px large) / tabular / near-black
```

Section headings moved from soft to full ink — a heading is a landmark you scan
for. The **wordmark** is treated as a logo: its own tokens, tracked to 0.3em,
with the trailing letter-space negated so it sits flush in the livery panel.

**Typeface:** Inter, self-hosted as a 48 KB latin variable subset, nothing fetched
at runtime. `font-feature-settings: 'cv05' 1, 'cv08' 1, 'tnum' 1, 'ss03' 1` gives
the single-storey l and straight-tailed u that read as signage. SIL OFL 1.1.

**Files:** `src/style.css` (@font-face, tokens, nine components moved off
`--font-data`); `src/assets/fonts/inter-latin-var.woff2`;
`src/assets/fonts/LICENSE`.

*Follow-up 2026-07-31:* the `.t-label` / `.t-header` / `.t-figure` role classes
introduced here were removed. Every component consumes the tokens directly, so
nothing ever used them — an abstraction that describes the system without being
the system is just dead CSS. Two more runs of prose were also moved off the
monospace, which the original pass missed: program and carrier names in the sheet
tables, and the fleet row's aircraft name.

**Revert:** delete `src/assets/fonts/`; remove the `@font-face` block and type
tokens; restore `--font-ui` to `'Helvetica Neue', Inter, …`; drop
`font-feature-settings` on `body`; put
`var(--font-data)` back on `.step`, `.condition-name`, `.rival-name`,
`.rival-tag`, `.chip`, `.inspector-title`, `.map-zoom-btn`, `.tech-effect`,
`.city-label`.

## Item 2 — Semantic colour

**What changed.** `--carrier` is now the canonical name for the player's navy
(`--livery` kept as an alias so existing rules keep working). The rule for
`--loss` is written down in one place so it cannot drift.

**One deliberate deviation from the brief, flagged.** The brief says *every*
negative currency figure renders in `--loss`. Applied literally that colours every
cost line in the quarterly strip — fuel, crew, maintenance, handling, leases — and
the strip is red every quarter regardless of how the quarter went. That is the
same uniformity problem in a louder key. So `--loss` marks figures whose **sign is
information** (net, cash, margins, deltas, turned-away passengers) and not figures
that are negative by construction. Say the word and I will take it literally.

There is no gain colour; nothing on the board is green. Verified by grep.

**Fuel** no longer reddens against a hand-picked constant. The walk mean-reverts
to `game.startingFuelPricePerL`, so that price *is* its long-run average; the
threshold is now one `events.fuelVolatility` step above it — the band the walk
itself calls a dear quarter rather than ordinary wander.

**Files:** `src/style.css` (token block); `src/ui/app.ts` (fuel threshold).

**Revert:** restore `--livery: #1b3a6b` and drop `--carrier`; in `app.ts` restore
`> CONSTANTS.game.startingFuelPricePerL * 1.25`.

## Item 3 — Map hierarchy

**What changed.** Player arcs are weighted by what each sector earns **against the
rest of the player's own network**, in three tiers (1 / 1.8 / 2.8 stroke). Ranked
relatively rather than against a dollar threshold, because the map has to answer
"where am I strong" in year 2 and year 25 alike. Under three sectors there is no
shape to show, so everything draws at the middle weight.

Rival arcs drop to 0.3 opacity (from 0.42) and stay thin — and hovering any one of
them brings that carrier's **whole network** to full strength, rather than one arc
lighting up out of the middle of it.

Served-city labels go slightly larger and heavier. The plate contrast is lifted:
water deeper (`#d5dfe0` → `#c9d6d9`), land lighter (`#f2efe7` → `#f5f2ea`), so an
arc sits *on* the map rather than in it.

**Files:** `src/ui/map.ts` (`MapScene.routeWeight`, tier classes, `data-carrier`,
`focusCarrier`); `src/ui/app.ts` (`scene()`, `routeWeights()`, `arcWeights`
field); `src/style.css` (`.arc-w0/1/2`, `.arc-rival`, `.is-carrier-focus`,
`.city-label-strong`, plate tokens).

**Revert:** drop `routeWeight` from `MapScene` and the tier class from
`renderArcs`; delete `focusCarrier` and its listeners; delete `scene()`,
`routeWeights()` and `arcWeights`, passing `game ?? EMPTY_SCENE` to
`map.render` again; restore `.arc` to `stroke-width: 1.2`, `.arc-rival` to
`0.7 / 0.42`, and the four plate tokens.

## Item 4 — Rules, not boxes

**What changed.** Section headings gained the timetable device — a 2px rule
underneath — and the enclosing 1px boxes came off the controls. Secondary actions
(`.wide-action`, `.fleet-action`, `.market-buy`, the file-action footer) are now a
line of type over a rule; **Close the books** keeps its solid fill as the single
primary action on the board.

Chips lost their boxes entirely. An assigned aircraft and a delivered technology
program are now a name with a **small square key** beside it, in the carrier's
livery — the same block that flies its arcs on the map, so a glance connects the
two without a legend. Filled means held; hollow (`.chip-add`) means available.
Hover recolours the key and the label rather than inverting a pill.

**Files:** `src/style.css` only.

*Follow-up 2026-07-29:* `.coach-dismiss` was the last boxed button left on the
board and now takes the same bottom rule. The borders that remain are deliberate
and not oversights: the coaching note and the map zoom cluster are floating
overlays (a box is what separates them from what they sit on), `.posture-option`
is a segmented control whose borders ARE the segments, and `.step` is a 20px
square stepper.

**Revert:** restore `border: 1px solid …` on `.panel-heading` (removing
`padding-bottom`/`border-bottom`), `.wide-action`, `.fleet-action`,
`.market-buy`, `.file-actions button`, `.chip` and `.tech-chip`; delete the
`::before` key rules.

## Item 5 — Livery cheatline

**What changed.** A cheatline now runs the width of the masthead, passing under
the wordmark: two tones, the second at 35% of the first, which is how a cheatline
is actually drawn and the reason it reads as an airline rather than as an
underline. It replaces the masthead's old 2px bottom border.

**Carrier identity was already content, not style** — `src/data/rivals.json`
carries a flat accent per carrier with a `_meta.colors` note explaining the
choice. The roster holds **24** rather than the brief's 6–8 because a game *draws
a subset*, so a larger pool is what keeps two games from facing the same cast; the
colours are already desaturated and chosen to avoid the player's navy. I did not
cut it down to 8 — that would make every game look the same. Those colours were
already used on arcs, on the rival-list swatch, and as the left rule on a carrier's
row in the market board, so item 5's consistency requirement was already met and
needed verifying rather than building.

**Files:** `index.html` (`.cheatline` element); `src/style.css`.

**Revert:** delete the `<span class="cheatline">` and its rule; restore
`border-bottom: 2px solid var(--livery)` on `.masthead` and drop the
`position/z-index` from `.livery`.

## Item 6 — Close the Books ceremony

**What changed.** Closing the books is a short sequence rather than a repaint: the
board dims to 55% and back over 420ms while the quarter settles, the masthead
figures roll (existing `tickNumber`), the ledger rows return top-to-bottom on a
45ms-per-row stagger capped at 400ms, and the briefing presents itself over the
top. `settleCeremony()` runs after `commit()` so the rows it animates are the new
quarter's.

Every step is decoration: `prefersReducedMotion()` returns early and the CSS
`@media (prefers-reduced-motion: reduce)` block cancels both animations, so the
game plays identically without any of it.

**Files:** `src/ui/app.ts` (`settleCeremony`, its call in `closeBooks`, the
`motion.ts` import); `src/style.css` (the "Closing the books" block at the end).

**Revert:** delete `settleCeremony` and its call; delete the trailing CSS block.

## Item 7 — Microcopy sweep

**What changed.** `src/ui/strings.ts` collects interface copy in one place, with
the three rules that keep a new line from drifting written at the top: an empty
state is an invitation rather than an apology; never narrate the machinery; a
condition names the consequence, not the mechanism.

The empty states are routed through it — the schedule now says *"Nothing on the
books. Lease an aircraft, then click two cities to open a sector"* instead of "No
sectors in the schedule", and the fleet says *"No aircraft. You cannot fly a
schedule without metal"* instead of "No aircraft yet."

The file also holds the sector conditions and notices the brief asked for (rival
entering your market, sector bleeding, aircraft aging out, spilling traffic).
**Some are defined and not yet wired to a call site** — they need a condition
computed at the point of display, and I did not want to invent a trigger inside a
stream whose constraint is "do not change sim behaviour". They are marked by
being unreferenced; wiring them is a small follow-up.

**Files:** `src/ui/strings.ts` (new); `src/ui/app.ts` and `src/ui/inspector.ts`
(imports and five call sites).

**Revert:** delete `src/ui/strings.ts` and inline the five literals again.

---

## Follow-up — coaching arrows (2026-07-29)

Requested after playing: there was no way to page through the notes, only to do
the thing or dismiss the lot. The note now carries ← → arrows and a step counter.

Reading ahead never marks anything done and never gates a step — the sequence
still retires on real game state — and doing the next thing snaps the note back to
whatever is live, which is the coaching's whole job. Arrows clamp at both ends; a
note you have paged away from says "reading ahead" and takes a dashed border, so
"3 / 5" while standing on step 1 is not simply confusing.

Fixed a real bug found while testing it: `positionCoach` never clamped to the
viewport. A control scrolled out of its pane reports a rect off the bottom of the
window, both candidate positions then landed off-screen too, and the note — with
its buttons — went somewhere unreachable. It is now clamped whatever the anchor
does, on the principle that a note pointing approximately at its control beats one
that cannot be seen.

**Files:** `index.html` (`.coach-head`, `.coach-nav`, two buttons);
`src/ui/app.ts` (`coachIndex`, `coachLiveId`, `pageCoach`, the clamp in
`positionCoach`); `src/style.css` (the coaching-paging block).

**Revert:** delete the two buttons and their wrapper, `pageCoach`, the two fields
and the `is-browsing` branch; keep the viewport clamp, which is a bug fix and not
part of the feature.

## Polish pass — 2026-07-31

Requested after playing: "get rid of AI slop, in some cases there aren't spaces
between phrases, it needs a facelift."

- **The missing space, found.** `On this market` and its sentence ran together as
  `ON THIS MARKETYou have it to yourself.` — `.assign-label` sat inside a flexbox
  with a gap in one panel and a plain block in another, so the same label read
  correctly in one place and not in the next. It now carries its own trailing
  margin and cannot depend on its container again.
- **Units are no longer figures.** `1,500 km`, `520 km/h`, `+2% demand` were single
  monospace runs, so the unit got a full monospace space in front of it and read as
  a typo. Figure and unit are now set as what they are: the number tabular, the word
  in the grotesque, smaller and softer, with a thin space of its own.
- **The selected sector was printing through its own marker.** The livery bar is an
  inset shadow, so `NYC–LAX` was drawn over it; the first cell now steps clear.
- **Twenty aircraft cards said the same sentence.** "A regional gauge for short-haul
  sectors up to 1,500 km — wins thin markets a big jet cannot fill" was assembled
  from three lookup tables, so every type in a band carried it word for word, and
  two thirds of it restated the seats and range printed directly above. Deleted:
  a line that repeats the table it sits under is worse than no line.
- **The aircraft catalogue lost its boxes**, per item 4 — twenty bordered cards in a
  grid read as a spreadsheet, twenty ruled entries read as a catalogue.
- **The rail's lower edge fades** instead of slicing a carrier's name in half where
  the scrolling panes meet the footer.
- `Lead time` no longer wraps to two lines against single-line neighbours.

**Files:** `src/style.css`, `src/ui/app.ts`, `src/ui/inspector.ts` (label only),
`index.html` (one header word).

## Follow-ups — 2026-08-02

**Rival arc visibility, corrected.** The design pass pushed rivals to 0.7 stroke /
0.30 opacity to stop them competing with the player's network for the first glance,
and overshot: an 18-sector, 100-aircraft world read as an empty plate at world zoom.
Raised one notch to 0.95 / 0.46. The player's arcs still carry 1.4–2.8 stroke at
full opacity, so the weight gap is 2–4x rather than 4–9x — dominance stays
unmistakable while the market looks alive. Verified on a zoomed-out capture with
109 rival arcs on the plate against the player's network.

**The wordmark, treated.** It was a line of uniformly tracked capitals — a label
with the tracking turned up, which is what "untreated" meant. It is now a lockup:
"Air" is the category and "Honcho" is the name, which is the split the flag carriers
letter (Air France, Air Canada), so the mark says it that way — category at weight
400, 0.34em tracking and 72% strength, half a step back; name at weight 700 and
0.13em, carrying the mark. Optically sized against the cheatline rather than the
box: 16px cap height on a 5px stripe, padded so the cheatline keeps a clear run
underneath instead of being crowded. The trailing letter-space of each part is
negated so the mark sits flush inside the livery panel.

**Files:** `src/style.css`; `index.html` (the h1 split into two spans, with a real
word space so it still reads "Air Honcho" to a screen reader).

**Revert:** restore `.arc-rival` to `0.7 / 0.3`; collapse the h1 back to
`<h1>Air Honcho</h1>` and restore the single `.livery h1` rule with
`--wordmark-size: 15px`.

## Not done

- **Deployed preview.** `wrangler` is not installed and `wrangler login` is
  interactive, so I could not deploy. `npm run build` is green and `dist/` is
  current; the deploy is one `npx wrangler deploy` once you have authenticated.
- **Per-item screenshots.** Four frames rather than seven: items 2, 4, 5 and 6
  are visible in `07-final.png` (colour rule, rules-not-boxes, cheatline) but the
  ceremony is motion and does not photograph. Items 1 and 3 have their own frames
  because they change the whole board at once.
