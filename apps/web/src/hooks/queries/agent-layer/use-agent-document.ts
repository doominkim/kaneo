import { useQuery } from "@tanstack/react-query";
import { isAgentLayerStatus } from "@/fetchers/agent-layer/api-error";
import getAgentDocument from "@/fetchers/agent-layer/get-agent-document";
import { agentLayerKeys } from "./keys";

export function useAgentDocument(projectId: string, slug: string) {
  return useQuery({
    queryKey: agentLayerKeys.document(projectId, slug),
    queryFn: () => getAgentDocument(projectId, slug),
    enabled: Boolean(projectId && slug),
    // A missing slug is a real answer, not a transient failure.
    retry: (failureCount, error) =>
      !isAgentLayerStatus(error, 404) &&
      !isAgentLayerStatus(error, 403) &&
      failureCount < 2,
  });
}
