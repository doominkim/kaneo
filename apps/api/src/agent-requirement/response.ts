import { actorResponseSchema } from "../agent-entry/actor-response";
import { responseTimestamp, z } from "../openapi";

const nullableTimestamp = responseTimestamp.nullable();

export const requirementSetSummarySchema = z
  .object({
    id: z.string(),
    feature: z.string(),
    title: z.string(),
    status: z.string().openapi({ description: "`draft` or `approved`." }),
    approvedAt: nullableTimestamp,
    sourceSlug: z.string().nullable(),
    createdAt: responseTimestamp,
    updatedAt: responseTimestamp,
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

export const requirementSetRowSchema = requirementSetSchema
  .omit({ items: true, actor: true })
  .openapi("AgentRequirementSetRow");

export const coverageResultSchema = z
  .object({ feature: z.string(), repo: z.string(), reported: z.number() })
  .openapi("AgentRequirementCoverageResult");
