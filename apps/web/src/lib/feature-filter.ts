import type { AgentTaskLinkBadge } from "@/fetchers/agent-layer/agent-task-links";

/** `REQ-SPEC-TABS-3` → `spec-tabs`; the key prefix is the feature slug upper-cased. */
export function featureOfKey(key: string): string {
  return key.replace(/^REQ-/, "").replace(/-\d+$/, "").toLowerCase();
}

/** Every feature a task derives from, via requirement keys or design (REQ-FEATURE-HUB-11). */
export function featuresOfBadge(
  badge: AgentTaskLinkBadge,
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const key of badge.requirementKeys) {
    const feature = featureOfKey(key);
    counts.set(feature, (counts.get(feature) ?? 0) + 1);
  }
  for (const feature of badge.designFeatures) {
    if (!counts.has(feature)) counts.set(feature, 0);
  }
  return counts;
}

/** Keeps only the tasks linked to `feature` (REQ-FEATURE-HUB-12); null feature = everything. */
export function filterTasksByFeature<T extends { id: string }>(
  tasks: T[],
  badges: Map<string, AgentTaskLinkBadge> | undefined,
  feature: string | null,
): T[] {
  if (!feature) return tasks;
  return tasks.filter((task) => {
    const badge = badges?.get(task.id);
    return badge ? featuresOfBadge(badge).has(feature) : false;
  });
}
