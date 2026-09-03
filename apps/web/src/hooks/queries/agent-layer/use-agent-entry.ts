import { useQuery } from "@tanstack/react-query";
import getAgentEntry from "@/fetchers/agent-layer/get-agent-entry";
import { agentLayerKeys } from "./keys";

export function useAgentEntry(
  projectId: string,
  entryId: string | null,
  includeDeleted = false,
) {
  return useQuery({
    queryKey: agentLayerKeys.entry(projectId, entryId ?? "", includeDeleted),
    queryFn: () => getAgentEntry(projectId, entryId ?? "", includeDeleted),
    enabled: Boolean(projectId && entryId),
  });
}
