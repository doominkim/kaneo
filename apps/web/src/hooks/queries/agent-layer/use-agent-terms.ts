import { useQuery } from "@tanstack/react-query";
import getAgentTerms, {
  type AgentTermConfidence,
  type AgentTermState,
} from "@/fetchers/agent-layer/get-agent-terms";
import { agentLayerKeys } from "./keys";

export function useAgentTerms(
  workspaceId: string,
  confidence?: AgentTermConfidence,
  state?: AgentTermState,
) {
  return useQuery({
    queryKey: agentLayerKeys.terms(workspaceId, confidence, state),
    queryFn: () => getAgentTerms({ workspaceId, confidence, state }),
    enabled: Boolean(workspaceId),
  });
}
