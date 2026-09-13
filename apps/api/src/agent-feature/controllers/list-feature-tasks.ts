import { collectTaskLinks } from "../../agent-task-link/controllers/collect-task-links";

/** Tasks derived from one feature, via its requirement keys or its design (REQ-FEATURE-HUB-6). */
async function listFeatureTasks(projectId: string, feature: string) {
  const links = await collectTaskLinks(projectId);
  return [...links.values()]
    .filter((task) => task.features.includes(feature))
    .sort((a, b) => (a.number ?? 0) - (b.number ?? 0))
    .map((task) => ({
      id: task.taskId,
      number: task.number,
      title: task.title,
      status: task.status,
      requirementKeys: task.requirementKeys.filter((key) =>
        key.startsWith(`REQ-${feature.toUpperCase()}-`),
      ),
      viaDesign: task.designFeatures.includes(feature),
      stale: task.stale,
    }));
}

export default listFeatureTasks;
