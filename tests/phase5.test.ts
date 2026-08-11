/**
 * Phase 5 (feel & polish): the parts with logic worth pinning — save slots,
 * first-turn coaching, and the sound switch. The animations themselves are
 * eyeballed on the build; these are the contracts underneath them.
 */
import { describe, expect, it, beforeEach } from 'vitest';
import { newGame, endTurn, applyAction, getCarrier } from '../src/sim/engine.ts';
import type { GameState } from '../src/sim/types.ts';
import {
  deleteSlot, listSlots, loadSlot, MAX_SLOTS, saveSlot,
} from '../src/sim/save.ts';
import { NEUTRAL_WEIGHT, routeWeights } from '../src/ui/arcweight.ts';
import { buildMarketIndex } from '../src/sim/economics.ts';
import { STRINGS } from '../src/ui/strings.ts';
import { nextStep, STEPS } from '../src/ui/onboarding.ts';
import {
  playBadQuarter, playFlap, playGoodQuarter, setSoundEnabled, soundEnabled,
} from '../src/ui/sound.ts';

/** A minimal localStorage so the browser-facing helpers can run headless. */
function stubStorage(): void {
  const map = new Map<string, string>();
  (globalThis as unknown as { localStorage: unknown }).localStorage = {
    get length() { return map.size; },
    key: (i: number) => [...map.keys()][i] ?? null,
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => { map.set(k, v); },
    removeItem: (k: string) => { map.delete(k); },
    clear: () => { map.clear(); },
  };
}

describe('save slots', () => {
  beforeEach(stubStorage);

  it('round-trips a game through a named slot', () => {
    const game = endTurn(newGame(11, 'LON'));
    expect(saveSlot('Before the widebody', game)).toBe(true);
    const back = loadSlot('Before the widebody');
    expect(back).not.toBeNull();
    expect(back!.seed).toBe(game.seed);
    expect(back!.turn).toBe(game.turn);
  });

  it('lists slots with enough detail to label them, and deletes cleanly', () => {
    saveSlot('A', newGame(4, 'LON', undefined, { difficulty: 'hard', scenario: 'history' }));
    saveSlot('B', newGame(5, 'NYC'));
    const slots = listSlots();
    expect(slots.map((s) => s.name)).toEqual(['A', 'B']);
    const a = slots.find((s) => s.name === 'A')!;
    // The seed is deliberately not carried here: it is not shown anywhere in the
    // interface, so the header does not read it.
    expect(a.difficulty).toBe('hard');
    expect(a.scenario).toBe('history');

    deleteSlot('A');
    expect(listSlots().map((s) => s.name)).toEqual(['B']);
  });

  it('keeps slots independent of the autosave', async () => {
    const { autosave, loadAutosave } = await import('../src/sim/save.ts');
    autosave(newGame(1, 'LON'));
    saveSlot('kept', newGame(2, 'NYC'));
    expect(loadAutosave()!.seed).toBe(1);
    expect(loadSlot('kept')!.seed).toBe(2);
  });

  it('offers a sensible number of slots', () => {
    expect(MAX_SLOTS).toBeGreaterThan(1);
  });
});

describe('first-turn coaching', () => {
  it('walks four steps and retires each as the player does it', () => {
    expect(STEPS).toHaveLength(4);
    /*
     * Nothing started means the start dialog is up, and it is coached by NOT being
     * coached. That dialog is opened with showModal(), so the browser renders it in
     * the top layer and a note anchored to the map sits behind it whatever its
     * z-index — which is precisely what the player reported. Home base is chosen
     * inside that dialog now, so there is nothing left to say here anyway.
     */
    expect(nextStep(null)).toBeNull();
    // A game exists but there is no aircraft yet.
    const fresh = newGame(3, 'LON');
    expect(nextStep(fresh)?.id).toBe('fleet');
  });

  it('can actually reach every step it counts', () => {
    // The note is labelled "n/4", so all four have to be showable. Two steps that
    // retire on the SAME condition collapse into one: the earlier is displayed, the
    // later never is. That is what `posture` and `books` both keying on `turn > 0`
    // did — the note explaining how to close the books was unreachable.
    const conditions = STEPS.map((s) => s.done.toString());
    expect(new Set(conditions).size).toBe(STEPS.length);

    // And walk it: every step must be the answer for some reachable state.
    const seen = new Set<string>();
    let game: GameState | null = newGame(3, 'LON');
    seen.add(nextStep(game)!.id);                                   // fleet

    game = applyAction(game, {
      type: 'ACQUIRE_AIRCRAFT', carrierId: 'player', typeId: 'VANTA5', ownership: 'leased',
    }).state;
    seen.add(nextStep(game)!.id);                                   // route

    game = applyAction(game, {
      type: 'OPEN_ROUTE', carrierId: 'player', from: 'LON', to: 'PAR',
    }).state;
    seen.add(nextStep(game)!.id);                                   // posture

    const tailId = game.carriers.find((c) => c.isPlayer)!.fleet[0]!.id;
    game = applyAction(game, {
      type: 'ASSIGN_AIRCRAFT', carrierId: 'player', tailId, routeId: game.routes[0]!.id,
    }).state;
    seen.add(nextStep(game)!.id);                                   // books

    expect([...seen]).toEqual(STEPS.map((s) => s.id));
  });

  it('stops coaching once the player has found their feet, read or not', () => {
    // A player who has closed the books a couple of times does not need the intro
    // any more — even one deliberately flying no aircraft, who would otherwise be
    // nagged about it for the rest of a 25-year game.
    let game = newGame(3, 'LON');
    expect(nextStep(game)).not.toBeNull();
    for (let i = 0; i < 3; i++) game = endTurn(game);
    expect(nextStep(game)).toBeNull();
  });
});

describe('sound', () => {
  beforeEach(stubStorage);

  it('is off until asked for, and remembers being asked', () => {
    // Read at module load, with no storage available, so it starts off.
    expect(soundEnabled()).toBe(false);
    setSoundEnabled(true);
    expect(soundEnabled()).toBe(true);
    expect(localStorage.getItem('air-honcho:sound')).toBe('on');
    setSoundEnabled(false);
    expect(localStorage.getItem('air-honcho:sound')).toBe('off');
  });

  it('makes no noise, and does not throw, with no audio available', () => {
    // No window/AudioContext in Node: every cue must be a safe no-op, whether the
    // switch is on or off.
    setSoundEnabled(true);
    expect(() => { playFlap(); playGoodQuarter(); playBadQuarter(); }).not.toThrow();
    setSoundEnabled(false);
    expect(() => { playFlap(); playGoodQuarter(); playBadQuarter(); }).not.toThrow();
  });
});

describe('map arc weights', () => {
  /** A player network of `n` sectors, the first `dormant` of them with no metal. */
  function network(n: number, dormant: number): GameState {
    let game = newGame(9, 'LON');
    const cities = ['NYC', 'PAR', 'MAD', 'ROM', 'DUB', 'LIS'];
    for (let i = 0; i < n; i++) {
      game = applyAction(game, {
        type: 'OPEN_ROUTE', carrierId: 'player', from: 'LON', to: cities[i]!,
      }).state;
    }
    for (let i = dormant; i < n; i++) {
      game = applyAction(game, {
        type: 'ACQUIRE_AIRCRAFT', carrierId: 'player', typeId: 'AROSN3', ownership: 'leased',
      }).state;
      const idle = getCarrier(game, 'player').fleet.find((t) => t.routeId === null)!;
      game = applyAction(game, {
        type: 'ASSIGN_AIRCRAFT', carrierId: 'player', tailId: idle.id, routeId: game.routes[i]!.id,
      }).state;
    }
    return game;
  }

  it('gives a sector with nothing on it the middle weight, not the thinnest', () => {
    // A dormant sector earns nothing, so scoring it as revenue sorted it below
    // every flying route and handed it the thinnest tier. Dashed and faded on top
    // of that, a route the player had just opened came out nearly invisible — it
    // read as the click not having worked, which is how it was reported.
    const game = network(6, 2);
    const weights = routeWeights(game, buildMarketIndex(game));
    for (let i = 0; i < 2; i++) {
      expect(weights.get(game.routes[i]!.id), 'a dormant sector must not be ranked last')
        .toBe(NEUTRAL_WEIGHT);
    }
  });

  it('still ranks the flying sectors against each other', () => {
    // The tier has to keep doing its job: three or more flying sectors get spread
    // across the range so the map answers "where am I strong".
    const game = network(6, 0);
    const tiers = [...routeWeights(game, buildMarketIndex(game)).values()];
    expect(tiers).toHaveLength(6);
    expect(new Set(tiers).size, 'every sector came out at the same weight').toBeGreaterThan(1);
  });

  it('leaves a young network unranked — there is no shape to show yet', () => {
    const game = network(2, 0);
    for (const tier of routeWeights(game, buildMarketIndex(game)).values()) {
      expect(tier).toBe(NEUTRAL_WEIGHT);
    }
  });
});

describe('naming carriers on their way into a market', () => {
  it('reads as a sentence for one and for several', () => {
    expect(STRINGS.sector.incoming(['Meridian Airways']))
      .toBe('Meridian Airways has opened this market and is not flying it yet.');
    expect(STRINGS.sector.incoming(['Meridian Airways', 'Cordillera']))
      .toBe('Meridian Airways and Cordillera have opened this market and are not flying it yet.');
    expect(STRINGS.sector.incoming(['A', 'B', 'C']))
      .toBe('A, B and C have opened this market and are not flying it yet.');
  });
});
