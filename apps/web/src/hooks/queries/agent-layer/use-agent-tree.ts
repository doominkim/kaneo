import { useQuery } from "@tanstack/react-query";
import getAgentTree from "@/fetchers/agent-layer/get-agent-tree";
import { agentLayerKeys } from "./keys";

export function useAgentTree(projectId: string) {
  return useQuery({
    queryKey: agentLayerKeys.tree(projectId),
    queryFn: () => getAgentTree(projectId),
    enabled: Boolean(projectId),
  });
}
