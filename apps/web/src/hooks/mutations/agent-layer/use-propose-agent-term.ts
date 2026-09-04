import { useMutation, useQueryClient } from "@tanstack/react-query";
import proposeAgentTerm, {
  type ProposeAgentTermBody,
} from "@/fetchers/agent-layer/propose-agent-term";

export function useProposeAgentTerm() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (body: ProposeAgentTermBody) => proposeAgentTerm(body),
    onSuccess: (_term, variables) => {
      // Every filter combination and every resolve answer may now differ.
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
