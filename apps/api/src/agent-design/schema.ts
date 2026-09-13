import { KEY_PATTERN } from "../agent-requirement/keys";
import { z } from "../openapi";

export const MAX_DESIGN_BODY_BYTES = 200 * 1024;

export const putDesignBody = z.object({
  title: z.string().min(1).max(200),
  body: z
    .string()
    .min(1)
    .refine(
      (value) => Buffer.byteLength(value, "utf8") <= MAX_DESIGN_BODY_BYTES,
      {
        message: "body must be at most 200KB",
      },
    ),
  requirementKeys: z
    .array(z.string().regex(KEY_PATTERN))
    .max(500)
    .optional()
    .openapi({
      description:
        "Requirement keys this design covers. When given, replaces the design's requirement links; omit to leave links untouched.",
    }),
  sourceSlug: z.string().max(64).nullable().optional(),
});
