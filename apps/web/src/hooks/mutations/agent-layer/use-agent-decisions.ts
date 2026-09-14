import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  type AgentDecisionTarget,
  createAgentDecision,
  deleteAgentDecision,
  promoteAgentDecisionEntry,
  restoreAgentDecision,
  reviewAgentDecision,
} from "@/fetchers/agent-layer/agent-decisions";
import { agentLayerKeys } from "@/hooks/queries/agent-layer/keys";

function invalidate(
  queryClient: ReturnType<typeof useQueryClient>,
  projectId: string,
) {
  void queryClient.invalidateQueries({
    queryKey: ["agent-decisions", projectId],
  });
  void queryClient.invalidateQueries({
    queryKey: ["agent-decision", projectId],
  });
  void queryClient.invalidateQueries({
    queryKey: ["agent-entries", projectId],
  });
  void queryClient.invalidateQueries({
    queryKey: agentLayerKeys.tree(projectId),
  });
}
export function useCreateAgentDecision() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: createAgentDecision,
    onSuccess: (value) => invalidate(queryClient, value.projectId),
  });
}
/** Writes no timeline entry, so only the ADR reads are refreshed. */
export function useReviewAgentDecision() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (target: AgentDecisionTarget) => reviewAgentDecision(target),
    onSuccess: (_value, { projectId, decisionId }) => {
      void queryClient.invalidateQueries({
        queryKey: ["agent-decisions", projectId],
      });
      void queryClient.invalidateQueries({
        queryKey: agentLayerKeys.decision(projectId, decisionId),
      });
    },
  });
}
/** A delete can return the ADR it superseded to `accepted`, so every ADR read is refreshed. */
export function useDeleteAgentDecision() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (target: AgentDecisionTarget) => deleteAgentDecision(target),
    onSuccess: (_value, { projectId }) => invalidate(queryClient, projectId),
  });
}
export function useRestoreAgentDecision() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (target: AgentDecisionTarget) => restoreAgentDecision(target),
    onSuccess: (_value, { projectId }) => invalidate(queryClient, projectId),
  });
}
export function usePromoteAgentDecision() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      projectId,
      entryId,
    }: {
      projectId: string;
      entryId: string;
    }) => promoteAgentDecisionEntry(projectId, entryId),
    onSuccess: (value) => invalidate(queryClient, value.projectId),
  });
}
