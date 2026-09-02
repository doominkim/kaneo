import { useQuery } from "@tanstack/react-query";
import getAgentLeases from "@/fetchers/agent-layer/get-agent-leases";
import { agentLayerKeys } from "./keys";

// Leases expire on their own and there is no websocket event for them yet, so
// the "who is holding what" strip polls on a short interval instead.
const LEASE_REFRESH_MS = 30_000;

export function useAgentLeases(projectId: string) {
  return useQuery({
    queryKey: agentLayerKeys.leases(projectId),
    queryFn: () => getAgentLeases(projectId),
    enabled: Boolean(projectId),
    refetchInterval: LEASE_REFRESH_MS,
  });
}
