import { useMutation, useQueryClient } from "@tanstack/react-query";
import putAgentProjectSettings, {
  type PutAgentProjectSettingsRequest,
} from "@/fetchers/agent-layer/put-agent-project-settings";
import { agentLayerKeys } from "@/hooks/queries/agent-layer/keys";

export function usePutAgentProjectSettings() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (request: PutAgentProjectSettingsRequest) =>
      putAgentProjectSettings(request),
    onSuccess: (settings, variables) => {
      queryClient.setQueryData(
        agentLayerKeys.settings(variables.projectId),
        settings,
      );
      // The tree carries the threshold verdict the overview banner reads.
      queryClient.invalidateQueries({
        queryKey: agentLayerKeys.tree(variables.projectId),
      });
    },
  });
}
