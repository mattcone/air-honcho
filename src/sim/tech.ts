/**
 * The technology program. Cash plus time buys a permanent change to operating
 * conditions — the same mechanism the event deck uses, with no expiry.
 *
 * Nodes and their effects are data; this file only knows how to look them up and
 * decide whether one may be started.
 */
import techData from '../data/tech.json' with { type: 'json' };
import type { Carrier, TechInProgress } from './types.ts';

export interface TechNode {
  readonly id: string;
  readonly name: string;
  readonly blurb: string;
  readonly cost: number;
  readonly quarters: number;
  readonly requires: string | null;
  readonly effects: Readonly<Record<string, number>>;
}

export const TECH_NODES: readonly TechNode[] = Object.freeze(
  techData.nodes as unknown as TechNode[],
);

const BY_ID = new Map(TECH_NODES.map((n) => [n.id, n]));

if (BY_ID.size !== TECH_NODES.length) throw new Error('tech.json: duplicate node ids');
for (const node of TECH_NODES) {
  if (node.requires && !BY_ID.has(node.requires)) {
    throw new Error(`tech.json: ${node.id} requires unknown node ${node.requires}`);
  }
}

export function getTechNode(id: string): TechNode {
  const found = BY_ID.get(id);
  if (!found) throw new Error(`Unknown tech node: ${id}`);
  return found;
}

export function hasTechNode(id: string): boolean {
  return BY_ID.has(id);
}

/** Nodes this carrier has delivered. */
export function delivered(carrier: Carrier): Set<string> {
  return new Set(carrier.tech);
}

/** Nodes this carrier has paid for and is still waiting on. */
export function inProgress(carrier: Carrier): Set<string> {
  return new Set(carrier.techInProgress.map((t) => t.nodeId));
}

export type TechStatus = 'delivered' | 'in-progress' | 'available' | 'locked';

export function techStatus(carrier: Carrier, node: TechNode): TechStatus {
  if (carrier.tech.includes(node.id)) return 'delivered';
  if (inProgress(carrier).has(node.id)) return 'in-progress';
  if (node.requires && !carrier.tech.includes(node.requires)) return 'locked';
  return 'available';
}

/**
 * Move anything due out of the pipeline and into the carrier's delivered set.
 * Returns new arrays; nothing is mutated in place.
 */
export function landDeliveries(
  carrier: Carrier,
  turn: number,
): { techInProgress: TechInProgress[]; tech: string[] } {
  const techInProgress: TechInProgress[] = [];
  const tech = [...carrier.tech];
  for (const item of carrier.techInProgress) {
    if (item.completesTurn > turn) techInProgress.push(item);
    else if (!tech.includes(item.nodeId)) tech.push(item.nodeId);
  }
  return { techInProgress, tech };
}
