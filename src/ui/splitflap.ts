/**
 * A split-flap (solari) display — the airport departure-board reveal used for the
 * quarterly result. Each character sits in its own flap cell; on reveal the cells
 * riffle through glyphs and settle left to right, the way a board lands on a new
 * time. Pure decoration over a value that is already correct: the final text is in
 * the DOM (as the cell contents and an aria-label) from the first frame, so a
 * screen reader and prefers-reduced-motion both see the answer, not the churn.
 */

import { prefersReducedMotion } from './motion.ts';
import { playFlap } from './sound.ts';

/** The glyphs a flapping cell riffles through — the vocabulary of a money figure. */
const GLYPHS = '0123456789.,+-$MBK';

export interface FlapOptions {
  /** ms the first cell spends riffling before it locks. */
  readonly settleMs?: number;
  /** ms of extra delay per cell, so the row settles left to right. */
  readonly stepMs?: number;
  /** ms between glyph changes while a cell is riffling. */
  readonly flipMs?: number;
}

/** A non-breaking space, so a blank cell still reserves its width. */
const NBSP = ' ';
const show = (ch: string): string => (ch === ' ' ? NBSP : ch);

/**
 * Build a split-flap element for `text` and start its reveal. Returns immediately;
 * the animation runs on its own rAF loop and stops once every cell has settled.
 */
export function splitFlap(text: string, opts: FlapOptions = {}): HTMLElement {
  const settleMs = opts.settleMs ?? 380;
  const stepMs = opts.stepMs ?? 55;
  const flipMs = opts.flipMs ?? 48;

  const root = document.createElement('span');
  root.className = 'flap';
  root.setAttribute('role', 'img');
  root.setAttribute('aria-label', text);

  const cells = [...text].map((target) => {
    const cell = document.createElement('span');
    cell.className = 'flap-cell';
    cell.setAttribute('aria-hidden', 'true');
    cell.textContent = show(target); // the true value shows first; motion only obscures it
    root.append(cell);
    return { cell, target, locked: false, nextFlip: 0 };
  });

  // Nothing to animate, or the viewer asked us not to: leave the final value put.
  if (cells.length === 0 || prefersReducedMotion()) return root;

  const randomGlyph = (): string => GLYPHS[Math.floor(Math.random() * GLYPHS.length)]!;
  const start = performance.now();
  for (const c of cells) c.cell.classList.add('is-flapping');

  const tick = (now: number): void => {
    let running = false;
    cells.forEach((c, i) => {
      if (c.locked) return;
      const settleAt = start + settleMs + i * stepMs;
      if (now >= settleAt) {
        c.cell.textContent = show(c.target);
        c.cell.classList.remove('is-flapping');
        c.cell.classList.add('is-settling');
        c.locked = true;
        // One click per leaf as it lands, so the board sounds like the thing it
        // is drawn as. Silent unless the player turned sound on.
        if (c.target !== ' ') playFlap();
        return;
      }
      running = true;
      if (now >= c.nextFlip) {
        // A space stays blank rather than riffling — a gap is a gap.
        c.cell.textContent = c.target === ' ' ? NBSP : randomGlyph();
        c.nextFlip = now + flipMs;
      }
    });
    if (running) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  return root;
}
