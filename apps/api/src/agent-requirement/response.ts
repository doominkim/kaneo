import { actorResponseSchema } from "../agent-entry/actor-response";
import { responseTimestamp, z } from "../openapi";

const nullableTimestamp = responseTimestamp.nullable();

/**
 * Review marker (agent-autoapply). Saves apply immediately, so `reviewed` is
 * the only thing that distinguishes an agent's unread write from content a
 * person has seen. Shared with designs.
 */
export const reviewFields = {
  reviewed: z.boolean().openapi({
    description:
      "False while the latest save came from an agent and no person has reviewed it since. A person's save, or the review endpoint, sets it.",
  }),
  reviewedAt: nullableTimestamp,
};

export const revisedAtField = responseTimestamp.openapi({
  description:
    "When the content last changed, i.e. when the newest revision was taken. An identical re-save leaves it alone.",
});

export const requirementSetSummarySchema = z
  .object({
    id: z.string(),
    feature: z.string(),
    title: z.string(),
    status: z
      .string()
      .openapi({ description: "`approved`: every save applies at once." }),
    approvedAt: nullableTimestamp,
    sourceSlug: z.string().nullable(),
    createdAt: responseTimestamp,
    updatedAt: responseTimestamp,
    ...reviewFields,
    revisedAt: revisedAtField,
    itemCount: z.number(),
    activeCount: z.number(),
  })
  .openapi("AgentRequirementSetSummary");

export const requirementSetListSchema = z
  .object({ sets: z.array(requirementSetSummarySchema) })
  .openapi("AgentRequirementSetList");

export const requirementCoverageSchema = z.object({
  repo: z.string(),
  testPath: z.string(),
  testName: z.string().nullable(),
  reportedAt: responseTimestamp,
});

export const requirementItemSchema = z
  .object({
    id: z.string(),
    setId: z.string(),
    projectId: z.string(),
    key: z.string(),
    seq: z.number(),
    text: z.string(),
    layer: z.string().nullable(),
    status: z
      .string()
      .openapi({ description: "`active`, `deferred` or `dropped`." }),
    story: z.string().nullable().openapi({
      description: "The `##` story heading the criterion sits under, or null.",
    }),
    createdAt: responseTimestamp,
    updatedAt: responseTimestamp.openapi({
      description:
        "Moves only when `text` or `status` changes. Downstream stale checks compare against this.",
    }),
    coverage: z.array(requirementCoverageSchema),
    designs: z.array(
      z.object({
        id: z.string(),
        feature: z.string(),
        title: z.string(),
        status: z.string(),
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
  .openapi("AgentRequirementItem");

export const requirementSetSchema = z
  .object({
    id: z.string(),
    workspaceId: z.string(),
    projectId: z.string(),
    feature: z.string(),
    title: z.string(),
    body: z.string(),
    status: z.string(),
    approvedAt: nullableTimestamp,
    approvedBy: z.string().nullable(),
    ...reviewFields,
    reviewedBy: z.string().nullable(),
    revisedAt: revisedAtField,
    nextSeq: z.number(),
    sourceSlug: z.string().nullable(),
    updatedBy: z.string().nullable(),
    actorId: z.string().nullable(),
    actor: actorResponseSchema.nullable(),
    createdAt: responseTimestamp,
    updatedAt: responseTimestamp,
    items: z.array(requirementItemSchema),
  })
  .openapi("AgentRequirementSet");

export const coverageResultSchema = z
  .object({ feature: z.string(), repo: z.string(), reported: z.number() })
  .openapi("AgentRequirementCoverageResult");

/* Shared by requirement sets and designs (agent-autoapply). */

export const specReviewResultSchema = z
  .object({
    id: z.string(),
    feature: z.string(),
    reviewedAt: responseTimestamp,
    reviewedBy: z.string(),
  })
  .openapi("AgentSpecReviewResult");

export const specDeleteResultSchema = z
  .object({
    id: z.string(),
    feature: z.string(),
    deletedAt: responseTimestamp,
    deletedBy: z.string(),
  })
  .openapi("AgentSpecDeleteResult");

export const specRevisionSummarySchema = z
  .object({
    id: z.string(),
    title: z.string(),
    createdAt: responseTimestamp,
    revertedFromId: z.string().nullable().openapi({
      description:
        "The revision this one was restored from, when it was written by a revert.",
    }),
    createdBy: z.string().nullable(),
    author: z
      .object({ userId: z.string(), name: z.string() })
      .nullable()
      .openapi({ description: "The person who saved it; null for an agent." }),
    actor: actorResponseSchema.nullable().openapi({
      description: "The agent that saved it; null for a person.",
    }),
  })
  .openapi("AgentSpecRevisionSummary");

export const specRevisionListSchema = z
  .object({ revisions: z.array(specRevisionSummarySchema) })
  .openapi("AgentSpecRevisionList");

export const specRevisionSchema = specRevisionSummarySchema
  .extend({
    body: z.string(),
    requirementKeys: z.array(z.string()).nullable().openapi({
      description:
        "Design revisions only: the requirement keys the design covered at that moment, in item order.",
    }),
  })
  .openapi("AgentSpecRevision");
