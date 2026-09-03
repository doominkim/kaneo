import { useQuery } from "@tanstack/react-query";
import getAgentDomains from "@/fetchers/agent-layer/get-agent-domains";
import { agentLayerKeys } from "./keys";

export function useAgentDomains(workspaceId: string) {
  return useQuery({
    queryKey: agentLayerKeys.domains(workspaceId),
    queryFn: () => getAgentDomains(workspaceId),
    enabled: Boolean(workspaceId),
  });
}
