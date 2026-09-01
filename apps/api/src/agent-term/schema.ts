import { z } from "../openapi";

export const workspaceIdParam = z.object({ workspaceId: z.string() });

export const resolveQuery = z.object({
  term: z.string().min(1).openapi({
    description:
      "The word as someone actually said it. Matched against canonical names and aliases exactly (case- and space-normalised) — never embedded, never inferred.",
  }),
});

export const listTermsQuery = z.object({
  state: z.enum(["active", "dormant", "stale", "retired"]).optional(),
  confidence: z.enum(["proposed", "confirmed", "disputed"]).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

const anchorSchema = z
  .object({
    kind: z.enum(["db", "code", "doc"]),
    table: z.string().optional(),
    column: z.string().optional(),
    repo: z.string().optional(),
    path: z.string().optional(),
    symbol: z.string().optional(),
    url: z.string().optional(),
  })
  .openapi({
    description:
      "Only mappings that search cannot find on its own. A grep-able symbol does not belong here — it fails the recoverability gate.",
  });

export const proposeTermBody = z.object({
  workspaceId: z.string(),
  canonical: z.string().min(1),
  definition: z.string().nullable().optional(),
  aliases: z.array(z.string()).default([]).openapi({
    description: "Variants people actually use, including code identifiers.",
  }),
  notToConfuseWith: z.array(z.string()).default([]).openapi({
    description:
      "Canonical names this is NOT. More load-bearing than aliases: 'this is not that' prevents more mistakes than a synonym list.",
  }),
  anchors: z.array(anchorSchema).default([]),
  sourceEntryId: z.string().nullable().optional(),
});

export const confirmTermBody = z.object({
  termId: z.string(),
  confidence: z.enum(["confirmed", "disputed"]).openapi({
    description:
      "Human review outcome. Model-proposed terms never auto-confirm — an unreviewed lexicon stops being trusted, and an untrusted lexicon is worse than none.",
  }),
});
