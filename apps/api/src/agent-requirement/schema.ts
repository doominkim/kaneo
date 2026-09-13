import { z } from "../openapi";
import { FEATURE_PATTERN, KEY_PATTERN } from "./keys";

/** Bytes; same budget as documents. */
export const MAX_REQUIREMENT_BODY_BYTES = 200 * 1024;
export const MAX_ITEM_TEXT_LENGTH = 2000;

export const projectIdParam = z.object({ projectId: z.string() });

export const featureParams = z.object({
  projectId: z.string(),
  feature: z
    .string()
    .regex(FEATURE_PATTERN, "feature must match ^[a-z0-9][a-z0-9-]{0,63}$")
    .openapi({
      description:
        "Feature slug. The same slug binds this requirement set, its design and its tasks.",
    }),
});

export const requirementItemInput = z.object({
  key: z
    .string()
    .regex(KEY_PATTERN, "key must match REQ-<FEATURE>-<n>")
    .optional()
    .openapi({
      description:
        "Omit to have a new key issued. Give an existing key to update that item, or a new explicit key to import numbering.",
    }),
  text: z.string().min(1).max(MAX_ITEM_TEXT_LENGTH),
  layer: z.string().max(64).nullable().optional(),
  status: z.enum(["active", "deferred", "dropped"]).optional(),
  story: z.string().max(200).nullable().optional(),
});

export const putRequirementSetBody = z.object({
  title: z.string().min(1).max(200),
  body: z
    .string()
    .refine(
      (value) => Buffer.byteLength(value, "utf8") <= MAX_REQUIREMENT_BODY_BYTES,
      { message: "body must be at most 200KB" },
    )
    .default("")
    .openapi({
      description:
        "The requirement document. When it contains criterion lines (`n. <sentence> `unit|api|e2e` [REQ-key]` under a `##` story), the document is the source of truth: rows are derived from it, keys are issued and written back, and `items` is ignored.",
    }),
  items: z.array(requirementItemInput).max(500).default([]),
  sourceSlug: z.string().max(64).nullable().optional().openapi({
    description:
      "Document slug this set was migrated from. The document itself is left in place.",
  }),
});

export const putCoverageBody = z.object({
  repo: z.string().min(1).max(200),
  entries: z
    .array(
      z.object({
        key: z.string().regex(KEY_PATTERN),
        testPath: z.string().min(1).max(300),
        testName: z.string().max(300).nullable().optional(),
      }),
    )
    .max(2000),
});

export const requirementSetQuery = z.object({
  projectId: z.string(),
  feature: z.string().regex(FEATURE_PATTERN),
});
