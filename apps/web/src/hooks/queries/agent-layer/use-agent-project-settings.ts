import { useQuery } from "@tanstack/react-query";
import getAgentProjectSettings from "@/fetchers/agent-layer/get-agent-project-settings";
import { agentLayerKeys } from "./keys";

export function useAgentProjectSettings(projectId: string) {
  return useQuery({
    queryKey: agentLayerKeys.settings(projectId),
    queryFn: () => getAgentProjectSettings(projectId),
    enabled: Boolean(projectId),
  });
}
