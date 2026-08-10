/**
 * An archetype's structural cost position, read straight from data.
 *
 * Separate from ai/archetype.ts on purpose: this is a property of the world that
 * the economics need, not decision logic, and archetype.ts imports the engine —
 * routing through it would close an import cycle and put core sim behind the AI.
 */
import archetypeData from '../data/archetypes.json' with { type: 'json' };

type ArchetypeCost = {
  id: string;
  costAdvantage?: number;
  fleetAffinity?: Record<string, number>;
};

const ADVANTAGE = new Map<string, number>(
  (archetypeData.archetypes as ArchetypeCost[]).map((a) => [a.id, a.costAdvantage ?? 1]),
);

const AFFINITY = new Map<string, Record<string, number>>(
  (archetypeData.archetypes as ArchetypeCost[])
    .filter((a) => a.fleetAffinity)
    .map((a) => [a.id, a.fleetAffinity!]),
);

/**
 * Multiplier on the cost lines a carrier controls. 1 for the player.
 *
 * `flownKlasses` conditions it on the metal actually on the sector, because a
 * cost position is not a property of a company in the abstract — it comes from
 * the fleet. A low-cost carrier's advantage IS its single dense narrowbody fleet;
 * put it on a widebody and the advantage does not travel, which is why no real
 * ULCC flies one. Averaged over the classes present, so a mixed sector reads
 * between the two.
 *
 * This is what gives the archetypes visibly different fleets. Left out, every
 * carrier appraised every aircraft with the same cost base and converged on the
 * same answer: measured, the low-cost carrier flew 96% widebodies.
 */
export function archetypeCostAdvantage(
  archetypeId: string | null,
  flownKlasses?: ReadonlySet<string>,
): number {
  if (archetypeId === null) return 1;
  const base = ADVANTAGE.get(archetypeId) ?? 1;
  const affinity = AFFINITY.get(archetypeId);
  if (!affinity || !flownKlasses || flownKlasses.size === 0) return base;
  let sum = 0;
  let n = 0;
  for (const klass of flownKlasses) {
    sum += affinity[klass] ?? 1;
    n += 1;
  }
  return n > 0 ? base * (sum / n) : base;
}
