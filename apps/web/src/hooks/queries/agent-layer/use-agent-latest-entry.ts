import { useQuery } from "@tanstack/react-query";
import getAgentEntries from "@/fetchers/agent-layer/get-agent-entries";
import getAgentEntry, {
  type AgentEntryDetail,
} from "@/fetchers/agent-layer/get-agent-entry";
import { agentLayerKeys } from "./keys";

export type LatestAgentEntry = {
  entry: AgentEntryDetail;
  /** True when no handoff exists and the newest entry of any kind is shown. */
  isFallback: boolean;
} | null;

/**
 * The overview callout wants the newest handoff, falling back to the newest
 * entry of any kind (DESIGN.md §6). The listing omits `body`, so the chosen
 * summary is followed by one detail fetch.
 */
export function useAgentLatestEntry(projectId: string) {
  return useQuery({
    queryKey: agentLayerKeys.latestEntry(projectId),
    queryFn: async (): Promise<LatestAgentEntry> => {
      const handoffs = await getAgentEntries({
        projectId,
        kind: "handoff",
        limit: 1,
      });
      let summary = handoffs.entries[0];
      let isFallback = false;

      if (!summary) {
        const latest = await getAgentEntries({ projectId, limit: 1 });
        summary = latest.entries[0];
        isFallback = true;
      }

      if (!summary) return null;

      const entry = await getAgentEntry(projectId, summary.id);
      return { entry, isFallback };
    },
    enabled: Boolean(projectId),
  });
}
