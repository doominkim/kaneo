import { actorResponseSchema } from "../agent-entry/actor-response";
import { responseTimestamp, z } from "../openapi";

/**
 * Listing shape — deliberately WITHOUT `body`.
 *
 * Bodies are up to 200KB each; a listing that shipped them would cost more
 * than the whole ledger. `actorId`/`updatedBy` are both present so a reader can
 * tell at a glance whether a human or an agent wrote the current version.
 */
export const documentSummarySchema = z
  .object({
    id: z.string(),
    slug: z.string(),
    title: z.string(),
    taskId: z.string().nullable(),
    domainId: z.string().nullable().openapi({
      description: "Domain page the document is filed under, or null.",
    }),
    updatedBy: z.string().nullable().openapi({
      description:
        "User id of the human author, or null when an agent wrote it.",
    }),
    actorId: z.string().nullable().openapi({
      description:
        "agent_actor id of the agent author, or null when a human wrote it.",
    }),
    actor: actorResponseSchema.nullable().openapi({
      description:
        "The agent that wrote the current body, resolved from `actorId`; null when a human wrote it. `model` is the model id as the harness reported it and is shown verbatim — the API never maps it to a display name.",
    }),
    updatedAt: responseTimestamp,
  })
  .openapi("AgentDocumentSummary");

export const documentListSchema = z
  .object({ documents: z.array(documentSummarySchema) })
  .openapi("AgentDocumentList");

export const documentSchema = documentSummarySchema
  .extend({
    workspaceId: z.string(),
    projectId: z.string(),
    body: z.string(),
    createdAt: responseTimestamp,
  })
  .openapi("AgentDocument");

export const deleteResultSchema = z
  .object({ id: z.string(), slug: z.string() })
  .openapi("AgentDocumentDeleteResult");
