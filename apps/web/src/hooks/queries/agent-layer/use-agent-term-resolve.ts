import { useQuery } from "@tanstack/react-query";
import resolveAgentTerm from "@/fetchers/agent-layer/resolve-agent-term";
import { agentLayerKeys } from "./keys";

/** Deterministic lookup; disabled until there is something to look up. */
export function useAgentTermResolve(workspaceId: string, term: string) {
  const trimmed = term.trim();
  return useQuery({
    queryKey: agentLayerKeys.termResolve(workspaceId, trimmed),
    queryFn: () => resolveAgentTerm(workspaceId, trimmed),
    enabled: Boolean(workspaceId) && trimmed.length > 0,
  });
}
