import { useMutation, useQueryClient } from "@tanstack/react-query";
import restoreAgentTerm from "@/fetchers/agent-layer/restore-agent-term";

export function useRestoreAgentTerm() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      workspaceId,
      termId,
    }: {
      workspaceId: string;
      termId: string;
    }) => restoreAgentTerm(workspaceId, termId),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({
        queryKey: ["agent-terms", variables.workspaceId],
      });
      queryClient.invalidateQueries({
        queryKey: ["agent-term-resolve", variables.workspaceId],
      });
      // A restored item counts again in the sidebar and the page aggregates.
      queryClient.invalidateQueries({
        queryKey: ["agent-domain", variables.workspaceId],
      });
    },
  });
}
