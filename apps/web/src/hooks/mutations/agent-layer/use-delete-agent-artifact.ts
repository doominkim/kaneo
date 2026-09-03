import { useMutation, useQueryClient } from "@tanstack/react-query";
import deleteAgentArtifact from "@/fetchers/agent-layer/delete-agent-artifact";
import { agentLayerKeys } from "@/hooks/queries/agent-layer/keys";

export function useDeleteAgentArtifact() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      projectId,
      artifactId,
    }: {
      projectId: string;
      artifactId: string;
    }) => deleteAgentArtifact(projectId, artifactId),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({
        queryKey: agentLayerKeys.artifacts(variables.projectId),
      });
      queryClient.invalidateQueries({
        queryKey: agentLayerKeys.tree(variables.projectId),
      });
    },
  });
}
