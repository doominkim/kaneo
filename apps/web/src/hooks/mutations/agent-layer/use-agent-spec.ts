import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  type PutAgentDesignRequest,
  putAgentDesign,
} from "@/fetchers/agent-layer/agent-designs";
import {
  type PutAgentRequirementSetRequest,
  putAgentRequirementSet,
} from "@/fetchers/agent-layer/agent-requirements";
import {
  deleteAgentSpec,
  restoreAgentSpec,
  revertAgentSpec,
  reviewAgentSpec,
  type SpecTarget,
} from "@/fetchers/agent-layer/agent-spec-lifecycle";
import {
  acknowledgeAgentTaskLinks,
  type PutAgentTaskLinksRequest,
  putAgentTaskLinks,
  reviewAgentTaskLinks,
} from "@/fetchers/agent-layer/agent-task-links";
import { agentLayerKeys } from "@/hooks/queries/agent-layer/keys";

/**
 * Anything that moves a requirement clock can change a design's or a task's
 * stale verdict, so requirement writes invalidate all three families. A
 * delete or restore also hides or shows the document's task links.
 */
function useInvalidateSpec() {
  const queryClient = useQueryClient();
  return (projectId: string) => {
    for (const prefix of [
      "agent-requirements",
      "agent-designs",
      "agent-task-links",
      "agent-features",
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

export function usePutAgentDesign() {
  const invalidate = useInvalidateSpec();
  return useMutation({
    mutationFn: (request: PutAgentDesignRequest) => putAgentDesign(request),
    onSuccess: (_design, variables) => invalidate(variables.projectId),
  });
}

/** A review moves no clock and writes no entry: the document and the Feature list are all it changes. */
export function useReviewAgentSpec() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (target: SpecTarget) => reviewAgentSpec(target),
    onSuccess: (_result, { kind, projectId }) => {
      queryClient.invalidateQueries({
        queryKey: [
          kind === "requirement" ? "agent-requirements" : "agent-designs",
          projectId,
        ],
      });
      queryClient.invalidateQueries({
        queryKey: ["agent-features", projectId],
      });
    },
  });
}

export function useDeleteAgentSpec() {
  const invalidate = useInvalidateSpec();
  return useMutation({
    mutationFn: (target: SpecTarget) => deleteAgentSpec(target),
    onSuccess: (_result, variables) => invalidate(variables.projectId),
  });
}

export function useRestoreAgentSpec() {
  const invalidate = useInvalidateSpec();
  return useMutation({
    mutationFn: (target: SpecTarget) => restoreAgentSpec(target),
    onSuccess: (_result, variables) => invalidate(variables.projectId),
  });
}

/** A revert is a normal save: keys, item clocks and stale verdicts follow. */
export function useRevertAgentSpec() {
  const invalidate = useInvalidateSpec();
  return useMutation({
    mutationFn: (request: SpecTarget & { revisionId: string }) =>
      revertAgentSpec(request),
    onSuccess: (_result, variables) => invalidate(variables.projectId),
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

/** Stamps the review on the task's links only; no stale clock moves. */
export function useReviewAgentTaskLinks() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (request: { projectId: string; taskId: string }) =>
      reviewAgentTaskLinks(request),
    onSuccess: (_result, { projectId, taskId }) => {
      queryClient.invalidateQueries({
        queryKey: agentLayerKeys.taskLinks(projectId, taskId),
      });
    },
  });
}
