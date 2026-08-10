/** Display formatting. Money is always tabular; the ledger has to line up. */

export function usd(amount: number): string {
  const sign = amount < 0 ? '−' : ''; // true minus sign, not a hyphen
  const abs = Math.abs(amount);
  if (abs >= 1e9) return `${sign}$${(abs / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${sign}$${(abs / 1e6).toFixed(1)}M`;
  if (abs >= 1e3) return `${sign}$${Math.round(abs / 1e3)}K`;
  return `${sign}$${Math.round(abs)}`;
}

/** A unit price, where cents matter — fuel is quoted to the cent per liter. */
export function rate(amount: number): string {
  return `$${amount.toFixed(2)}`;
}

export function km(distance: number): string {
  return Math.round(distance).toLocaleString('en-US');
}

export function pct(fraction: number): string {
  return `${Math.round(fraction * 100)}%`;
}

/**
 * A shareholding, which must never round a real stake away to nothing.
 *
 * `pct` rounds to whole percent, and a rival taking a modest speculative position
 * in a large carrier genuinely lands under half a percent — so the treasury
 * listed "Halyard Group 0%" beside a Buy out button, which reads as a phantom
 * entry or a bug. It is neither: they really do own some of you. Below one
 * percent this shows a decimal, so accumulation is visible while it is still
 * small, which is exactly when it is worth seeing.
 */
export function stake(fraction: number): string {
  if (!(fraction > 0)) return '0%';
  if (fraction < 0.001) return '<0.1%';
  if (fraction < 0.01) return `${(fraction * 100).toFixed(1)}%`;
  return `${Math.round(fraction * 100)}%`;
}

/**
 * A carrier's technology, as something a rival can read.
 *
 * Airline programs are public — alliances, loyalty schemes, booking apps and
 * maintenance deals are all announced — so what a competitor has bought is fair
 * game. What it is *worth* to them is the part a player has to be shown, because
 * two carriers on identical aircraft flying identical sectors can differ by ten
 * points of margin and nothing else on the board explains why.
 */
export interface TechSummary {
  readonly count: number;
  /** One line per effect, e.g. "Fare +12%". Empty when nothing is delivered. */
  readonly effects: readonly string[];
  readonly names: readonly string[];
  /** Ready for a `title` attribute. */
  readonly detail: string;
}

export function techSummary(
  tech: readonly string[],
  resolved: Readonly<Record<string, number>>,
  nameOf: (id: string) => string,
  baseline: { loadCeiling: number; loadCeilingMax: number },
): TechSummary {
  const names = tech.map(nameOf);
  const effects: string[] = [];

  // Revenue first, then the cost lines, in the order the P&L reads.
  const delta = (label: string, key: string, betterWhenBelow: boolean): void => {
    const value = resolved[key];
    if (value === undefined || Math.abs(value - 1) < 0.0005) return;
    const move = Math.round((value - 1) * 1000) / 10;
    // A cost multiplier below 1 is a saving; show it as the negative it is.
    effects.push(`${label} ${move > 0 ? '+' : '−'}${Math.abs(move).toFixed(1)}%`);
    void betterWhenBelow;
  };
  delta('Fare', 'fare', false);
  delta('Demand', 'demand', false);
  delta('Fuel', 'fuelPrice', true);
  delta('Crew', 'crewCost', true);
  delta('Maintenance', 'maintenanceCost', true);
  delta('Handling', 'handlingCost', true);
  delta('Completion', 'completion', false);

  // The ceiling reads better as the figure it lands on than as a multiplier.
  const ceiling = resolved['loadCeiling'];
  if (ceiling !== undefined && Math.abs(ceiling - 1) >= 0.0005) {
    const reached = Math.min(baseline.loadCeilingMax, baseline.loadCeiling * ceiling);
    effects.push(`Fills to ${pct(reached)} rather than ${pct(baseline.loadCeiling)}`);
  }

  const detail =
    names.length === 0
      ? 'No technology programs delivered.'
      : `${names.join(', ')}.\n\n${effects.join(' · ')}`;

  return { count: tech.length, effects, names, detail };
}
