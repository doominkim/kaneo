import { actorResponseSchema } from "../agent-entry/actor-response";
import { refsBody } from "../agent-entry/schema";
import { nullableResponseTimestamp, responseTimestamp, z } from "../openapi";
import { decisionStatus } from "./schema";

export const decisionTaskSchema = z
  .object({
    id: z.string(),
    number: z.number().int().nullable(),
    title: z.string(),
  })
  .openapi("AgentDecisionTask");

export const decisionRefSchema = z
  .object({
    id: z.string(),
    number: z.number().int(),
    title: z.string(),
    status: decisionStatus,
  })
  .openapi("AgentDecisionRef");

const attributionFields = {
  createdBy: z.string().nullable(),
  createdAuthor: z.object({ userId: z.string(), name: z.string() }).nullable(),
  createdActor: actorResponseSchema.nullable(),
  updatedBy: z.string().nullable(),
  updatedAuthor: z.object({ userId: z.string(), name: z.string() }).nullable(),
  updatedActor: actorResponseSchema.nullable(),
  acceptedBy: z.string().nullable(),
  acceptor: z.object({ userId: z.string(), name: z.string() }).nullable(),
  reviewedBy: z.string().nullable(),
  deletedBy: z.string().nullable(),
};

export const decisionSummarySchema = z
  .object({
    id: z.string(),
    number: z.number().int(),
    title: z.string(),
    status: decisionStatus,
    contextPreview: z.string(),
    reversible: z.boolean().nullable(),
    sourceEntryId: z.string().nullable(),
    supersedesDecisionId: z.string().nullable(),
    refs: refsBody.nullable(),
    tasks: z.array(decisionTaskSchema),
    ...attributionFields,
    reviewed: z.boolean().openapi({
      description:
        "False while an agent-written ADR has not been reviewed by a person. An ADR a person creates is reviewed from the start.",
    }),
    reviewedAt: nullableResponseTimestamp,
    acceptedAt: nullableResponseTimestamp,
    deletedAt: nullableResponseTimestamp,
    createdAt: responseTimestamp,
    updatedAt: responseTimestamp,
  })
  .openapi("AgentDecisionSummary");

export const decisionListSchema = z
  .object({
    decisions: z.array(decisionSummarySchema),
    nextBefore: z.string().nullable(),
    unreviewedTotal: z.number().int().openapi({
      description:
        "Unreviewed, non-deleted ADRs in the whole project, independent of the filters and the page.",
    }),
    acceptedTotal: z.number().int().openapi({
      description:
        "Accepted, non-deleted ADRs in the whole project, independent of the filters and the page.",
    }),
  })
  .openapi("AgentDecisionList");

export const decisionDetailSchema = decisionSummarySchema
  .omit({ contextPreview: true })
  .extend({
    workspaceId: z.string(),
    projectId: z.string(),
    context: z.string(),
    decision: z.string(),
    alternatives: z.string().nullable(),
    consequences: z.string().nullable(),
    sourceNote: z.string().nullable(),
    supersedes: decisionRefSchema.nullable(),
    supersededBy: decisionRefSchema.nullable(),
  })
  .openapi("AgentDecisionDetail");

export const decisionDeleteResultSchema = z
  .object({
    id: z.string(),
    deletedAt: responseTimestamp,
    deletedBy: z.string(),
    restoredDecisionId: z.string().nullable().openapi({
      description:
        "The ADR this one had superseded, when the delete returned it to `accepted`. Null when there was none or it was already deleted.",
    }),
  })
  .openapi("AgentDecisionDeleteResult");
