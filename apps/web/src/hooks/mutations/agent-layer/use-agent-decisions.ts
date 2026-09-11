import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  acceptAgentDecision,
  createAgentDecision,
  promoteAgentDecisionEntry,
  updateAgentDecision,
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
export function useUpdateAgentDecision() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: updateAgentDecision,
    onSuccess: (value) => invalidate(queryClient, value.projectId),
  });
}
export function useAcceptAgentDecision() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: acceptAgentDecision,
    onSuccess: (value) => invalidate(queryClient, value.projectId),
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
