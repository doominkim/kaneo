import { actorResponseSchema } from "../agent-entry/actor-response";
import { nullableResponseTimestamp, responseTimestamp, z } from "../openapi";

/**
 * The reviewer is always a person — id and display name only, like the domain
 * page's `author`. No actor variant exists on purpose: a model cannot review,
 * so there is nothing for one to be resolved from.
 */
export const termReviewerSchema = z
  .object({ userId: z.string(), name: z.string() })
  .openapi("AgentTermReviewer", {
    description:
      "The person who reviewed a term, or null while it is unreviewed. Who accepted or rejected a term is what makes `confidence` accountable.",
  });

export const termSchema = z
  .object({
    id: z.string(),
    canonical: z.string(),
    definition: z.string().nullable(),
    aliases: z.array(z.string()),
    notToConfuseWith: z.array(z.string()),
    anchors: z.unknown(),
    confidence: z.string(),
    state: z.string(),
    supersededBy: z.string().nullable(),
    domainId: z.string().nullable().openapi({
      description: "Domain page the term is filed under, or null.",
    }),
    actorId: z.string().nullable().openapi({
      description:
        "agent_actor id of the model that proposed the term, or null when a person did.",
    }),
    actor: actorResponseSchema.nullable().openapi({
      description:
        "The model that proposed the term, resolved from `actorId`; null for a human proposal. Which model wrote a proposal is what a reviewer weighs it by. `model` is the model id as the harness reported it and is shown verbatim.",
    }),
    reviewerId: z.string().nullable().openapi({
      description:
        "`user` id of the person who reviewed the term, or null while it is unreviewed. Never an agent — an agent cannot review.",
    }),
    reviewer: termReviewerSchema.nullable(),
    reviewedAt: nullableResponseTimestamp.openapi({
      description:
        "When the review was recorded, or null while unreviewed. Distinct from `lastVerifiedAt`, which the re-verification schedule also stamps.",
    }),
    rejectReason: z.string().nullable().openapi({
      description:
        "Why the term was rejected; set only on a `disputed` term and cleared when it is confirmed. Re-proposing the same canonical name replays it in the 409.",
    }),
    lastVerifiedAt: nullableResponseTimestamp,
    createdAt: responseTimestamp,
  })
  .openapi("AgentTerm");

/**
 * Resolution is deterministic and self-contained.
 *
 * `notToConfuseWith` carries canonical NAMES, not ids, so a caller never has to
 * make a second round trip to understand the answer. A resolve that needs a
 * follow-up query defeats the point of having a lexicon at all.
 */
export const resolveResultSchema = z
  .object({
    match: z.enum(["canonical", "alias", "none"]).openapi({
      description: "How the input matched. `none` means nothing was found.",
    }),
    term: termSchema.nullable(),
    ambiguous: z.array(termSchema).openapi({
      description:
        "Populated only when one input matches several terms. Non-empty means a human must disambiguate — the layer does not guess.",
    }),
  })
  .openapi("AgentTermResolution");

export const termListSchema = z
  .object({ terms: z.array(termSchema) })
  .openapi("AgentTermList");

export const termDeleteResultSchema = z
  .object({ id: z.string(), canonical: z.string() })
  .openapi("AgentTermDeleteResult");
