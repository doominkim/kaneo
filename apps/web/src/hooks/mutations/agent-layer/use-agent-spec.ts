import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  approveAgentDesign,
  type PutAgentDesignRequest,
  putAgentDesign,
} from "@/fetchers/agent-layer/agent-designs";
import {
  approveAgentRequirementSet,
  type PutAgentRequirementSetRequest,
  putAgentRequirementSet,
} from "@/fetchers/agent-layer/agent-requirements";
import {
  acknowledgeAgentTaskLinks,
  type PutAgentTaskLinksRequest,
  putAgentTaskLinks,
} from "@/fetchers/agent-layer/agent-task-links";
import { agentLayerKeys } from "@/hooks/queries/agent-layer/keys";

/**
 * Anything that moves a requirement clock can change a design's or a task's
 * stale verdict, so requirement writes invalidate all three families.
 */
function useInvalidateSpec() {
  const queryClient = useQueryClient();
  return (projectId: string) => {
    for (const prefix of [
      "agent-requirements",
      "agent-designs",
      "agent-task-links",
    ]) {
      queryClient.invalidateQueries({ queryKey: [prefix, projectId] });
    }
    queryClient.invalidateQueries({
      queryKey: agentLayerKeys.entries(projectId),
    });
  };
}

export function usePutAgentRequirementSet() {
  const invalidate = useInvalidateSpec();
  return useMutation({
    mutationFn: (request: PutAgentRequirementSetRequest) =>
      putAgentRequirementSet(request),
    onSuccess: (_set, variables) => invalidate(variables.projectId),
  });
}

export function useApproveAgentRequirementSet() {
  const invalidate = useInvalidateSpec();
  return useMutation({
    mutationFn: (request: { projectId: string; feature: string }) =>
      approveAgentRequirementSet(request),
    onSuccess: (_row, variables) => invalidate(variables.projectId),
  });
}

export function usePutAgentDesign() {
  const invalidate = useInvalidateSpec();
  return useMutation({
    mutationFn: (request: PutAgentDesignRequest) => putAgentDesign(request),
    onSuccess: (_design, variables) => invalidate(variables.projectId),
  });
}

export function useApproveAgentDesign() {
  const invalidate = useInvalidateSpec();
  return useMutation({
    mutationFn: (request: { projectId: string; feature: string }) =>
      approveAgentDesign(request),
    onSuccess: (_row, variables) => invalidate(variables.projectId),
  });
}

export function usePutAgentTaskLinks() {
  const invalidate = useInvalidateSpec();
  return useMutation({
    mutationFn: (request: PutAgentTaskLinksRequest) =>
      putAgentTaskLinks(request),
    onSuccess: (_links, variables) => invalidate(variables.projectId),
  });
}

export function useAcknowledgeAgentTaskLinks() {
  const invalidate = useInvalidateSpec();
  return useMutation({
    mutationFn: (request: { projectId: string; taskId: string }) =>
      acknowledgeAgentTaskLinks(request),
    onSuccess: (_result, variables) => invalidate(variables.projectId),
  });
}
