import type { QueryClient } from "@tanstack/react-query";
import { agentLayerKeys } from "@/hooks/queries/agent-layer/keys";

/**
 * Delete and restore move one row between the default and the "with deleted"
 * views, so every listing of the project (all kind/task filters, both views,
 * and the latest-entry lookup, which shares the prefix), the entry itself in
 * both views, and the tree rollups that count entries must refetch.
 */
export function invalidateAgentEntry(
  queryClient: QueryClient,
  { projectId, entryId }: { projectId: string; entryId: string },
) {
  queryClient.invalidateQueries({ queryKey: ["agent-entries", projectId] });
  queryClient.invalidateQueries({
    queryKey: ["agent-entry", projectId, entryId],
  });
  queryClient.invalidateQueries({
    queryKey: agentLayerKeys.tree(projectId),
  });
}
