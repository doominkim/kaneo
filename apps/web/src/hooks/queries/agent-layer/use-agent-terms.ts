import { useQuery } from "@tanstack/react-query";
import getAgentTerms from "@/fetchers/agent-layer/get-agent-terms";
import { type AgentTermFilters, agentLayerKeys } from "./keys";

export function useAgentTerms(
  workspaceId: string,
  filters: AgentTermFilters = {},
) {
  const { confidence, state, domainId, deleted } = filters;
  return useQuery({
    queryKey: agentLayerKeys.terms(workspaceId, {
      confidence,
      state,
      domainId,
      deleted,
    }),
    queryFn: () =>
      getAgentTerms({ workspaceId, confidence, state, domainId, deleted }),
    enabled: Boolean(workspaceId),
  });
}
