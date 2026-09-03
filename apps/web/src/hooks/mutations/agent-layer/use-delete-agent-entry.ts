import { useMutation, useQueryClient } from "@tanstack/react-query";
import deleteAgentEntry from "@/fetchers/agent-layer/delete-agent-entry";
import { invalidateAgentEntry } from "./invalidate-agent-entry";

export function useDeleteAgentEntry() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      projectId,
      entryId,
    }: {
      projectId: string;
      entryId: string;
    }) => deleteAgentEntry(projectId, entryId),
    onSuccess: (_, variables) => invalidateAgentEntry(queryClient, variables),
  });
}
