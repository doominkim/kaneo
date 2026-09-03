import { useMutation, useQueryClient } from "@tanstack/react-query";
import restoreAgentEntry from "@/fetchers/agent-layer/restore-agent-entry";
import { invalidateAgentEntry } from "./invalidate-agent-entry";

export function useRestoreAgentEntry() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      projectId,
      entryId,
    }: {
      projectId: string;
      entryId: string;
    }) => restoreAgentEntry(projectId, entryId),
    onSuccess: (_, variables) => invalidateAgentEntry(queryClient, variables),
  });
}
