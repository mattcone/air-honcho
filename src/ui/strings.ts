/**
 * Every line of interface copy that is not a figure, in one place.
 *
 * The voice is the one the board already had in the places it was written well —
 * "You have it to yourself" — extended to the screens that were still speaking
 * like a form. Short, dry, declarative. It states what is true and, where there
 * is something to do about it, what that is.
 *
 * Three rules, so a new line does not drift:
 *
 *  1. An empty state is an invitation, not an apology. "No aircraft yet" is a
 *     dead end; "Nothing on the books. Lease something and open a sector" is a
 *     next move.
 *  2. Never narrate the machinery. The player has a schedule and a fleet, not a
 *     route array and a state object.
 *  3. A condition names the consequence, not the mechanism. "A rival is
 *     accumulating your shares" beats "stake threshold exceeded".
 *
 * UI layer only: nothing here is read by the sim, and no sim behaviour depends on
 * a word of it.
 */

export const STRINGS = {
  /**
   * Says the quiet part once, where the question actually occurs to someone: in
   * front of the aircraft they are about to buy. Deliberately does NOT name the
   * real types — the fictional names exist to keep trademarks off the board, and
   * printing "based on the A321neo" under every card would put them back. Anyone
   * who knows the industry will recognise the classes from the numbers, which is
   * the point of getting the numbers right.
   */
  marketProvenance:
    'Aircraft here are fictional, but each one is modelled on a real type — seats, ' +
    'range, cruise and fuel burn are taken from the published figures for its class. ' +
    'The names are invented; the numbers are not.',

  /** Nothing has been built yet. Each of these is the first thing a player reads. */
  empty: {
    schedule: 'Nothing on the books. Lease an aircraft, then click two cities to price a sector.',
    fleet: 'No aircraft. You cannot fly a schedule without metal.',
    rivals: 'Nobody has noticed you yet.',
    conditions: 'No events running.',
    slots: 'No slots yet. Saving one keeps a game you can come back to — the autosave only ever holds your latest quarter.',
    tech: 'No programs delivered. Technology is the largest lever on this board.',
    holdings: 'You hold no stakes in anyone.',
    shareholders: 'No rival holds your stock.',
  },

  /** What a sector is doing, said plainly enough to act on. */
  sector: {
    uncontested: 'You have it to yourself.',
    contested: (n: number): string =>
      n === 1 ? 'One rival is on this market.' : `${n} rivals are on this market.`,
    bleeding: 'This sector is losing money every quarter it flies.',
    grounded: 'Nothing is assigned. The sector is open and flying nothing.',
    outOfRange: 'No aircraft you own can reach it.',
    spilling: 'You are turning away traffic you have already won.',
    /**
     * A rival has opened this market but has nothing flying on it yet — metal on
     * order, or a sector opened and not filled. They take no share until they
     * fly, so they are correctly absent from the share table; they are also the
     * single most useful thing to know about the sector, and saying "you have it
     * to yourself" while their line sits on the map is simply wrong.
     */
    incoming: (names: readonly string[]): string => {
      const list = names.length === 1
        ? names[0]!
        : `${names.slice(0, -1).join(', ')} and ${names.at(-1)!}`;
      return names.length === 1
        ? `${list} has opened this market and is not flying it yet.`
        : `${list} have opened this market and are not flying it yet.`;
    },
  },

  /** First-turn coaching. */
  coach: {
    /** Appended to the step counter when the player has paged off the live step. */
    readingAhead: 'reading ahead',
  },

  /** Things that have just happened to you, in the order of how much they matter. */
  notice: {
    rivalEntered: (who: string, where: string): string =>
      `${who} has opened ${where}. Your share of it falls from here.`,
    aircraftAging: (type: string): string =>
      `Your ${type}s are old enough that maintenance is now the largest line against them.`,
    firstProfit: 'The quarter closed in profit. That is the loop working.',
    hedgeExpired: 'Your fuel hedge has run out. You are paying spot again.',
  },
} as const;
