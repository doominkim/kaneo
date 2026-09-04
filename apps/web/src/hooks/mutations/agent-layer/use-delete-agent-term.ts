import { useMutation, useQueryClient } from "@tanstack/react-query";
import deleteAgentTerm from "@/fetchers/agent-layer/delete-agent-term";

export function useDeleteAgentTerm() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      workspaceId,
      termId,
    }: {
      workspaceId: string;
      termId: string;
    }) => deleteAgentTerm(workspaceId, termId),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({
        queryKey: ["agent-terms", variables.workspaceId],
      });
      queryClient.invalidateQueries({
        queryKey: ["agent-term-resolve", variables.workspaceId],
      });
      // The counts the sidebar and the domain pages show include this term.
      queryClient.invalidateQueries({
        queryKey: ["agent-domain", variables.workspaceId],
      });
    },
  });
}
