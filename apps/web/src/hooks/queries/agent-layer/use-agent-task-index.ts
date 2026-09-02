import { useMemo } from "react";
import { flattenTree } from "@/components/agent-layer/tree-utils";
import { useAgentTree } from "./use-agent-tree";

/**
 * Entries and documents carry only `taskId`; the tree is the one call that
 * already has every task's number, so it doubles as the lookup index.
 */
export function useAgentTaskIndex(projectId: string) {
  const tree = useAgentTree(projectId);
  const flattened = useMemo(() => flattenTree(tree.data?.nodes), [tree.data]);
  return { ...flattened, tree };
}
