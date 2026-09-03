import { useQuery } from "@tanstack/react-query";
import getAgentArtifactUrl, {
  type ArtifactDisposition,
} from "@/fetchers/agent-layer/get-agent-artifact-url";
import { agentLayerKeys } from "./keys";

/**
 * Inline URL for the viewer. The presigned URL lives ~60s, so it is never
 * considered fresh and is dropped from the cache as soon as the viewer
 * unmounts; reopening always mints a new one.
 */
export function useAgentArtifactUrl(
  projectId: string,
  artifactId: string | undefined,
  disposition: ArtifactDisposition,
) {
  return useQuery({
    queryKey: agentLayerKeys.artifactUrl(
      projectId,
      artifactId ?? "",
      disposition,
    ),
    queryFn: () =>
      getAgentArtifactUrl(projectId, artifactId as string, disposition),
    enabled: Boolean(projectId && artifactId),
    staleTime: 0,
    gcTime: 0,
    refetchOnWindowFocus: false,
    retry: false,
  });
}
