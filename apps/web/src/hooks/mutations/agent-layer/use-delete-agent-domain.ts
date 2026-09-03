import { useMutation, useQueryClient } from "@tanstack/react-query";
import deleteAgentDomain, {
  type DeleteAgentDomainRequest,
} from "@/fetchers/agent-layer/delete-agent-domain";
import { agentLayerKeys } from "@/hooks/queries/agent-layer/keys";
import { invalidateAgentDomain } from "./invalidate-agent-domain";

export function useDeleteAgentDomain() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (request: DeleteAgentDomainRequest) =>
      deleteAgentDomain(request),
    onSuccess: (_result, variables) => {
      queryClient.removeQueries({
        queryKey: agentLayerKeys.domain(
          variables.workspaceId,
          variables.domainId,
        ),
      });
      invalidateAgentDomain(queryClient, variables.workspaceId);
    },
  });
}
