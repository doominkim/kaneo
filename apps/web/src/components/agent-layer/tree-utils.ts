import type { AgentTreeNode } from "@/fetchers/agent-layer/get-agent-tree";

export type FlattenedTree = {
  byId: Map<string, AgentTreeNode>;
  taskNumberById: Map<string, number | null>;
  openCount: number;
  doneCount: number;
};

/** Walks the tree once so every tab can resolve task ids and count states. */
export function flattenTree(nodes: AgentTreeNode[] | undefined): FlattenedTree {
  const byId = new Map<string, AgentTreeNode>();
  const taskNumberById = new Map<string, number | null>();
  let openCount = 0;
  let doneCount = 0;

  const visit = (node: AgentTreeNode) => {
    byId.set(node.id, node);
    taskNumberById.set(node.id, node.number);
    if (node.done) doneCount += 1;
    else openCount += 1;
    for (const child of node.children) visit(child);
  };

  for (const node of nodes ?? []) visit(node);

  return { byId, taskNumberById, openCount, doneCount };
}
