import { useMutation, useQueryClient } from "@tanstack/react-query";
import moveAgentDomain, {
  type MoveAgentDomainRequest,
} from "@/fetchers/agent-layer/move-agent-domain";
import { invalidateAgentDomain } from "./invalidate-agent-domain";

export function useMoveAgentDomain() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (request: MoveAgentDomainRequest) => moveAgentDomain(request),
    onSuccess: (_domain, variables) =>
      invalidateAgentDomain(queryClient, variables.workspaceId),
  });
}
