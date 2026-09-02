import { useQuery } from "@tanstack/react-query";
import getAgentDocuments from "@/fetchers/agent-layer/get-agent-documents";
import { agentLayerKeys } from "./keys";

export function useAgentDocuments(projectId: string) {
  return useQuery({
    queryKey: agentLayerKeys.documents(projectId),
    queryFn: () => getAgentDocuments(projectId),
    enabled: Boolean(projectId),
  });
}
