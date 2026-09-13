import { collectTaskLinks } from "./collect-task-links";

/** Per-task badge data for the board (REQ-SPEC-TABS-13): keys, features, stale. */
async function listTaskLinkBadges(projectId: string) {
  const links = await collectTaskLinks(projectId);
  return [...links.values()].map((task) => ({
    taskId: task.taskId,
    requirementKeys: task.requirementKeys,
    designFeatures: task.designFeatures,
    stale: task.stale.stale,
  }));
}

export default listTaskLinkBadges;
