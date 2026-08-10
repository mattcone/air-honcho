/**
 * Save format. Versioned from day one.
 *
 * The rules: additive changes preferred; when the shape must break, bump
 * SCHEMA_VERSION in engine.ts and add a migration below. `loadGame` walks a save
 * up through every migration in turn, so a v1 file still opens at v7.
 *
 * No DOM in this module's core — `serialize`/`deserialize` are pure, and the
 * localStorage helpers guard for a missing `window` so the headless runner and
 * Vitest can import this file freely.
 */
import type { GameState } from './types.ts';
import { SCHEMA_VERSION } from './engine.ts';
import { CONSTANTS } from './world.ts';
import { AIRCRAFT_TYPES } from './fleet.ts';

const STORAGE_KEY = 'air-honcho:autosave';

/** A save read off disk, before migration — shape unknown beyond the version. */
interface UnknownSave {
  schemaVersion?: unknown;
  [key: string]: unknown;
}

/**
 * migrations[n] upgrades a save from version n to version n+1.
 * Add entries here; never edit an existing one.
 */
const migrations: Record<number, (save: UnknownSave) => UnknownSave> = {
  // Pre-release breaks, both deliberate and both unmigratable:
  //   v1 -> v2  Phase 0 saves have no fleet at all.
  //   v2 -> v3  Phase 1 saves have no rival cast, and it cannot be invented
  //             after the fact without changing the game the seed promised.
  //   v3 -> v4  Phase 2 saves have no event history, fuel walk or tech state.
  //   v4 -> v5  Technology and hedging moved from the world onto the carrier
  //             that paid for them; a v4 save cannot say who owned what.
  // An old autosave is discarded (loadAutosave swallows the error) and an
  // explicit import reports it. Real migrations start from v5.

  /**
   * v5 -> v6  `colour` became `color` when the project moved to US spelling.
   * A pure rename, on carriers and on the rival cast. Nothing else moves, so a
   * v5 game continues exactly as it was.
   */
  5: (save) => {
    // Renamed in place rather than appended, so key order is untouched. A
    // migrated save must serialize byte-identically to a fresh one — the
    // determinism checks compare states as strings, and a moved key would read
    // as a divergence that is not there.
    const rename = (row: unknown): unknown => {
      if (typeof row !== 'object' || row === null) return row;
      const out: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(row as Record<string, unknown>)) {
        out[key === 'colour' ? 'color' : key] = value;
      }
      return out;
    };
    const list = (value: unknown): unknown =>
      Array.isArray(value) ? value.map(rename) : value;
    return { ...save, carriers: list(save['carriers']), rivalPlan: list(save['rivalPlan']) };
  },

  /**
   * v6 -> v7  Rivals gained a `gaugeBias` (fleet-planning accuracy). An old plan
   * has none; default every rival to 1 — a sharp planner — so a resumed game
   * plays on unchanged rather than suddenly mis-sizing fleets.
   */
  6: (save) => {
    const plan = save['rivalPlan'];
    if (!Array.isArray(plan)) return save;
    const patched = plan.map((row) =>
      typeof row === 'object' && row !== null && !('gaugeBias' in row)
        ? { ...(row as Record<string, unknown>), gaugeBias: 1 }
        : row,
    );
    return { ...save, rivalPlan: patched };
  },

  /**
   * v7 -> v8  The financial layer arrived. Carriers gained shares, debt,
   * holdings and an integration clock; quarter results gained an interest line.
   * A pre-finance save has none — give every carrier a clean balance sheet (no
   * debt, no stakes, the standard float) and every past quarter zero interest,
   * so the game it describes is unchanged and simply cannot yet borrow.
   */
  7: (save) => {
    const shares = CONSTANTS.finance.startingShares;
    // Appended after the existing keys so a migrated carrier serializes in the
    // same order as a fresh one — the determinism checks compare states as
    // strings, and a reordered key would read as a divergence that is not there.
    const carriers = Array.isArray(save['carriers'])
      ? save['carriers'].map((c) =>
          typeof c === 'object' && c !== null
            ? {
                ...(c as Record<string, unknown>),
                shares, debt: 0, holdings: {}, integrationUntil: null, acquiredBy: null,
              }
            : c,
        )
      : save['carriers'];
    const history = Array.isArray(save['history'])
      ? save['history'].map((h) =>
          typeof h === 'object' && h !== null && !('interest' in h)
            ? { ...(h as Record<string, unknown>), interest: 0 }
            : h,
        )
      : save['history'];
    const peak = typeof save['playerPeakEquity'] === 'number' ? save['playerPeakEquity'] : 0;
    return { ...save, carriers, history, playerPeakEquity: peak };
  },

  /**
   * v8 -> v9  Aircraft gained a delivery date. Everything already in a fleet has
   * of course already arrived, so an old tail's delivery is its acquisition turn.
   */
  8: (save) => {
    if (!Array.isArray(save['carriers'])) return save;
    const carriers = save['carriers'].map((c) => {
      if (typeof c !== 'object' || c === null) return c;
      const carrier = c as Record<string, unknown>;
      if (!Array.isArray(carrier['fleet'])) return c;
      const fleet = carrier['fleet'].map((t) =>
        typeof t === 'object' && t !== null && !('deliversTurn' in t)
          ? { ...(t as Record<string, unknown>), deliversTurn: (t as Record<string, unknown>)['acquiredTurn'] ?? 0 }
          : t,
      );
      return { ...carrier, fleet };
    });
    return { ...save, carriers };
  },

  /**
   * v9 -> v10  Aircraft gained launch dates. An old save never rolled them, so
   * make every type available from the start — the game it describes had them all
   * on offer, and nothing it did depended on a launch it never saw.
   */
  9: (save) => {
    if (save['aircraftIntro'] && typeof save['aircraftIntro'] === 'object') return save;
    const intro: Record<string, number> = {};
    for (const type of AIRCRAFT_TYPES) intro[type.id] = 0;
    return { ...save, aircraftIntro: intro };
  },

  /**
   * v10 -> v11  Scenarios arrived (present-day / history). Every existing save is
   * a present-day game — that is all there was — so tag it, and take its horizon
   * and start year from the present-day scenario.
   */
  10: (save) => ({
    ...save,
    scenario: 'present',
    startYear: 2026,
    horizonTurns: 100,
    carriers: Array.isArray(save['carriers'])
      ? save['carriers'].map((c) =>
          typeof c === 'object' && c !== null && !('bailouts' in c)
            ? { ...(c as Record<string, unknown>), bailouts: 0 }
            : c,
        )
      : save['carriers'],
  }),

  /**
   * v11 -> v12  The end-of-game record gained a won/lost outcome so the UI can
   * tell a victory from a bankruptcy. An in-progress save has `gameOver: null`
   * and needs nothing; a save of an already-ended game gets its outcome read off
   * the reason it recorded (only two reasons are wins).
   */
  11: (save) => {
    const over = save['gameOver'];
    if (typeof over !== 'object' || over === null) return save;
    const reason = String((over as Record<string, unknown>)['reason'] ?? '');
    const won = /the skies are yours|most valuable carrier/i.test(reason);
    return { ...save, gameOver: { ...(over as Record<string, unknown>), outcome: won ? 'won' : 'lost' } };
  },

  /**
   * v12 -> v13  The stock market grew up: carriers now carry a per-quarter
   * purchase counter and a dividend policy. Old carriers had neither — give them
   * an empty counter and a zero dividend, which is exactly how they behaved.
   */
  12: (save) => ({
    ...save,
    carriers: Array.isArray(save['carriers'])
      ? save['carriers'].map((c) =>
          typeof c === 'object' && c !== null
            ? { ...(c as Record<string, unknown>), stakeBought: {}, dividend: 0 }
            : c,
        )
      : save['carriers'],
  }),

  /**
   * v13 -> v14  Difficulty arrived. Every existing save was played on the tuned
   * baseline — that is all there was — so tag it medium and it continues unchanged.
   */
  13: (save) => ({ ...save, difficulty: 'medium' }),
  /*
   * v15 adds Chapter 11. Carriers gain a restructuring count and the world gains
   * a distressed-aircraft market. Both are additive and both default correctly
   * from absent, so an old save simply arrives with nobody having restructured
   * and nothing on the block — which is exactly what was true of it.
   */
  14: (save) => ({ ...save, distressed: [] }),

  /**
   * v15 -> v16  Carriers gained `transferredThisQuarter`, the per-quarter limit on
   * cash moved between a controller and a carrier it commands. Rebuilt key by key
   * rather than spread-and-append, so the field lands where `newGame` puts it —
   * between `hedge` and `bankruptTurn` — and a migrated save still serializes
   * byte-identically to a fresh one. A v15 game has moved nothing, so zero.
   */
  15: (save) => ({
    ...save,
    carriers: (save.carriers as Record<string, unknown>[]).map((carrier) => {
      const rebuilt: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(carrier)) {
        if (key === 'bankruptTurn') rebuilt.transferredThisQuarter = 0;
        rebuilt[key] = value;
      }
      if (!('transferredThisQuarter' in rebuilt)) rebuilt.transferredThisQuarter = 0;
      return rebuilt;
    }),
  }),
};

// The ladder has to be contiguous from the oldest migratable version up to the
// current one, or a save climbs partway and stops with "no migration path" — a
// failure that only shows up when someone opens an old file. Validated at load,
// the way demand.ts validates its seasonality table.
{
  const versions = Object.keys(migrations).map(Number).sort((a, b) => a - b);
  const oldest = versions[0];
  if (oldest !== undefined) {
    for (let v = oldest; v < SCHEMA_VERSION; v++) {
      if (!migrations[v]) {
        throw new Error(`save.ts: migration ladder has a gap at v${v} -> v${v + 1}`);
      }
    }
  }
}

export function serialize(state: GameState): string {
  return JSON.stringify(state, null, 2);
}

export class SaveError extends Error {}

export function deserialize(text: string): GameState {
  let raw: UnknownSave;
  try {
    raw = JSON.parse(text) as UnknownSave;
  } catch {
    throw new SaveError('That file is not valid JSON.');
  }

  if (typeof raw !== 'object' || raw === null) throw new SaveError('That file is not a save.');

  let version = raw.schemaVersion;
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) {
    throw new SaveError('That file is not an Air Honcho save (no schemaVersion).');
  }

  if (version > SCHEMA_VERSION) {
    throw new SaveError(
      `That save is from a newer version of the game (save v${version}, this build reads v${SCHEMA_VERSION}).`,
    );
  }

  let save = raw;
  while (version < SCHEMA_VERSION) {
    const migrate = migrations[version];
    if (!migrate) throw new SaveError(`No migration path from save version ${version}.`);
    save = migrate(save);
    version += 1;
    save.schemaVersion = version;
  }

  assertGameState(save);
  return save;
}

/**
 * The numbers the sim does arithmetic on every turn. A save can be structurally
 * perfect and still carry a string here — a hand-edited file, or one truncated and
 * repaired by something well-meaning — and nothing downstream would notice: `cash`
 * of `"plenty"` becomes `"plenty0"` on the first settlement rather than throwing,
 * and one NaN spreads through every figure on the board. Checked at the door, where
 * it can still be reported as a bad file.
 */
const NUMERIC_FIELDS: readonly string[] = ['seed', 'rngState', 'seq', 'turn', 'fuelPrice', 'baseCompletion'];
const NUMERIC_CARRIER_FIELDS: readonly string[] = ['cash', 'shares', 'debt'];

function assertFinite(value: unknown, label: string): void {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new SaveError(`Save has a bad value for "${label}" — expected a number, got ${JSON.stringify(value)}.`);
  }
}

/** Cheap structural check — enough to reject a wrong-shaped file with a clear message. */
function assertGameState(save: UnknownSave): asserts save is GameState & UnknownSave {
  const required: readonly string[] = [
    'seed', 'rngState', 'turn', 'playerCarrierId', 'fuelPrice', 'seq', 'rivalPlan',
    'enteredRivals', 'baseCompletion', 'events',
  ];
  for (const key of required) {
    if (!(key in save)) throw new SaveError(`Save is missing "${key}".`);
  }
  for (const key of NUMERIC_FIELDS) assertFinite(save[key], key);
  if (!Array.isArray(save['carriers'])) throw new SaveError('Save is missing carriers.');
  for (const carrier of save['carriers'] as Record<string, unknown>[]) {
    const who = typeof carrier['id'] === 'string' ? carrier['id'] : 'a carrier';
    for (const key of NUMERIC_CARRIER_FIELDS) assertFinite(carrier[key], `${who}.${key}`);
    if (!Array.isArray(carrier['fleet'])) throw new SaveError('Save has a carrier with no fleet.');
    if (!Array.isArray(carrier['tech'])) throw new SaveError('Save has a carrier with no tech record.');
    if (!Array.isArray(carrier['techInProgress'])) {
      throw new SaveError('Save has a carrier with no technology pipeline.');
    }
  }
  if (!Array.isArray(save['routes'])) throw new SaveError('Save is missing routes.');
  if (!Array.isArray(save['history'])) throw new SaveError('Save is missing history.');
}

// --- Browser autosave -------------------------------------------------------

function storage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    // Private-mode / disabled-storage browsers throw on access rather than
    // returning undefined. An autosave is a nicety, not a requirement.
    return null;
  }
}

export function autosave(state: GameState): void {
  const store = storage();
  if (!store) return;
  try {
    store.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Quota exceeded. The player can still export manually.
  }
}

export function loadAutosave(): GameState | null {
  const store = storage();
  if (!store) return null;
  const text = store.getItem(STORAGE_KEY);
  if (!text) return null;
  try {
    return deserialize(text);
  } catch {
    return null;
  }
}

export function clearAutosave(): void {
  const store = storage();
  store?.removeItem(STORAGE_KEY);
}

// --- Named save slots -------------------------------------------------------
//
// The autosave is a safety net you never think about; a slot is a decision you
// made — the save before betting the company on a widebody order. Kept in the
// same storage and the same serialized format, so a slot is exportable and a
// migration reaches it exactly as it reaches an autosave.

const SLOT_PREFIX = 'air-honcho:slot:';
export const MAX_SLOTS = 6;

export interface SlotInfo {
  readonly name: string;
  readonly turn: number;
  readonly startYear: number;
  readonly scenario: string;
  readonly difficulty: string;
}

/** Every slot in use, oldest name order, with just enough to label a button. */
export function listSlots(): SlotInfo[] {
  const store = storage();
  if (!store) return [];
  const out: SlotInfo[] = [];
  for (let i = 0; i < store.length; i++) {
    const key = store.key(i);
    if (!key || !key.startsWith(SLOT_PREFIX)) continue;
    const text = store.getItem(key);
    if (!text) continue;
    try {
      // Read the header only: a slot written by an older build still lists, and
      // still reports what it is, even if it would need a migration to open.
      const raw = JSON.parse(text) as Record<string, unknown>;
      out.push({
        name: key.slice(SLOT_PREFIX.length),
        turn: typeof raw['turn'] === 'number' ? raw['turn'] : 0,
        startYear: typeof raw['startYear'] === 'number' ? raw['startYear'] : 0,
        scenario: String(raw['scenario'] ?? 'present'),
        difficulty: String(raw['difficulty'] ?? 'medium'),
      });
    } catch {
      // Unreadable slot: skip it rather than break the whole list.
    }
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

/** Returns false when storage is unavailable or full — the caller must tell the player. */
export function saveSlot(name: string, state: GameState): boolean {
  const store = storage();
  if (!store || !name.trim()) return false;
  const key = SLOT_PREFIX + name.trim();
  // The cap belongs here and not only on the button that calls this. Overwriting
  // a slot that already exists is always allowed; minting a NEW one past the cap
  // is not, however the caller got here.
  if (store.getItem(key) === null && listSlots().length >= MAX_SLOTS) return false;
  try {
    store.setItem(key, serialize(state));
    return true;
  } catch {
    return false;
  }
}

export function loadSlot(name: string): GameState | null {
  const text = storage()?.getItem(SLOT_PREFIX + name);
  if (!text) return null;
  return deserialize(text); // throws SaveError on an unmigratable slot; the UI reports it
}

export function deleteSlot(name: string): void {
  storage()?.removeItem(SLOT_PREFIX + name);
}
