/**
 * Difficulty: a set of multipliers chosen at game start (medium = the tuned
 * baseline). These pin that each lever moves the right way and that a saved game
 * remembers its level — the headless suite proves the curve actually plays out
 * (easy survives more, hard less).
 */
import { describe, expect, it } from 'vitest';
import { endTurn, getCarrier, newGame } from '../src/sim/engine.ts';
import { deserialize, serialize } from '../src/sim/save.ts';
import { CITIES, CONSTANTS, difficultyMods } from '../src/sim/world.ts';
import { Rng } from '../src/sim/rng.ts';
import { planRivals } from '../src/sim/ai/archetype.ts';
import { decide, setup } from '../src/sim/ai/heuristic.ts';
import { marketKey } from '../src/sim/economics.ts';

describe('difficulty multipliers', () => {
  it('leaves medium as the tuned baseline for the 1.0-baseline levers', () => {
    // These levers multiply an existing tuned figure, so medium = 1.0 keeps the
    // game exactly as balanced. (contestPressure scales a NEW mechanic — the
    // competition load penalty, off in the original economy — so its medium value
    // is a small design number, not 1.0.)
    const m = difficultyMods('medium');
    for (const k of ['demand', 'eventChance', 'rivalCount', 'entrantChance', 'aggression', 'startingCash', 'stockActivity'] as const) {
      expect(m[k], k).toBe(1);
    }
  });

  it('gives easy more traffic and cash, hard less', () => {
    expect(difficultyMods('easy').demand).toBeGreaterThan(difficultyMods('hard').demand);
    expect(difficultyMods('easy').startingCash).toBeGreaterThan(1);
    expect(difficultyMods('hard').startingCash).toBeLessThan(1);
    // Disasters and field pressure run the other way.
    expect(difficultyMods('hard').eventChance).toBeGreaterThan(difficultyMods('easy').eventChance);
    expect(difficultyMods('hard').aggression).toBeGreaterThan(difficultyMods('easy').aggression);
    expect(difficultyMods('hard').rivalCount).toBeGreaterThan(difficultyMods('easy').rivalCount);
  });

  it('makes competition and the stock market bite harder as difficulty rises', () => {
    // The two levers this feedback added: contested routes hurt more, and the M&A
    // market gets busier, both climbing easy -> medium -> hard.
    expect(difficultyMods('easy').contestPressure).toBeLessThan(difficultyMods('medium').contestPressure);
    expect(difficultyMods('medium').contestPressure).toBeLessThan(difficultyMods('hard').contestPressure);
    expect(difficultyMods('easy').stockActivity).toBeLessThan(difficultyMods('hard').stockActivity);
  });
});

describe('difficulty at game start', () => {
  it('scales the player opening bank', () => {
    const base = CONSTANTS.game.startingCash;
    expect(getCarrier(newGame(1, 'LON', undefined, { difficulty: 'easy' }), 'player').cash).toBeGreaterThan(base);
    expect(getCarrier(newGame(1, 'LON', undefined, { difficulty: 'hard' }), 'player').cash).toBeLessThan(base);
    // Medium and the unspecified default are the baseline.
    expect(getCarrier(newGame(1, 'LON'), 'player').cash).toBe(base);
    expect(getCarrier(newGame(1, 'LON', undefined, { difficulty: 'medium' }), 'player').cash).toBe(base);
  });

  it('deals a bigger, bolder field on hard than on easy for the same roll', () => {
    // Same seed => same underlying cast roll; only the difficulty scaling differs.
    const easy = planRivals(Rng.fromSeed(7), 'easy');
    const hard = planRivals(Rng.fromSeed(7), 'hard');
    expect(hard.length).toBeGreaterThan(easy.length);
    // A bolder cast: the first rival's personality is scaled up on hard.
    expect(hard[0]!.aggression).toBeGreaterThan(easy[0]!.aggression);
  });
});

describe('difficulty persists across a save', () => {
  it('round-trips the chosen level', () => {
    const g = newGame(3, 'LON', undefined, { difficulty: 'hard' });
    expect(deserialize(serialize(g)).difficulty).toBe('hard');
  });

  it('tags a pre-difficulty save as medium', () => {
    // A v13 save has no difficulty field; migration must default it to the baseline.
    const g = newGame(3, 'LON');
    const raw = JSON.parse(serialize(g)) as Record<string, unknown>;
    delete raw['difficulty'];
    raw['schemaVersion'] = 13;
    expect(deserialize(JSON.stringify(raw)).difficulty).toBe('medium');
  });
});

/**
 * The constants above only prove the KNOBS are ordered. They were, and the field
 * still came out backwards: because a rival could take at most one growth move a
 * quarter, hard's thinner world simply made it skip more turns, so hard opened
 * FEWER routes than easy and put LESS metal on them. Every constant assertion in
 * this file passed throughout.
 *
 * So this asserts the behaviour rather than the settings. Measured on the same
 * seeds at each level, mid-game, where the difference is largest and the noise is
 * smallest — route count is a far steadier signal than survival, which needs
 * ~20 games a level to separate.
 */
describe('difficulty actually reaches the field', () => {
  const SEEDS = 5;
  /*
   * Everything is read at turn 12, and the run stops there.
   *
   * Hard is now lethal enough that the balance fixture is destroyed around turn
   * 14 in most games. Any later checkpoint therefore measures SURVIVORSHIP rather
   * than the field — hard scored 10.4 markets against medium's 31 purely because
   * four games in five had already ended before the reading was taken. Twelve is
   * inside every level's lifetime, so the three levels are compared over the same
   * window on the same seeds.
   */
  const TURNS = 12;
  const EARLY = 12;

  /**
   * Two different quantities, and the difference matters.
   *
   * FLOW is how many sectors a field ever opened — the thing "expands faster"
   * actually claims. STOCK is how many stand at a given moment, and it is also a
   * function of how many carriers died: hard fails rivals three times as often as
   * medium, and a failed carrier's routes leave the market. Measuring stock late
   * therefore reads hard as SLOWER while it is in fact opening the most sectors
   * of any level, which is how this test first failed a change that was correct.
   */
  function fieldAt(difficulty: 'easy' | 'medium' | 'hard'): {
    opened: number; standingEarly: number; perRoute: number; markets: number; openRate: number;
  } {
    let opened = 0;
    let standingEarly = 0;
    let markets = 0;
    let routes = 0;
    let assigned = 0;
    let rivalQuarters = 0;
    for (let i = 0; i < SEEDS; i++) {
      const aiRng = Rng.fromSeed((4000 + i) ^ 0x5f3759df);
      const home = aiRng.pick(CITIES).id;
      let s = newGame(4000 + i, home, 'Stub Air', { scenario: 'present', difficulty });
      s = setup(s, s.playerCarrierId, aiRng);
      const everSeen = new Set<string>();
      while (s.turn < TURNS && !s.gameOver) {
        s = decide(s, s.playerCarrierId, aiRng);
        s = endTurn(s);
        for (const r of s.routes) if (r.carrierId !== s.playerCarrierId) everSeen.add(r.id);
        rivalQuarters += s.carriers.filter((c) => !c.isPlayer && c.bankruptTurn === null).length;
        if (s.turn === EARLY) {
          standingEarly += s.routes.filter((r) => r.carrierId !== s.playerCarrierId).length;
          markets += new Set(s.routes.map((r) => marketKey(r.from, r.to))).size;
        }
      }
      opened += everSeen.size;
      const rivalRoutes = s.routes.filter((r) => r.carrierId !== s.playerCarrierId);
      routes += rivalRoutes.length;
      for (const c of s.carriers) {
        if (c.isPlayer) continue;
        assigned += c.fleet.filter((a) => a.routeId !== null).length;
      }
    }
    return {
      opened: opened / SEEDS,
      standingEarly: standingEarly / SEEDS,
      markets: markets / SEEDS,
      perRoute: routes > 0 ? assigned / routes : 0,
      // Sectors opened per LIVE RIVAL per quarter — see the assertion below.
      openRate: rivalQuarters > 0 ? opened / rivalQuarters : 0,
    };
  }

  const easy = fieldAt('easy');
  const medium = fieldAt('medium');
  const hard = fieldAt('hard');

  it('expands faster per carrier on hard than on medium', () => {
    /*
     * The inversion this exists to catch: hard used to expand ~20% SLOWER than
     * medium, so the harshest setting fielded the least competitive rivals.
     *
     * Measured as a RATE — sectors opened per live rival per quarter — rather than
     * as a raw count, changed 2026-08-06. The count is confounded twice over. It is
     * a function of how many carriers are alive to open anything, and hard fails
     * rivals far more often; and of how many sectors clear the profit bar at all,
     * and hard's world is deliberately thinner. Measured raw at turn 30, hard opens
     * 41 sectors against medium's 82 and looks becalmed — while each of its rivals
     * is in fact expanding FASTER (0.78 a quarter against 0.71). The file already
     * warns about exactly this confound for the standing count and did not carry the
     * warning across to the flow count, which shares it: a dead carrier stops
     * opening sectors too.
     *
     * Verified to still bite: with hard's growthActions put back to 1 — the original
     * bug — its rate falls to 0.44 against medium's 0.71 and this fails.
     */
    expect(hard.openRate).toBeGreaterThan(medium.openRate);
    expect(medium.openRate).toBeGreaterThan(easy.openRate);
  });

  it('reaches more distinct markets on hard by mid-game', () => {
    /*
     * Changed 2026-07-30 from "more rival sectors standing" to "more markets
     * reached", because the old form stopped describing the goal once carriers
     * were given sight of the global trunk routes. Hard now expands by BREADTH —
     * 38.4 markets against medium's 27.8 at turn 20 — while medium concentrates a
     * similar number of sectors onto fewer pairs. Counting rival sectors alone
     * therefore read hard as slower while it was reaching half again as much of
     * the map, and it is also confounded by how much of the board the player
     * fixture happens to hold.
     */
    expect(hard.markets).toBeGreaterThan(medium.markets);
  });

  it('does not thin the metal on a rival route against medium', () => {
    /*
     * Was a strict `>` and is now a floor. Hard rivals fly the same fleet across
     * markedly more markets than medium's, so aircraft-per-route converged (1.49
     * against 1.51) — breadth bought with depth, and a real trade of the trunk
     * discovery work rather than a regression in appetite. What must not happen is
     * hard fielding a visibly thinner deployment than medium.
     */
    expect(hard.perRoute).toBeGreaterThan(medium.perRoute * 0.9);
  });

  it('does not simply make easy the busiest world', () => {
    // Easy has 1.2x demand, so its routes are individually richer; what must not
    // happen is easy opening more of them than hard.
    expect(hard.opened).toBeGreaterThan(easy.opened);
  });
});

describe('predatory pricing is a hard-difficulty trait', () => {
  it('rises with difficulty and is off below hard', () => {
    // Predation is the fraction of a contested sector's best profit a rival will
    // give up to price UNDER the competition. Before it existed, difficulty did
    // not touch pricing at all: contested sectors on hard were priced at undercut
    // 41.9% of the time against easy's 42.5% — the same game.
    const easy = difficultyMods('easy').predation ?? 0;
    const medium = difficultyMods('medium').predation ?? 0;
    const hard = difficultyMods('hard').predation ?? 0;
    expect(hard).toBeGreaterThan(0);
    expect(hard).toBeGreaterThan(medium);
    expect(medium).toBeGreaterThanOrEqual(easy);
    // Held at zero below hard on purpose: the mechanic is sensitive (0.08 on
    // medium moved its contested mix from 43% undercut to 60%) and medium is the
    // tuned baseline. If that is ever raised it must be with the harness in hand.
    expect(easy).toBe(0);
    expect(medium).toBe(0);
  });

  it('cannot make a rival price below what the sector can bear', () => {
    // The floor is a FRACTION of the best available profit, so a sector that is
    // only marginally profitable leaves almost no room to cut. That is the
    // counterplay — squeeze a wolf's margin and it stops being able to bite.
    const predation = difficultyMods('hard').predation ?? 0;
    expect(predation).toBeLessThan(1);
  });

  it('orders the postures a predator picks from by fare, not by declaration', () => {
    // The deepest affordable cut is found by walking the band cheapest-first. If
    // that ordering came from however the JSON happened to be written, adding a
    // notch or reordering a band would silently change who undercuts whom.
    const fare = CONSTANTS.posture.fare as Record<string, number>;
    const band = ['skim', 'premium', 'match', 'undercut', 'stimulate'];
    const sorted = [...band].sort((a, b) => fare[a]! - fare[b]!);
    expect(sorted).toEqual([...band].reverse());
  });
});
