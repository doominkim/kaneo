import { useQuery } from "@tanstack/react-query";
import {
  getAgentFeatures,
  getAgentFeatureTasks,
} from "@/fetchers/agent-layer/agent-features";
import { agentLayerKeys } from "./keys";

export function useAgentFeatures(projectId: string) {
  return useQuery({
    queryKey: agentLayerKeys.features(projectId),
    queryFn: () => getAgentFeatures(projectId),
    enabled: Boolean(projectId),
  });
}

export function useAgentFeatureTasks(projectId: string, feature: string) {
  return useQuery({
    queryKey: agentLayerKeys.featureTasks(projectId, feature),
    queryFn: () => getAgentFeatureTasks(projectId, feature),
    enabled: Boolean(projectId && feature),
  });
}
