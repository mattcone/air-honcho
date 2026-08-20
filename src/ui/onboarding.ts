/**
 * First-turn onboarding: four tooltips, not a tutorial mode.
 *
 * CLAUDE.md pillar 3 says turn 1 must be playable in under two minutes with no
 * tutorial, so this never blocks, never takes the controls, and never gates a
 * step. Each note points at a real control, waits for the player to actually do
 * that thing, and then gets out of the way. Dismissing any of them ends the whole
 * sequence for good — someone who does not want hand-holding says so once.
 *
 * The steps are keyed to game state rather than to clicks, so a player who worked
 * it out for themselves never sees the note telling them to do what they just did.
 *
 * Nothing is coached before a game exists. The start dialog owns that moment: it is
 * a native <dialog> opened with showModal(), which the browser puts in the TOP
 * LAYER, above every stacking context on the page. A note anchored to the map
 * therefore renders behind it however high its z-index goes — the bug this rule
 * fixes — and it would be pointing at a control the player cannot reach anyway.
 * Home base is chosen in that dialog now, which is why there is no note about it.
 */
import type { GameState } from '../sim/types.ts';

const SEEN_KEY = 'air-honcho:onboarded';

export interface OnboardingStep {
  readonly id: string;
  /** CSS selector for the control this note is about. */
  readonly anchor: string;
  readonly text: string;
  /** True once the player has done this step — the note retires itself. */
  done(game: GameState | null): boolean;
}

const playerRoutes = (game: GameState | null): number =>
  game ? game.routes.filter((r) => r.carrierId === game.playerCarrierId).length : 0;

export const STEPS: readonly OnboardingStep[] = [
  {
    id: 'fleet',
    anchor: '#acquire',
    text: 'You cannot fly without an aircraft. Lease one — leasing costs cash every quarter but leaves the bank intact.',
    done: (game) => (game?.carriers.find((c) => c.isPlayer)?.fleet.length ?? 0) > 0,
  },
  {
    id: 'route',
    anchor: '#map-frame',
    /*
     * This used to say "short, busy pairs pay before long thin ones", which points a
     * new player at the one part of the map the economy punishes hardest. Ground
     * handling is charged per departure, and a short sector turns so often that the
     * line runs past half of revenue under about 300km while sitting near 15% at
     * 2,400km — so the nearest city is usually the worst first sector, not the best.
     */
    text: 'Now pick a sector: click your home city, then a destination. You will see what it costs before you open it — and give it some distance. Your nearest neighbours turn so often that ground handling eats them.',
    done: (game) => playerRoutes(game) > 0,
  },
  {
    id: 'posture',
    anchor: '#inspector',
    text: 'Select the sector to set its fare posture. Undercut fills seats and invites a fight; Premium earns more per head.',
    // Retires once there is metal on a sector: the player is ready to fly, and
    // whether they actually changed the posture is rightly their business — reading
    // the dossier is the point. It must NOT key on `turn > 0` like the step after
    // it; both then retire on the very same event, and the last note — the one that
    // explains how to end a turn at all — is never shown once.
    done: (game) =>
      (game?.carriers.find((c) => c.isPlayer)?.fleet ?? []).some((a) => a.routeId !== null),
  },
  {
    id: 'books',
    anchor: '#close-books',
    text: 'Close the books to fly the quarter. The board briefing afterwards tells you what changed and what to worry about.',
    done: (game) => (game?.turn ?? 0) > 0,
  },
];

export function onboardingSeen(): boolean {
  try {
    return localStorage.getItem(SEEN_KEY) === 'yes';
  } catch {
    return true; // storage blocked: do not nag on every load
  }
}

export function markOnboardingSeen(): void {
  try {
    localStorage.setItem(SEEN_KEY, 'yes');
  } catch {
    // Nothing to do — the sequence simply reappears next session.
  }
}

/**
 * Coaching stops after this many quarters however much of it went unread. Someone
 * who has closed the books twice has found their feet, and a player deliberately
 * flying no aircraft should not be nagged about it for the rest of a 25-year game.
 */
const COACH_UNTIL_TURN = 2;

/** The first step the player has not yet completed, or null when they are done. */
export function nextStep(game: GameState | null): OnboardingStep | null {
  // No game yet means the start dialog is up; see the note at the top of this file.
  if (game === null) return null;
  if (game.turn >= COACH_UNTIL_TURN) return null;
  return STEPS.find((s) => !s.done(game)) ?? null;
}
