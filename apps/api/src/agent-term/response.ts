import { actorResponseSchema } from "../agent-entry/actor-response";
import { nullableResponseTimestamp, responseTimestamp, z } from "../openapi";

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
