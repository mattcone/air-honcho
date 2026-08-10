import { describe, expect, it } from 'vitest';
import { applyAction, endTurn, newGame, SCHEMA_VERSION } from '../src/sim/engine.ts';
import { deserialize, SaveError, serialize } from '../src/sim/save.ts';

function playedGame() {
  let state = newGame(555, 'FRA');
  state = applyAction(state, { type: 'OPEN_ROUTE', carrierId: 'player', from: 'FRA', to: 'NYC' }).state;
  state = applyAction(state, { type: 'OPEN_ROUTE', carrierId: 'player', from: 'FRA', to: 'SIN' }).state;
  for (let i = 0; i < 6; i++) state = endTurn(state);
  return state;
}

describe('save round-trip', () => {
  it('restores an identical state', () => {
    const original = playedGame();
    expect(deserialize(serialize(original))).toEqual(original);
  });

  it('resumes the RNG stream exactly where it left off', () => {
    const original = playedGame();
    const restored = deserialize(serialize(original));
    // If rngState were dropped or rounded, these would diverge immediately.
    expect(JSON.stringify(endTurn(restored))).toBe(JSON.stringify(endTurn(original)));
  });

  it('stamps the current schema version', () => {
    expect(JSON.parse(serialize(newGame(1, 'LON'))).schemaVersion).toBe(SCHEMA_VERSION);
  });
});

describe('deserialize rejections', () => {
  it('rejects non-JSON', () => {
    expect(() => deserialize('not json {')).toThrow(SaveError);
  });

  it('rejects JSON that is not a save', () => {
    expect(() => deserialize('{"hello":"world"}')).toThrow(/schemaVersion/);
    expect(() => deserialize('[1,2,3]')).toThrow(SaveError);
    expect(() => deserialize('null')).toThrow(SaveError);
  });

  it('rejects a save from a future build with an actionable message', () => {
    const future = JSON.stringify({ ...newGame(1, 'LON'), schemaVersion: SCHEMA_VERSION + 5 });
    expect(() => deserialize(future)).toThrow(/newer version/);
  });

  it('rejects a save missing required fields', () => {
    const partial = JSON.parse(serialize(newGame(1, 'LON')));
    delete partial.carriers;
    expect(() => deserialize(JSON.stringify(partial))).toThrow(/carriers/);
  });

  it('reports a missing migration rather than loading a broken state', () => {
    // Phase 0 saves (v1) have no fleet and deliberately have no migration path.
    const old = JSON.stringify({ ...newGame(1, 'LON'), schemaVersion: 1 });
    expect(() => deserialize(old)).toThrow(/No migration path from save version 1/);
  });

  it('rejects a carrier with no fleet', () => {
    const partial = JSON.parse(serialize(newGame(1, 'LON')));
    delete partial.carriers[0].fleet;
    expect(() => deserialize(JSON.stringify(partial))).toThrow(/fleet/);
  });

  // A file can be structurally perfect and still carry a string where the sim
  // does arithmetic. Nothing downstream notices: `cash` of "plenty" becomes
  // "plenty0" on the first settlement rather than throwing, and one NaN spreads
  // through every figure on the board. Caught at the door, while it can still be
  // reported as a bad file.
  it('rejects a world number that is not a number', () => {
    const bad = JSON.parse(serialize(newGame(1, 'LON')));
    bad.rngState = 'wobbly';
    expect(() => deserialize(JSON.stringify(bad))).toThrow(/rngState/);
  });

  it('rejects a carrier balance that is not a number', () => {
    const bad = JSON.parse(serialize(newGame(1, 'LON')));
    bad.carriers[0].cash = 'plenty';
    expect(() => deserialize(JSON.stringify(bad))).toThrow(/cash/);
  });

  it('rejects a number that is not finite', () => {
    // JSON cannot spell Infinity, but a migration or a hand edit can leave one.
    const bad = JSON.parse(serialize(newGame(1, 'LON')));
    bad.fuelPrice = null;
    expect(() => deserialize(JSON.stringify(bad))).toThrow(/fuelPrice/);
  });
});

describe('saves carry the rival cast', () => {
  function withRivals() {
    let state = newGame(31, 'FRA');
    for (let i = 0; i < 30; i++) state = endTurn(state);
    return state;
  }

  it('round-trips a game that has rivals in it', () => {
    const original = withRivals();
    expect(original.carriers.length).toBeGreaterThan(1);
    expect(deserialize(serialize(original))).toEqual(original);
  });

  it('resumes rival behavior identically after a reload', () => {
    // The cast, their personalities and the RNG stream all have to survive, or
    // a reloaded game diverges from the one the seed promised.
    const original = withRivals();
    const restored = deserialize(serialize(original));
    expect(JSON.stringify(endTurn(restored))).toBe(JSON.stringify(endTurn(original)));
  });

  it('rejects a save with no rival plan', () => {
    const partial = JSON.parse(serialize(newGame(1, 'LON')));
    delete partial.rivalPlan;
    expect(() => deserialize(JSON.stringify(partial))).toThrow(/rivalPlan/);
  });
});

describe('migration v5 -> v6: colour became color', () => {
  /** A v6 game rewound to look like the v5 file it would have been. */
  const asV5 = (state: ReturnType<typeof newGame>): string => {
    const raw = JSON.parse(serialize(state));
    raw.schemaVersion = 5;
    // Renamed in place: in a real v5 file `colour` sat exactly where `color`
    // sits now. Appending it instead would make this fixture, not the
    // migration, the thing that reorders the keys.
    const rename = (row: Record<string, unknown>): Record<string, unknown> => {
      const out: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(row)) {
        out[key === 'color' ? 'colour' : key] = value;
      }
      return out;
    };
    raw.carriers = raw.carriers.map(rename);
    raw.rivalPlan = raw.rivalPlan.map(rename);
    return JSON.stringify(raw);
  };

  it('renames the field on carriers and on the rival cast', () => {
    const original = newGame(7, 'LON');
    const migrated = deserialize(asV5(original));

    expect(migrated.schemaVersion).toBe(SCHEMA_VERSION);
    for (const carrier of migrated.carriers) {
      expect(typeof carrier.color).toBe('string');
      expect('colour' in carrier).toBe(false);
    }
    for (const planned of migrated.rivalPlan) {
      expect(typeof planned.color).toBe('string');
      expect('colour' in planned).toBe(false);
    }
  });

  it('changes nothing else, so a v5 game continues as it was', () => {
    // A rename must not perturb the seed's promise: same state, same future.
    const original = newGame(7, 'LON');
    const migrated = deserialize(asV5(original));
    expect(migrated).toEqual(original);
    expect(JSON.stringify(endTurn(migrated))).toBe(JSON.stringify(endTurn(original)));
  });

  it('leaves an already-migrated save alone', () => {
    const original = newGame(7, 'LON');
    expect(deserialize(serialize(original))).toEqual(original);
  });
});

describe('migration v10 -> v11: scenarios arrived', () => {
  /** A present-day game rewound to the v10 file it would have been: no scenario
   * fields, and no bailout counter on any carrier. */
  const asV10 = (state: ReturnType<typeof newGame>): string => {
    const raw = JSON.parse(serialize(state));
    raw.schemaVersion = 10;
    delete raw.scenario;
    delete raw.startYear;
    delete raw.horizonTurns;
    raw.carriers = raw.carriers.map((c: Record<string, unknown>) => {
      const { bailouts: _drop, ...rest } = c;
      return rest;
    });
    return JSON.stringify(raw);
  };

  it('tags an old save as a present-day game and gives carriers a bailout counter', () => {
    const original = newGame(7, 'LON');
    const migrated = deserialize(asV10(original));
    expect(migrated.schemaVersion).toBe(SCHEMA_VERSION);
    expect(migrated.scenario).toBe('present');
    expect(migrated.startYear).toBe(2026);
    expect(migrated.horizonTurns).toBe(100);
    for (const carrier of migrated.carriers) expect(carrier.bailouts).toBe(0);
  });

  it('reconstructs exactly the present-day game the v10 file described', () => {
    const original = newGame(7, 'LON');
    const migrated = deserialize(asV10(original));
    expect(migrated).toEqual(original);
    // Same state means the same future: stepping a quarter lands identically.
    // (Compared as state, not as serialized bytes — the migration appends the
    // new scenario fields, so key order differs while the game does not.)
    expect(endTurn(migrated)).toEqual(endTurn(original));
  });
});

describe('migration v11 -> v12: the verdict learned to say won or lost', () => {
  /** A v11 file whose game had already ended with the given reason. */
  const asV11 = (reason: string): string => {
    const raw = JSON.parse(serialize(newGame(7, 'LON')));
    raw.schemaVersion = 11;
    raw.gameOver = { turn: 40, reason }; // v11 shape: no outcome
    return JSON.stringify(raw);
  };

  it('reads a win off the reason it recorded', () => {
    const migrated = deserialize(asV11('Every rival is gone — bankrupted or bought. The skies are yours.'));
    expect(migrated.gameOver?.outcome).toBe('won');
  });

  it('treats a bankruptcy as a loss', () => {
    const migrated = deserialize(asV11('Bankrupt. The receivers have the keys.'));
    expect(migrated.gameOver?.outcome).toBe('lost');
  });

  it('leaves an in-progress save without a verdict', () => {
    const original = newGame(7, 'LON');
    const raw = JSON.parse(serialize(original));
    raw.schemaVersion = 11;
    delete raw.gameOver; // an old in-progress save still had the field as null
    raw.gameOver = null;
    expect(deserialize(JSON.stringify(raw)).gameOver).toBeNull();
  });
});
