import { z } from "../openapi";

export const workspaceIdParam = z.object({ workspaceId: z.string() });
export const termParams = workspaceIdParam.extend({ termId: z.string() });

export const resolveQuery = z.object({
  term: z.string().min(1).openapi({
    description:
      "The word as someone actually said it. Matched against canonical names and aliases exactly (case- and space-normalised) — never embedded, never inferred.",
  }),
  projectId: z.string().optional().openapi({
    description:
      "Narrows the answer to the domain pages this project is linked to, plus every unfiled term (`domainId` null), which is workspace-wide vocabulary. Optional: omitting it, or sending it empty, searches the whole workspace. A project outside this workspace is a 400 rather than a narrower answer.",
  }),
});

export const listTermsQuery = z.object({
  state: z.enum(["active", "dormant", "stale", "retired"]).optional(),
  confidence: z.enum(["proposed", "confirmed", "disputed"]).optional(),
  domainId: z.string().optional().openapi({
    description:
      "Exact domain page id, or the literal `none` for the unfiled terms that belong to no page (`domainId` null). Omit, or send it empty, for the whole workspace. Combines with `state` and `confidence`. A page outside this workspace is a 400 rather than an empty answer.",
  }),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

/**
 * `domainId=none` selects the unfiled rows. A page id can never collide with
 * it: ids are generated (cuid2), and "none" is not one. Same sentinel as the
 * ledger's `taskId=none`.
 */
export const NO_DOMAIN_FILTER = "none";

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

const proposeTermFields = z.object({
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
  domainId: z.string().nullable().optional().openapi({
    description:
      "Domain page to file the term under. Must belong to the workspace. Omit to leave it unfiled; `PATCH /{workspaceId}/{termId}/domain` files it later.",
  }),
  provider: z.string().optional().openapi({
    description:
      "Provider of the model writing the proposal, e.g. `anthropic`. Send with `model` from an agent; omit both when a person is proposing. One without the other is a 400. The actor row is resolved server-side as (workspace, caller, model) — a caller cannot name someone else's actor.",
  }),
  model: z.string().optional().openapi({
    description:
      "Model id of the writer, e.g. `claude-opus-5`. Stored and shown verbatim; the server never maps it to a display name.",
  }),
});

/**
 * `provider` and `model` decide which kind of proposal this is, so they travel
 * together exactly as they do on a ledger append: half a pair names no actor,
 * and the row that falls out is neither an agent proposal nor a person's.
 *
 * An agent proposal must then cite the ledger entry it came out of. A
 * definition a model produced is only reviewable if the reviewer can read the
 * work that produced it; without the citation the proposal is an unsourced
 * assertion and the queue fills with things nobody can rule on. A person
 * proposing has the conversation that produced the term, so `sourceEntryId`
 * stays optional there.
 */
export const proposeTermBody = proposeTermFields
  .superRefine((body, ctx) => {
    const hasProvider = body.provider != null;
    const hasModel = body.model != null;
    if (hasProvider !== hasModel) {
      ctx.addIssue({
        code: "custom",
        path: [hasProvider ? "model" : "provider"],
        message: "provider and model must be given together",
      });
      return;
    }
    if (hasProvider && body.sourceEntryId == null) {
      ctx.addIssue({
        code: "custom",
        path: ["sourceEntryId"],
        message: "sourceEntryId is required when provider and model are given",
      });
    }
  })
  .openapi({
    description:
      "An agent proposal carries `provider`, `model` and the `sourceEntryId` of the ledger entry it came out of; a person's proposal carries none of the three.",
  });

export const setTermDomainBody = z.object({
  domainId: z.string().nullable().openapi({
    description:
      "Domain page to file the term under, or null to unfile it. Must belong to the workspace.",
  }),
});

const confirmTermFields = z.object({
  termId: z.string(),
  confidence: z.enum(["confirmed", "disputed"]).openapi({
    description:
      "Human review outcome. Model-proposed terms never auto-confirm — an unreviewed lexicon stops being trusted, and an untrusted lexicon is worse than none. Only `confirmed` terms resolve.",
  }),
  rejectReason: z
    .string()
    .trim()
    .min(1, "rejectReason cannot be blank")
    .optional()
    .openapi({
      description:
        "Required with `disputed`, ignored with `confirmed`. Trimmed before it is stored, and whitespace alone is refused rather than kept. Stored on the term and replayed in the 409 when the same canonical name is proposed again, so a rejection is answered once rather than argued every session.",
    }),
});

/**
 * A rejection without a reason is not a review: the next caller learns only
 * that the word was refused, re-proposes it, and the reviewer pays the same
 * cost again. Blank is the same as absent, so the trim happens here rather
 * than in a client — a reason of `"   "` would be replayed in the 409 as a
 * bare dash. A confirmation carrying a reason is stripped rather than
 * refused — the caller sent something harmless, and the controller clears the
 * column anyway.
 */
export const confirmTermBody = confirmTermFields.superRefine((body, ctx) => {
  if (body.confidence === "disputed" && body.rejectReason == null) {
    ctx.addIssue({
      code: "custom",
      path: ["rejectReason"],
      message: "rejectReason is required when the outcome is disputed",
    });
  }
});
