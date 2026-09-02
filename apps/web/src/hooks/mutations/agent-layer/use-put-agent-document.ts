import { useMutation, useQueryClient } from "@tanstack/react-query";
import putAgentDocument, {
  type PutAgentDocumentRequest,
} from "@/fetchers/agent-layer/put-agent-document";
import { agentLayerKeys } from "@/hooks/queries/agent-layer/keys";

export function usePutAgentDocument() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (request: PutAgentDocumentRequest) => putAgentDocument(request),
    onSuccess: (document, variables) => {
      queryClient.setQueryData(
        agentLayerKeys.document(variables.projectId, variables.slug),
        document,
      );
      queryClient.invalidateQueries({
        queryKey: agentLayerKeys.documents(variables.projectId),
      });
      // Documents hang as leaves under their task in the overview tree.
      queryClient.invalidateQueries({
        queryKey: agentLayerKeys.tree(variables.projectId),
      });
    },
  });
}
