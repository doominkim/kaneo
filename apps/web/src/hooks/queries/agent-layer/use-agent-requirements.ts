import { useQuery } from "@tanstack/react-query";
import {
  getAgentRequirementSet,
  getAgentRequirementSets,
} from "@/fetchers/agent-layer/agent-requirements";
import { agentLayerKeys } from "./keys";

export function useAgentRequirementSets(projectId: string) {
  return useQuery({
    queryKey: agentLayerKeys.requirementSets(projectId),
    queryFn: () => getAgentRequirementSets(projectId),
    enabled: Boolean(projectId),
  });
}

export function useAgentRequirementSet(projectId: string, feature: string) {
  return useQuery({
    queryKey: agentLayerKeys.requirementSet(projectId, feature),
    queryFn: () => getAgentRequirementSet(projectId, feature),
    enabled: Boolean(projectId && feature),
  });
}
