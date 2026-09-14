import { z } from "../openapi";

/** Same wire idiom as the ledger's `includeDeleted`: `"false"` must not read as true. */
export const listFeaturesQuery = z.object({
  deleted: z
    .enum(["true", "false"])
    .optional()
    .transform((value) => value === "true")
    .openapi({
      description:
        "`true` lists the soft-deleted requirement sets and designs instead of the live ones, each carrying `deletedAt`/`deletedBy`. Default: live documents only.",
    }),
});
