import { useQuery } from "@tanstack/react-query";
import {
  getAgentDesign,
  getAgentDesigns,
} from "@/fetchers/agent-layer/agent-designs";
import { agentLayerKeys } from "./keys";

export function useAgentDesigns(projectId: string) {
  return useQuery({
    queryKey: agentLayerKeys.designs(projectId),
    queryFn: () => getAgentDesigns(projectId),
    enabled: Boolean(projectId),
  });
}

export function useAgentDesign(projectId: string, feature: string) {
  return useQuery({
    queryKey: agentLayerKeys.design(projectId, feature),
    queryFn: () => getAgentDesign(projectId, feature),
    enabled: Boolean(projectId && feature),
  });
}
