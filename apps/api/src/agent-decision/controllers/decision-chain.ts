import { and, eq, inArray } from "drizzle-orm";
import type db from "../../database";
import {
  type AgentDecision,
  agentDecisionTable,
} from "../../database/schema-agent-layer";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/*
 * Supersede chains (agent-autoapply).
 *
 * `supersedesDecisionId` points from a replacement to the ADR it replaced and
 * never changes after insert, so the ADRs linked through it form a tree whose
 * root is the oldest ADR. That tree is "the chain". Soft delete keeps every
 * row in it; only live (non-deleted) rows count below.
 *
 * Invariant, per chain, kept by create, delete and restore:
 *   I1. at most one live ADR is `accepted`;
 *   I2. if any ADR of the chain is live, exactly one live ADR is `accepted`;
 *   I3. every live `superseded` ADR is an ancestor of that accepted one, so
 *       the live ADRs sit on the single path from the root to it.
 *
 * - Create with `supersedesDecisionId = A` requires A live and accepted: A
 *   becomes superseded and the new ADR is the accepted end of the path.
 * - Deleting a superseded ADR changes no other ADR: the accepted one stays.
 * - Deleting the accepted ADR D hands acceptance back to D's nearest live
 *   ancestor, walking past deleted ancestors. By I3 the remaining live ADRs
 *   are all ancestors of D, so that ancestor is the new end of the path. With
 *   no live ancestor the chain has no live ADR left.
 * - Restoring an ADR that was accepted when deleted (D):
 *     - no live accepted ADR in the chain: D is restored as accepted and no
 *       other ADR changes (by I2 nothing else in the chain is live);
 *     - the only live accepted ADR is D's nearest live ancestor A: A becomes
 *       superseded again and D is the accepted end of the path;
 *     - otherwise 409, nothing changes. The accepted ADR is elsewhere — a
 *       descendant of D, or a replacement created on another branch after D
 *       was deleted — and restoring D would make a second accepted ADR.
 * - Restoring an ADR that was superseded when deleted (S) changes no other
 *   ADR, and is a 409 unless a live accepted ADR is among S's descendants.
 *   Without one S would come back as a superseded ADR that nothing live
 *   replaces, breaking I3 (and I2 for a chain with no other live ADR). The
 *   person restores the replacement first, then S.
 *
 * Every write to a chain locks the root row first, so concurrent creates,
 * deletes and restores in one chain run one after another and each decides
 * from the state the previous one committed. One lock per chain, always the
 * root, so these writers cannot deadlock on each other.
 */

export type ChainNode = Pick<
  AgentDecision,
  "id" | "number" | "status" | "supersedesDecisionId" | "deletedAt"
>;

const nodeColumns = {
  id: agentDecisionTable.id,
  number: agentDecisionTable.number,
  status: agentDecisionTable.status,
  supersedesDecisionId: agentDecisionTable.supersedesDecisionId,
  deletedAt: agentDecisionTable.deletedAt,
};

/**
 * Locks the chain `decisionId` belongs to and returns the root id, or null
 * when the ADR is not in the project. The walk up needs no lock because the
 * parent column is immutable.
 */
export async function lockChainRoot(
  tx: Tx,
  projectId: string,
  decisionId: string,
) {
  let rootId: string | null = null;
  let current: string | null = decisionId;
  const seen = new Set<string>();
  while (current && !seen.has(current)) {
    seen.add(current);
    const [row] = await tx
      .select({
        id: agentDecisionTable.id,
        parent: agentDecisionTable.supersedesDecisionId,
      })
      .from(agentDecisionTable)
      .where(
        and(
          eq(agentDecisionTable.id, current),
          eq(agentDecisionTable.projectId, projectId),
        ),
      )
      .limit(1);
    if (!row) break;
    rootId = row.id;
    current = row.parent;
  }
  if (!rootId) return null;
  await tx
    .select({ id: agentDecisionTable.id })
    .from(agentDecisionTable)
    .where(eq(agentDecisionTable.id, rootId))
    .for("update");
  return rootId;
}

export class DecisionChain {
  private readonly children = new Map<string, ChainNode[]>();

  constructor(private readonly nodes: Map<string, ChainNode>) {
    for (const node of nodes.values()) {
      if (!node.supersedesDecisionId) continue;
      const list = this.children.get(node.supersedesDecisionId) ?? [];
      list.push(node);
      this.children.set(node.supersedesDecisionId, list);
    }
  }

  node(id: string) {
    return this.nodes.get(id) ?? null;
  }

  /** Live accepted ADRs of the whole chain; one or none while I1 holds. */
  liveAccepted() {
    return [...this.nodes.values()].filter(
      (node) => node.deletedAt === null && node.status === "accepted",
    );
  }

  /** The closest ancestor that is not deleted, skipping deleted ones. */
  nearestLiveAncestor(id: string) {
    let parentId = this.nodes.get(id)?.supersedesDecisionId ?? null;
    while (parentId) {
      const parent = this.nodes.get(parentId);
      if (!parent) return null;
      if (parent.deletedAt === null) return parent;
      parentId = parent.supersedesDecisionId;
    }
    return null;
  }

  /** Whether a live accepted ADR sits anywhere below `id`. */
  hasLiveAcceptedBelow(id: string) {
    const stack = [...(this.children.get(id) ?? [])];
    while (stack.length > 0) {
      const node = stack.pop() as ChainNode;
      if (node.deletedAt === null && node.status === "accepted") return true;
      stack.push(...(this.children.get(node.id) ?? []));
    }
    return false;
  }
}

/**
 * Locks the chain and reads every ADR in it after the lock, so the state the
 * caller decides from is the one the previous writer committed.
 */
export async function lockChain(tx: Tx, projectId: string, decisionId: string) {
  const rootId = await lockChainRoot(tx, projectId, decisionId);
  if (!rootId) return null;
  const nodes = new Map<string, ChainNode>();
  let frontier = [rootId];
  const [root] = await tx
    .select(nodeColumns)
    .from(agentDecisionTable)
    .where(eq(agentDecisionTable.id, rootId));
  if (!root) return null;
  nodes.set(root.id, root);
  while (frontier.length > 0) {
    const level = await tx
      .select(nodeColumns)
      .from(agentDecisionTable)
      .where(inArray(agentDecisionTable.supersedesDecisionId, frontier));
    frontier = [];
    for (const node of level) {
      if (nodes.has(node.id)) continue;
      nodes.set(node.id, node);
      frontier.push(node.id);
    }
  }
  return new DecisionChain(nodes);
}

export function adrLabel(node: Pick<ChainNode, "number">) {
  return `ADR-${String(node.number).padStart(3, "0")}`;
}
