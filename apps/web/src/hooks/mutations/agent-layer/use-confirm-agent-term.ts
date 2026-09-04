import { useMutation, useQueryClient } from "@tanstack/react-query";
import confirmAgentTerm, {
  type ConfirmAgentTermRequest,
} from "@/fetchers/agent-layer/confirm-agent-term";

export function useConfirmAgentTerm() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (request: ConfirmAgentTermRequest) => confirmAgentTerm(request),
    onSuccess: (_term, variables) => {
      queryClient.invalidateQueries({
        queryKey: ["agent-terms", variables.workspaceId],
      });
      queryClient.invalidateQueries({
        queryKey: ["agent-term-resolve", variables.workspaceId],
      });
      // A review empties one slot of the sidebar's pending count and of the
      // page aggregates, both of which hang off the domain listing.
      queryClient.invalidateQueries({
        queryKey: ["agent-domain", variables.workspaceId],
      });
    },
  });
}
