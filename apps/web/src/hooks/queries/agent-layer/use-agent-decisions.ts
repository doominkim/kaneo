import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import {
  type AgentDecisionStatusFilter,
  getAgentDecision,
  listAgentDecisions,
} from "@/fetchers/agent-layer/agent-decisions";
import { agentLayerKeys } from "./keys";
export function useAgentDecisions(input: {
  projectId: string;
  status: AgentDecisionStatusFilter;
  q?: string;
  taskId?: string;
}) {
  return useInfiniteQuery({
    queryKey: agentLayerKeys.decisions(
      input.projectId,
      input.status,
      input.q,
      input.taskId,
    ),
    queryFn: ({ pageParam }) =>
      listAgentDecisions({ ...input, before: pageParam ?? undefined }),
    initialPageParam: null as string | null,
    getNextPageParam: (page) => page.nextBefore,
    enabled: Boolean(input.projectId),
  });
}
export function useAgentDecision(projectId: string, decisionId?: string) {
  return useQuery({
    queryKey: agentLayerKeys.decision(projectId, decisionId ?? ""),
    queryFn: () => getAgentDecision(projectId, decisionId ?? ""),
    enabled: Boolean(projectId && decisionId),
  });
}

/**
 * The project-wide totals the list response carries whatever its filters; one
 * row is fetched because only the totals are read (tab badges).
 */
export function useAgentDecisionCounts(projectId: string) {
  return useQuery({
    queryKey: agentLayerKeys.decisionCounts(projectId),
    queryFn: () =>
      listAgentDecisions({ projectId, status: "current", limit: 1 }),
    enabled: Boolean(projectId),
    select: (data) => ({
      unreviewed: data.unreviewedTotal,
      accepted: data.acceptedTotal,
    }),
  });
}
