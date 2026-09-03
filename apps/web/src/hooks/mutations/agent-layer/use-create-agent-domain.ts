import { useMutation, useQueryClient } from "@tanstack/react-query";
import createAgentDomain, {
  type CreateAgentDomainRequest,
} from "@/fetchers/agent-layer/create-agent-domain";
import { invalidateAgentDomain } from "./invalidate-agent-domain";

export function useCreateAgentDomain() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (request: CreateAgentDomainRequest) =>
      createAgentDomain(request),
    onSuccess: (_domain, variables) =>
      invalidateAgentDomain(queryClient, variables.workspaceId),
  });
}
