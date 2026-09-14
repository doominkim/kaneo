import { useMutation, useQueryClient } from "@tanstack/react-query";
import reviewAgentTerm, {
  type ReviewAgentTermRequest,
} from "@/fetchers/agent-layer/review-agent-term";

export function useReviewAgentTerm() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (request: ReviewAgentTermRequest) => reviewAgentTerm(request),
    onSuccess: (_term, variables) => {
      queryClient.invalidateQueries({
        queryKey: ["agent-terms", variables.workspaceId],
      });
      queryClient.invalidateQueries({
        queryKey: ["agent-term-resolve", variables.workspaceId],
      });
      // The sidebar's unreviewed counts hang off the domain listing.
      queryClient.invalidateQueries({
        queryKey: ["agent-domain", variables.workspaceId],
      });
    },
  });
}
