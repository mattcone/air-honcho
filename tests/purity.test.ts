/**
 * Enforces the working agreements that the type system cannot:
 *
 *   "Sim layer: no DOM, no Math.random, no Date.now (turn count is the only clock)."
 *   "Data before code: content lives in JSON, never in code."
 *
 * These rules are what make the game deterministic and headless-testable, so
 * they get a test rather than a code-review convention.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const SIM_DIR = join(import.meta.dirname, '../src/sim');

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return entry.endsWith('.ts') ? [full] : [];
  });
}

/** Strip comments and strings so a rule named in prose doesn't trip its own test. */
function code(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '')
    .replace(/'(?:[^'\\]|\\.)*'/g, "''")
    .replace(/"(?:[^"\\]|\\.)*"/g, '""')
    .replace(/`(?:[^`\\]|\\.)*`/g, '``');
}

const files = sourceFiles(SIM_DIR);

describe('sim layer purity', () => {
  it('finds the sim sources', () => {
    expect(files.length).toBeGreaterThan(4);
  });

  it.each([
    ['Math.random', /\bMath\s*\.\s*random\b/],
    ['Date.now', /\bDate\s*\.\s*now\b/],
    ['new Date', /\bnew\s+Date\b/],
    ['document', /\bdocument\s*\./],
    ['window', /\bwindow\s*\./],
    ['performance', /\bperformance\s*\./],
  ])('never uses %s', (_name, pattern) => {
    const offenders = files.filter((file) => pattern.test(code(readFileSync(file, 'utf8'))));
    expect(offenders).toEqual([]);
  });

  it('touches localStorage only behind a guard, and only in save.ts', () => {
    const offenders = files.filter(
      (file) => /localStorage/.test(code(readFileSync(file, 'utf8'))) && !file.endsWith('save.ts'),
    );
    expect(offenders).toEqual([]);
    expect(readFileSync(join(SIM_DIR, 'save.ts'), 'utf8')).toMatch(/typeof localStorage === 'undefined'/);
  });

  it('imports nothing from the ui layer', () => {
    const offenders = files.filter((file) => /from\s+'[^']*\/ui\//.test(readFileSync(file, 'utf8')));
    expect(offenders).toEqual([]);
  });
});

describe('balance constants live in data', () => {
  // SCHEMA_VERSION is a structural constant, not a balance figure — it has to be
  // a literal in code because save migrations key off it.
  const engine = code(readFileSync(join(SIM_DIR, 'engine.ts'), 'utf8'))
    .replace(/export const SCHEMA_VERSION = \d+;/, '');

  it('has no bare magic numbers in engine.ts', () => {
    // Allow 0, 1, -1 and small array/index arithmetic; anything larger is a
    // balance figure and belongs in constants.json.
    const literals = engine.match(/(?<![\w.$])\d[\d_]*(?:\.\d+)?/g) ?? [];
    const suspicious = literals.filter((literal) => Number(literal.replace(/_/g, '')) > 1);
    expect(suspicious).toEqual([]);
  });
});

describe('copy-on-write invariant', () => {
  // engine.ts clone() shares history, rivalPlan and enteredRivals with the
  // previous state instead of deep-copying them, because deep-cloning the whole
  // game was 74% of a headless run. That is only safe while nothing mutates
  // those arrays in place.
  const engine = code(readFileSync(join(SIM_DIR, 'engine.ts'), 'utf8'));
  const mutators = ['push', 'pop', 'shift', 'unshift', 'splice', 'sort', 'reverse'];

  it.each(['history', 'rivalPlan', 'enteredRivals'])('never mutates %s in place', (field) => {
    const offenders = mutators.filter((m) =>
      new RegExp(String.raw`\.${field}\s*\.\s*${m}\s*\(`).test(engine),
    );
    expect(offenders, `${field} must be replaced wholesale, not edited`).toEqual([]);
  });

  // clone() also shares these per-carrier arrays by reference. Editing one in
  // place would reach back into the previous state, and `tech` additionally
  // keys the memo in conditions.ts — a push would leave that cache serving
  // stale effects for an array whose contents had changed underneath it.
  const allSim = files.map((f) => code(readFileSync(f, 'utf8'))).join('\n');

  it.each(['tech', 'techInProgress'])('never mutates carrier.%s in place', (field) => {
    const offenders = mutators.filter((m) =>
      new RegExp(String.raw`\.${field}\s*\.\s*${m}\s*\(`).test(allSim),
    );
    expect(offenders, `carrier.${field} must be replaced wholesale, not edited`).toEqual([]);
  });

  it('clones by hand rather than deep-copying the whole state', () => {
    expect(engine).not.toMatch(/structuredClone/);
  });
});
