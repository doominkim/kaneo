import { staleSchema } from "../agent-design/response";
import { responseTimestamp, z } from "../openapi";

export const taskLinksSchema = z
  .object({
    taskId: z.string(),
    requirements: z.array(
      z.object({
        itemId: z.string(),
        key: z.string(),
        feature: z.string(),
        text: z.string(),
        status: z.string(),
        updatedAt: responseTimestamp,
        createdAt: responseTimestamp,
        acknowledgedAt: responseTimestamp.nullable(),
      }),
    ),
    designs: z.array(
      z.object({
        designId: z.string(),
        feature: z.string(),
        title: z.string(),
        status: z.string(),
        approvedAt: responseTimestamp.nullable(),
        createdAt: responseTimestamp,
        acknowledgedAt: responseTimestamp.nullable(),
      }),
    ),
    stale: staleSchema,
  })
  .openapi("AgentTaskLinks");

export const taskLinkBadgeSchema = z
  .object({
    taskId: z.string(),
    requirementKeys: z.array(z.string()),
    designFeatures: z.array(z.string()),
    stale: z.boolean(),
  })
  .openapi("AgentTaskLinkBadge");

export const taskLinkBadgeListSchema = z
  .object({ tasks: z.array(taskLinkBadgeSchema) })
  .openapi("AgentTaskLinkBadgeList");
