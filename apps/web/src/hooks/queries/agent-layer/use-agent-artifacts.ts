import { useQuery } from "@tanstack/react-query";
import getAgentArtifacts from "@/fetchers/agent-layer/get-agent-artifacts";
import { agentLayerKeys } from "./keys";

export function useAgentArtifacts(projectId: string) {
  return useQuery({
    queryKey: agentLayerKeys.artifacts(projectId),
    queryFn: () => getAgentArtifacts(projectId),
    enabled: Boolean(projectId),
  });
}
