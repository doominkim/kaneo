import type { AgentFeatureSummary } from "@/fetchers/agent-layer/agent-features";
import type { AgentDomainList } from "@/fetchers/agent-layer/get-agent-domains";
import { useAgentDecisionCounts } from "./use-agent-decisions";
import { useAgentDomains } from "./use-agent-domains";
import { useAgentFeatures } from "./use-agent-features";

/** Live requirement documents and designs no person has reviewed since an agent saved them. */
export function countUnreviewedFeatureDocs(
  features: AgentFeatureSummary[] | undefined,
) {
  let count = 0;
  for (const feature of features ?? []) {
    for (const doc of [feature.requirements, feature.design]) {
      if (doc && !doc.reviewed && !doc.deletedAt) count += 1;
    }
  }
  return count;
}

/**
 * The workspace's unreviewed knowledge items. The domain listing counts what
 * is filed directly on each page plus the unfiled bucket, so the sum covers
 * every live item exactly once without reading the (capped) term list.
 */
export function countUnreviewedTerms(domains: AgentDomainList | undefined) {
  if (!domains) return 0;
  return domains.domains.reduce(
    (sum, node) => sum + node.unreviewedCount,
    domains.unfiled.unreviewedCount,
  );
}

/**
 * Badge numbers for the Feature and knowledge tabs (agent-autoapply). Every
 * source is a query another screen already reads, so the counts follow the
 * same invalidations as the lists they summarise.
 */
export function useAgentUnreviewedCounts(
  projectId: string,
  workspaceId: string,
) {
  const features = useAgentFeatures(projectId);
  const decisions = useAgentDecisionCounts(projectId);
  const domains = useAgentDomains(workspaceId);
  const terms = countUnreviewedTerms(domains.data);
  const adrs = decisions.data?.unreviewed ?? 0;
  return {
    feature: countUnreviewedFeatureDocs(features.data?.features),
    terms,
    decisions: adrs,
    knowledge: terms + adrs,
  };
}
