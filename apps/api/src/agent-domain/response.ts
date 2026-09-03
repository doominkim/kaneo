import { actorResponseSchema } from "../agent-entry/actor-response";
import { responseTimestamp, z } from "../openapi";

/**
 * Tree row — the flat listing the sidebar builds its tree from. No body: a
 * workspace can hold hundreds of pages and the listing must stay cheap.
 */
export const domainNodeSchema = z
  .object({
    id: z.string(),
    parentId: z.string().nullable(),
    slug: z.string(),
    title: z.string(),
    position: z.number().int(),
    updatedAt: responseTimestamp,
    childCount: z.number().int(),
  })
  .openapi("AgentDomainNode");

export const domainListSchema = z
  .object({
    domains: z.array(domainNodeSchema).openapi({
      description:
        "Every page in the workspace, ordered by (parentId, position, title). Root pages come first (parentId null). The client builds the tree.",
    }),
  })
  .openapi("AgentDomainList");

const domainRefSchema = z
  .object({ id: z.string(), slug: z.string(), title: z.string() })
  .openapi("AgentDomainRef");

const linkedTermSchema = z
  .object({
    id: z.string(),
    canonical: z.string(),
    confidence: z.string(),
    state: z.string(),
  })
  .openapi("AgentDomainTerm");

const linkedProjectSchema = z
  .object({ id: z.string(), name: z.string(), slug: z.string() })
  .openapi("AgentDomainProject");

const linkedDocumentSchema = z
  .object({
    id: z.string(),
    projectId: z.string(),
    slug: z.string(),
    title: z.string(),
    updatedAt: responseTimestamp,
  })
  .openapi("AgentDomainDocument");

/**
 * Only the author facts, never the whole user row: the page view shows a
 * name, and anything more is data the reader has no business receiving.
 */
export const domainAuthorSchema = z
  .object({ userId: z.string(), name: z.string() })
  .nullable()
  .openapi({
    description:
      "The human who wrote the current body, or null when an agent did (see `actor`). Both are null only when the author's account was deleted.",
  });

/** The page without its aggregates — what every write returns. */
export const domainSchema = z
  .object({
    id: z.string(),
    workspaceId: z.string(),
    parentId: z.string().nullable(),
    slug: z.string(),
    title: z.string(),
    body: z.string(),
    position: z.number().int(),
    updatedBy: z.string().nullable(),
    actorId: z.string().nullable(),
    author: domainAuthorSchema,
    actor: actorResponseSchema.nullable().openapi({
      description:
        "The agent that wrote the current body; null when a human did. `model` is shown verbatim as the harness reported it.",
    }),
    createdAt: responseTimestamp,
    updatedAt: responseTimestamp,
  })
  .openapi("AgentDomain");

/**
 * The page plus everything linked to it. Aggregated server-side in one call:
 * a client that fetched terms, projects and documents separately per page
 * would make four round trips to show one screen.
 */
export const domainPageSchema = domainSchema
  .extend({
    ancestors: z.array(domainRefSchema).openapi({
      description: "Root first, immediate parent last. Empty for a root page.",
    }),
    children: z.array(domainRefSchema).openapi({
      description: "Direct children, ordered by (position, title).",
    }),
    terms: z.array(linkedTermSchema).openapi({
      description: "Lexicon terms filed under this page, alphabetical.",
    }),
    projects: z.array(linkedProjectSchema).openapi({
      description: "Projects linked through their Agent Layer settings.",
    }),
    documents: z.array(linkedDocumentSchema).openapi({
      description: "Documents filed under this page, newest first.",
    }),
  })
  .openapi("AgentDomainPage");

export const domainDeleteResultSchema = z
  .object({ id: z.string(), slug: z.string() })
  .openapi("AgentDomainDeleteResult");
