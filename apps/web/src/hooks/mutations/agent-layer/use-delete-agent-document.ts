import { useMutation, useQueryClient } from "@tanstack/react-query";
import deleteAgentDocument from "@/fetchers/agent-layer/delete-agent-document";
import { agentLayerKeys } from "@/hooks/queries/agent-layer/keys";

export function useDeleteAgentDocument() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ projectId, slug }: { projectId: string; slug: string }) =>
      deleteAgentDocument(projectId, slug),
    onSuccess: (_, variables) => {
      queryClient.removeQueries({
        queryKey: agentLayerKeys.document(variables.projectId, variables.slug),
      });
      queryClient.invalidateQueries({
        queryKey: agentLayerKeys.documents(variables.projectId),
      });
      queryClient.invalidateQueries({
        queryKey: agentLayerKeys.tree(variables.projectId),
      });
    },
  });
}
