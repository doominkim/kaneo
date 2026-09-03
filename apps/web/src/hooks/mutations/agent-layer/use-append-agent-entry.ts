import { useMutation, useQueryClient } from "@tanstack/react-query";
import appendAgentEntry, {
  type HumanAgentEntryBody,
} from "@/fetchers/agent-layer/append-agent-entry";
import { agentLayerKeys } from "@/hooks/queries/agent-layer/keys";

export function useAppendAgentEntry() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (body: HumanAgentEntryBody) => appendAgentEntry(body),
    onSuccess: (_entry, variables) => {
      // Every entries key for the project starts with ["agent-entries", id]:
      // the per-task and per-kind pages, and the overview's latest/handoff
      // lookup. One prefix invalidation covers them all.
      queryClient.invalidateQueries({
        queryKey: ["agent-entries", variables.projectId],
      });
      // The tree lifts entry counts and branches onto each task node.
      queryClient.invalidateQueries({
        queryKey: agentLayerKeys.tree(variables.projectId),
      });
    },
  });
}
