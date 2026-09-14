import { staleSchema } from "../agent-design/response";
import { responseTimestamp, z } from "../openapi";

const linkReviewFields = {
  acknowledgedByAgent: z.boolean().openapi({
    description: "The latest acknowledgement of this link came from an agent.",
  }),
  reviewed: z.boolean().openapi({
    description:
      "A person has acknowledged or reviewed the link since its latest acknowledgement. False for an agent's acknowledgement nobody has reviewed, and for a link never acknowledged.",
  }),
};

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
        ...linkReviewFields,
      }),
    ),
    designs: z.array(
      z.object({
        designId: z.string(),
        feature: z.string(),
        title: z.string(),
        status: z.string(),
        approvedAt: responseTimestamp.nullable(),
        revisedAt: responseTimestamp.openapi({
          description:
            "The design's content clock; a revision after the link's clock makes the task stale.",
        }),
        createdAt: responseTimestamp,
        acknowledgedAt: responseTimestamp.nullable(),
        ...linkReviewFields,
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
