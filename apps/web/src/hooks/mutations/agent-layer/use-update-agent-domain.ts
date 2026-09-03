import { useMutation, useQueryClient } from "@tanstack/react-query";
import updateAgentDomain, {
  type UpdateAgentDomainRequest,
} from "@/fetchers/agent-layer/update-agent-domain";
import { invalidateAgentDomain } from "./invalidate-agent-domain";

export function useUpdateAgentDomain() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (request: UpdateAgentDomainRequest) =>
      updateAgentDomain(request),
    onSuccess: (_domain, variables) =>
      invalidateAgentDomain(queryClient, variables.workspaceId),
  });
}
