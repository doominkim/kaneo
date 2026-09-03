import { useMutation, useQueryClient } from "@tanstack/react-query";
import { agentLayerKeys } from "@/hooks/queries/agent-layer/keys";
import {
  type UploadAgentArtifactInput,
  uploadAgentArtifact,
} from "@/lib/upload-agent-artifact";

export function useUploadAgentArtifact() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: UploadAgentArtifactInput) => uploadAgentArtifact(input),
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
