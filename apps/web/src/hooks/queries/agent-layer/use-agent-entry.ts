import { useQuery } from "@tanstack/react-query";
import getAgentEntry from "@/fetchers/agent-layer/get-agent-entry";
import { agentLayerKeys } from "./keys";

export function useAgentEntry(projectId: string, entryId: string | null) {
  return useQuery({
    queryKey: agentLayerKeys.entry(projectId, entryId ?? ""),
    queryFn: () => getAgentEntry(projectId, entryId ?? ""),
    enabled: Boolean(projectId && entryId),
  });
}
