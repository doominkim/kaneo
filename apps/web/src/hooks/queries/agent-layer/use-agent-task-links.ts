import { useQuery } from "@tanstack/react-query";
import {
  getAgentTaskLinkBadges,
  getAgentTaskLinks,
} from "@/fetchers/agent-layer/agent-task-links";
import { agentLayerKeys } from "./keys";

/** One query per project for the board: every card reads its badge from this map. */
export function useAgentTaskLinkBadges(projectId: string) {
  return useQuery({
    queryKey: agentLayerKeys.taskLinkBadges(projectId),
    queryFn: () => getAgentTaskLinkBadges(projectId),
    enabled: Boolean(projectId),
    select: (data) => new Map(data.tasks.map((task) => [task.taskId, task])),
  });
}

export function useAgentTaskLinks(projectId: string, taskId: string) {
  return useQuery({
    queryKey: agentLayerKeys.taskLinks(projectId, taskId),
    queryFn: () => getAgentTaskLinks(projectId, taskId),
    enabled: Boolean(projectId && taskId),
  });
}
