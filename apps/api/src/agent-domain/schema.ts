import { z } from "../openapi";

export const DOMAIN_SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;
/** Bytes, not characters: the same budget a document body has. */
export const MAX_DOMAIN_BODY_BYTES = 200 * 1024;
export const MAX_DOMAIN_TITLE_LENGTH = 200;

export const workspaceIdParam = z.object({ workspaceId: z.string() });
export const domainParams = workspaceIdParam.extend({ domainId: z.string() });

const slug = z
  .string()
  .regex(DOMAIN_SLUG_PATTERN, "slug must match ^[a-z0-9][a-z0-9-]{0,63}$")
  .openapi({
    description:
      "Lowercase letters, digits and hyphens, 1–64 characters, starting with a letter or digit. Unique among siblings; the page's identity within its level.",
  });

const title = z.string().min(1).max(MAX_DOMAIN_TITLE_LENGTH);

const body = z
  .string()
  .refine(
    (value) => Buffer.byteLength(value, "utf8") <= MAX_DOMAIN_BODY_BYTES,
    {
      message: "body must be at most 200KB",
    },
  )
  .openapi({
    description:
      "Markdown. At most 200KB (UTF-8 bytes). A full replacement; there is no append.",
  });

export const createDomainBody = z.object({
  parentId: z.string().nullable().optional().openapi({
    description:
      "Parent page id, or null/omitted for a root page. Must belong to the same workspace.",
  }),
  slug,
  title,
  body: body.default(""),
});

export const updateDomainBody = z
  .object({
    title: title.optional(),
    body: body.optional(),
  })
  .refine((value) => value.title !== undefined || value.body !== undefined, {
    message: "At least one of title or body is required",
  });

export const moveDomainBody = z.object({
  parentId: z.string().nullable().openapi({
    description:
      "New parent page id, or null to make it a root page. Moving under the page itself or one of its descendants is rejected.",
  }),
  position: z.number().int().min(0).max(100_000).optional().openapi({
    description: "Sibling order; unchanged when omitted. Ties break by title.",
  }),
});
