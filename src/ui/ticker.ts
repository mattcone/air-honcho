/**
 * A number ticker: animates an element's figure from the value it last showed to
 * a new one, the way a mechanical counter rolls over. Used on the masthead so cash
 * and market cap visibly move when the books close, rather than jumping.
 *
 * The element remembers its last target, so re-rendering with an unchanged value
 * is a no-op (an instant set), and only a real change animates. A generation token
 * makes a newer update cancel an in-flight one instead of the two fighting.
 */
import { prefersReducedMotion } from './motion.ts';

const lastValue = new WeakMap<HTMLElement, number>();
const generation = new WeakMap<HTMLElement, number>();

export interface TickOptions {
  /** Total roll time in ms. */
  readonly ms?: number;
}

/** Roll `el` from its previously shown value to `value`, formatting each frame. */
export function tickNumber(
  el: HTMLElement,
  value: number,
  format: (n: number) => string,
  opts: TickOptions = {},
): void {
  const from = lastValue.get(el);
  lastValue.set(el, value);
  const gen = (generation.get(el) ?? 0) + 1;
  generation.set(el, gen);

  // First paint, no change, or motion suppressed: just show the final figure.
  if (from === undefined || from === value || !Number.isFinite(from) || prefersReducedMotion()) {
    el.textContent = format(value);
    return;
  }

  const ms = opts.ms ?? 500;
  const start = performance.now();
  const step = (now: number): void => {
    if (generation.get(el) !== gen) return; // a newer tick took over
    const t = Math.min(1, (now - start) / ms);
    const eased = 1 - (1 - t) ** 3; // easeOutCubic — quick then gently home
    el.textContent = format(from + (value - from) * eased);
    if (t < 1) requestAnimationFrame(step);
    else el.textContent = format(value);
  };
  requestAnimationFrame(step);
}
