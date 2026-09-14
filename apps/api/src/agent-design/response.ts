import { actorResponseSchema } from "../agent-entry/actor-response";
import { reviewFields, revisedAtField } from "../agent-requirement/response";
import { responseTimestamp, z } from "../openapi";

const staleCauseSchema = z.object({
  kind: z.enum(["requirement", "design"]),
  key: z.string(),
  changedAt: responseTimestamp,
});

export const staleSchema = z
  .object({ stale: z.boolean(), causes: z.array(staleCauseSchema) })
  .openapi("AgentStaleVerdict");

export const designSummarySchema = z
  .object({
    id: z.string(),
    feature: z.string(),
    title: z.string(),
    status: z.string(),
    approvedAt: responseTimestamp.nullable(),
    ...reviewFields,
    revisedAt: revisedAtField,
    sourceSlug: z.string().nullable(),
    updatedBy: z.string().nullable(),
    actorId: z.string().nullable(),
    createdAt: responseTimestamp,
    updatedAt: responseTimestamp,
    requirementCount: z.number(),
    stale: staleSchema,
  })
  .openapi("AgentDesignSummary");

export const designListSchema = z
  .object({ designs: z.array(designSummarySchema) })
  .openapi("AgentDesignList");

export const designSchema = designSummarySchema
  .omit({ requirementCount: true })
  .extend({
    workspaceId: z.string(),
    projectId: z.string(),
    body: z.string(),
    approvedBy: z.string().nullable(),
    reviewedBy: z.string().nullable(),
    actor: actorResponseSchema.nullable(),
    requirements: z.array(
      z.object({
        itemId: z.string(),
        key: z.string(),
        text: z.string(),
        status: z.string(),
        updatedAt: responseTimestamp,
        changedSinceRevision: z.boolean().openapi({
          description:
            "The requirement changed after the design's `revisedAt`; it is one of the stale causes.",
        }),
      }),
    ),
    tasks: z.array(
      z.object({
        id: z.string(),
        number: z.number().nullable(),
        title: z.string(),
        status: z.string().nullable(),
      }),
    ),
  })
  .openapi("AgentDesign");
