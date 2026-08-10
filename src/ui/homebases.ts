/**
 * The ten cities offered as a home base on the new-game screen.
 *
 * The map has around two hundred cities and the sim will start a game from any of
 * them; this is a curated shortlist, because "click anywhere on the world" is not
 * a decision a new player can make — every city looks the same until you know what
 * the demand model does with it.
 *
 * They are chosen to play DIFFERENTLY rather than to be the ten biggest. The
 * spread that matters is how much of a base's traffic is within narrowbody reach:
 * Cairo touches 86 short-haul markets and Sydney touches ten, so one game is about
 * running a dense feeder network and the other is about long thin sectors and the
 * aircraft that can fly them. The notes quote real figures from `demand.ts` —
 * measured with the script in the review log, not estimated — because a player
 * choosing between them deserves the number the model will actually give them.
 *
 * Ordered easiest to hardest, roughly, which is also broadest to narrowest
 * catchment. `LON` is first and is the default: the most balanced of them.
 */
export interface HomeBase {
  readonly id: string;
  /** One line on what this base is like to fly out of. */
  readonly note: string;
}

export const HOME_BASES: readonly HomeBase[] = [
  {
    id: 'LON',
    note:
      'The balanced start. 63 markets within narrowbody reach, 53% of the traffic ' +
      'short-haul, and a heavy transatlantic book behind it. Four rivals reach it in ' +
      'a typical game — busy, but you can build either way from here.',
  },
  {
    id: 'IST',
    note:
      'A crossroads. 78 short-haul markets, more than any other major hub, reaching ' +
      'Europe, the Gulf and Central Asia. Made for feeding a hub with narrowbodies, ' +
      'and quiet: about one rival comes near it.',
  },
  {
    id: 'FRA',
    note:
      '65 short-haul markets in the densest part of Europe, 57% of traffic inside ' +
      'narrowbody range. Short sectors flown often, and roughly two rivals on your ' +
      'doorstep.',
  },
  {
    id: 'TYO',
    note:
      'The largest catchment on the map — 3.5M passengers a week — but only 34 ' +
      'markets in narrowbody reach, so the traffic is concentrated and long. Also the ' +
      'most contested base here: seven rivals touch it in a typical game.',
  },
  {
    id: 'NYC',
    note:
      'A gateway. 56% of the traffic is beyond narrowbody range, so this turns into a ' +
      'widebody game earlier than most, with the Atlantic as your main asset. Five ' +
      'rivals reach it.',
  },
  {
    id: 'DEL',
    note:
      'Evenly split, 50/50 short to long, with 64 markets inside narrowbody reach. ' +
      'Substantial traffic and almost no rivals — about one comes near it.',
  },
  {
    id: 'CAI',
    note:
      'The widest reach offered — 86 short-haul markets — but the thinnest traffic on ' +
      'each of them. Breadth without depth: many sectors, none of them rich, and ' +
      'hardly a rival in sight.',
  },
  {
    id: 'DXB',
    note:
      'A pure connector. Only 41% of the traffic is short-haul and the local market is ' +
      'the slightest here, so the business is flying other people between continents. ' +
      'Nobody contests it.',
  },
  {
    id: 'SAO',
    note:
      'Isolated. Seventeen markets within narrowbody range and three quarters of the ' +
      'traffic long-haul. Few rivals reach you, and few of your markets are worth much.',
  },
  {
    id: 'SYD',
    note:
      'The hardest start offered. Ten short-haul markets and 89% of traffic beyond ' +
      'narrowbody range — everything worth flying is long and expensive. In a typical ' +
      'game no rival comes near you at all, which is both the mercy and the problem.',
  },
];
