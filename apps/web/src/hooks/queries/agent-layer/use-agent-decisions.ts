import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import {
  getAgentDecision,
  listAgentDecisions,
} from "@/fetchers/agent-layer/agent-decisions";
import { agentLayerKeys } from "./keys";
export function useAgentDecisions(input: {
  projectId: string;
  status: "current" | "all" | "draft" | "accepted" | "superseded";
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
