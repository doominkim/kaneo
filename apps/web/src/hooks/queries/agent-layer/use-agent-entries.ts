import { useInfiniteQuery } from "@tanstack/react-query";
import getAgentEntries, {
  type AgentEntryKind,
} from "@/fetchers/agent-layer/get-agent-entries";
import { agentLayerKeys } from "./keys";

export const AGENT_ENTRIES_PAGE_SIZE = 20;

/**
 * The ledger is paged by an opaque `nextBefore` cursor rather than offsets, so
 * an infinite query is the natural fit: each page's cursor feeds the next.
 */
export function useAgentEntries(
  projectId: string,
  kind?: AgentEntryKind,
  taskId?: string,
  includeDeleted = false,
) {
  return useInfiniteQuery({
    queryKey: agentLayerKeys.entries(projectId, kind, taskId, includeDeleted),
    queryFn: ({ pageParam }) =>
      getAgentEntries({
        projectId,
        kind,
        taskId,
        includeDeleted,
        limit: AGENT_ENTRIES_PAGE_SIZE,
        before: pageParam ?? undefined,
      }),
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage.nextBefore,
    enabled: Boolean(projectId),
  });
}
