import { useQuery } from "@tanstack/react-query";
import {
  getAgentSpecRevision,
  getAgentSpecRevisions,
  type SpecTarget,
} from "@/fetchers/agent-layer/agent-spec-lifecycle";
import { agentLayerKeys } from "./keys";

/** Newest first; titles, authors and times only. Fetched when the history opens. */
export function useAgentSpecRevisions(target: SpecTarget, enabled = true) {
  const { kind, projectId, feature } = target;
  return useQuery({
    queryKey: agentLayerKeys.specRevisions(kind, projectId, feature),
    queryFn: () => getAgentSpecRevisions({ kind, projectId, feature }),
    enabled: enabled && Boolean(projectId && feature),
  });
}

/** One revision's stored body, for the preview. */
export function useAgentSpecRevision(
  target: SpecTarget,
  revisionId: string | null,
) {
  const { kind, projectId, feature } = target;
  return useQuery({
    queryKey: agentLayerKeys.specRevision(
      kind,
      projectId,
      feature,
      revisionId ?? "",
    ),
    queryFn: () =>
      getAgentSpecRevision({
        kind,
        projectId,
        feature,
        revisionId: revisionId ?? "",
      }),
    enabled: Boolean(projectId && feature && revisionId),
  });
}
