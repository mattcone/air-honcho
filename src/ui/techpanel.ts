/**
 * The technology disclosure, shared by the market board, the annual report and
 * the technology dialog.
 *
 * Programs are legible on their own; their combined effect is not. Eight
 * multipliers spread across revenue and four cost lines cannot be compounded in
 * anyone's head, so every place that shows what a carrier has bought also shows
 * what it is returning in cash.
 */
import { usd } from './format.ts';
import { turnLabel } from '../sim/engine.ts';
import type { QuarterResult } from '../sim/types.ts';
import type { TechSummary } from './format.ts';

export function el(tag: string, className?: string, text?: string): HTMLElement {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/**
 * The caution mark: a filled triangle with the bar and dot knocked out in paper.
 *
 * Drawn rather than typed. The emoji it stands in for renders in a different font on
 * every platform, arrives in a colour this palette does not own, and sits wherever
 * that font's metrics put it. An inline SVG takes its colour from `--caution` and its
 * size from the type around it, so it is the same mark on every machine. Both fills are
 * set in the stylesheet rather than as presentation attributes: `var()` inside an SVG
 * `fill` attribute is not substituted by every engine, and this has to hold up in
 * Safari on a phone as well as in Chrome.
 *
 * Decoration, not information: it flags prose the reader is about to read anyway, so
 * it is hidden from assistive tech rather than given a label that would be announced
 * before every one of these notes.
 */
export function cautionMark(): SVGSVGElement {
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 16 16');
  svg.setAttribute('class', 'caution-mark');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  const tri = document.createElementNS(NS, 'path');
  tri.setAttribute('d', 'M7.13 1.7 0.68 12.87A1 1 0 0 0 1.55 14.37h12.9a1 1 0 0 0 0.87-1.5L8.87 1.7a1 1 0 0 0-1.74 0Z');
  tri.setAttribute('class', 'caution-body');
  const bar = document.createElementNS(NS, 'rect');
  for (const [k, v] of Object.entries({ x: 7.2, y: 5.3, width: 1.6, height: 4.6, rx: 0.8 })) {
    bar.setAttribute(k, String(v));
  }
  bar.setAttribute('class', 'caution-knockout');
  const dot = document.createElementNS(NS, 'circle');
  for (const [k, v] of Object.entries({ cx: 8, cy: 12.05, r: 0.95 })) dot.setAttribute(k, String(v));
  dot.setAttribute('class', 'caution-knockout');
  svg.append(tri, bar, dot);
  return svg;
}

/** A labeled figure. `negative` colors the value for losses. */
export function figure(label: string, value: string, negative = false): HTMLElement {
  const wrap = el('div', 'figure');
  wrap.append(el('dt', undefined, label));
  const dd = el('dd', undefined, value);
  dd.classList.toggle('is-negative', negative);
  wrap.append(dd);
  return wrap;
}

/**
 * Costs read as negatives here because this is a cash statement, not a table of
 * magnitudes — the column has to add up on screen.
 */
export function costLine(label: string, amount: number): HTMLElement {
  return figure(label, usd(-amount));
}

/**
 * One carrier's last settled quarter, in the same shape as the player's own.
 * `trailing` is the four quarters up to and including it, for the trend line.
 */
export function quarterPanel(
  last: QuarterResult,
  trailing: readonly QuarterResult[],
  startYear?: number,
): HTMLElement {
  const panel = el('div', 'quarter-detail');
  const head = el('div', 'tech-detail-head');
  head.append(el('span', 'tech-detail-label', `Quarter to ${turnLabel(last.turn, startYear)}`));
  const margin = last.revenue > 0 ? (last.netIncome / last.revenue) * 100 : 0;
  head.append(
    el(
      'span',
      margin < 0 ? 'tech-detail-worth is-negative' : 'tech-detail-worth',
      `${margin.toFixed(1)}% net margin`,
    ),
  );
  panel.append(head);

  const list = el('dl', 'figures');
  list.append(figure('Revenue', usd(last.revenue)));
  list.append(costLine('Fuel', last.fuel));
  list.append(costLine('Crew', last.crew));
  list.append(costLine('Maintenance', last.maintenance));
  list.append(costLine('Handling', last.handling));
  list.append(costLine('Leases', last.lease));
  list.append(costLine('Standing', last.standing));
  list.append(costLine('Stations', last.fixed));
  list.append(costLine('Overhead', last.overhead));
  // Interest is charged below the operating line and can dwarf every cost above
  // it on a leveraged carrier — show it whenever there is debt to service, so the
  // net actually reconciles with the lines above.
  if (last.interest > 0) {
    const interest = costLine('Interest', last.interest);
    interest.title = 'The quarter\'s debt service. On a highly-geared airline this is often the largest single cost — pay debt down to shrink it.';
    list.append(interest);
  }
  if (last.dividendIncome && last.dividendIncome > 0) {
    const div = figure('Dividend income', usd(last.dividendIncome));
    div.title = 'Dividends collected this quarter on your stakes in other carriers.';
    list.append(div);
  }
  list.append(costLine('Tax', last.tax));
  const net = figure('Net', usd(last.netIncome), last.netIncome < 0);
  net.classList.add('figure-total');
  list.append(net);
  panel.append(list);

  // A single quarter says nothing about direction. Four says whether they are
  // climbing out or sliding in, which is what decides whether to fight them.
  if (trailing.length > 1) {
    const trend = el('div', 'quarter-trend');
    trend.append(el('span', 'tech-detail-label', 'Trailing'));
    for (const q of trailing) {
      const cell = el('span', 'quarter-trend-cell');
      cell.append(el('span', 'quarter-trend-label', turnLabel(q.turn, startYear)));
      const value = el('span', 'quarter-trend-value', usd(q.netIncome));
      value.classList.toggle('is-negative', q.netIncome < 0);
      cell.append(value);
      trend.append(cell);
    }
    panel.append(trend);
  }
  return panel;
}

/**
 * What a carrier's technology is, and what it is earning them here.
 *
 * The cash figure is this sector's net with their programs against the same
 * sector with none of them, everything else held equal — so it is what the
 * investment is actually returning, not a list of percentages to be multiplied
 * out by hand.
 */
export function techPanel(tech: TechSummary, worth: number | null, scope = 'on this sector'): HTMLElement {
  const panel = el('div', 'tech-detail');

  const head = el('div', 'tech-detail-head');
  head.append(el('span', 'tech-detail-label', 'Technology'));
  if (tech.count > 0 && worth !== null) {
    const value = el(
      'span',
      worth < 0 ? 'tech-detail-worth is-negative' : 'tech-detail-worth',
      `${worth < 0 ? 'Costing' : 'Worth'} ${usd(Math.abs(worth))} a quarter ${scope}`,
    );
    head.append(value);
  }
  panel.append(head);

  if (tech.count === 0) {
    panel.append(el('span', 'tech-detail-none', 'No programs delivered.'));
    return panel;
  }

  const chips = el('div', 'tech-chips');
  for (const name of tech.names) chips.append(el('span', 'tech-chip', name));
  panel.append(chips);

  const effects = el('div', 'tech-effects');
  for (const effect of tech.effects) effects.append(el('span', 'tech-effect', effect));
  panel.append(effects);

  return panel;
}

