/**
 * Phase 1 balance fixture — the stand-in player used by the headless runner and
 * the CI regression suite.
 *
 * It plays the decisions the game is about: match aircraft gauge to market size,
 * renew airframes before maintenance eats them, and retreat from sectors that
 * stop paying. It runs on exactly the same helpers as the rivals, so the fixture
 * and the archetypes cannot quietly diverge.
 *
 * It is a balance instrument, not a designed opponent: if a competent operator
 * cannot make money with it, the economy is wrong.
 */
import type { CarrierId, GameState } from '../types.ts';
import type { Rng } from '../rng.ts';
import { getCarrier } from '../engine.ts';
import { CONSTANTS } from '../world.ts';
import {
  bestIncursion, bestNewSector, bestReinforcement, equip, expansionBar, marketIndex,
  maybeHedge, maybeInvestInTech, openSector, pruneLosers, releaseIdle, renewFleet,
  retreat, type AiConfig,
} from './common.ts';

const CFG: AiConfig = CONSTANTS.stubAi;

export function setup(state: GameState, carrierId: CarrierId, rng: Rng): GameState {
  let s = state;
  for (let i = 0; i < CONSTANTS.stubAi.openingSectors; i++) {
    const pick = bestNewSector(s, marketIndex(s), carrierId, CFG);
    if (!pick || pick.score < CFG.minProjectedNetPerQuarter) break;
    s = openSector(s, carrierId, pick, CFG);
  }
  // A little seeded variety so seeds do not all build the identical network.
  if (rng.chance(0.5)) {
    const extra = bestNewSector(s, marketIndex(s), carrierId, CFG);
    if (extra && extra.score > CFG.minProjectedNetPerQuarter) {
      s = openSector(s, carrierId, extra, CFG);
    }
  }
  return s;
}

export function decide(state: GameState, carrierId: CarrierId, _rng: Rng): GameState {
  let s = maybeHedge(state, carrierId);
  s = maybeInvestInTech(s, carrierId);
  s = renewFleet(s, carrierId, CFG);
  s = releaseIdle(s, carrierId);

  let index = marketIndex(s);
  // Cut a sector that has stopped paying before it drains the balance sheet.
  s = pruneLosers(s, index, carrierId, CFG);
  index = marketIndex(s);

  const cash = getCarrier(s, carrierId).cash;
  if (cash < CFG.reserveCash) return retreat(s, index, carrierId);
  if (cash < expansionBar(s, carrierId, CFG)) return s;

  // Same three moves a rival weighs: a virgin sector, more metal on one it
  // already flies, or contesting a market a rival has proven. The fixture has to
  // be able to fight back, or it is not a fair yardstick for a competent player.
  const fresh = bestNewSector(s, index, carrierId, CFG);
  const raid = bestIncursion(s, index, carrierId, CFG);
  const more = bestReinforcement(s, index, carrierId, CFG);

  const options: { value: number; act: () => GameState }[] = [];
  if (fresh) options.push({ value: fresh.score, act: () => openSector(s, carrierId, fresh, CFG) });
  if (raid) options.push({ value: raid.score, act: () => openSector(s, carrierId, raid, CFG) });
  if (more) options.push({ value: more.gain, act: () => equip(s, carrierId, more.typeId, more.route.id, CFG) });

  const pick = options.sort((a, b) => b.value - a.value)[0];
  if (!pick || pick.value < CFG.minProjectedNetPerQuarter) return s;
  return pick.act();
}
