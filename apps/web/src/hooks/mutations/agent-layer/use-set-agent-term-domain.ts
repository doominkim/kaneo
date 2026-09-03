import { useMutation, useQueryClient } from "@tanstack/react-query";
import setAgentTermDomain, {
  type SetAgentTermDomainRequest,
} from "@/fetchers/agent-layer/set-agent-term-domain";

export function useSetAgentTermDomain() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (request: SetAgentTermDomainRequest) =>
      setAgentTermDomain(request),
    onSuccess: (_term, variables) => {
      queryClient.invalidateQueries({
        queryKey: ["agent-terms", variables.workspaceId],
      });
      // The page aggregates list the terms filed under each domain.
      queryClient.invalidateQueries({
        queryKey: ["agent-domain", variables.workspaceId],
      });
    },
  });
}
