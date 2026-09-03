import { useQuery } from "@tanstack/react-query";
import getAgentDomain from "@/fetchers/agent-layer/get-agent-domain";
import { agentLayerKeys } from "./keys";

export function useAgentDomain(workspaceId: string, domainId: string) {
  return useQuery({
    queryKey: agentLayerKeys.domain(workspaceId, domainId),
    queryFn: () => getAgentDomain(workspaceId, domainId),
    enabled: Boolean(workspaceId && domainId),
  });
}
