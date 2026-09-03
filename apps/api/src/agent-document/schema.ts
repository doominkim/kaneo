import { z } from "../openapi";

export const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;
/** Bytes, not characters: the cap is a storage/transfer budget. */
export const MAX_DOCUMENT_BODY_BYTES = 200 * 1024;

export const projectIdParam = z.object({ projectId: z.string() });

export const documentParams = z.object({
  projectId: z.string(),
  slug: z
    .string()
    .regex(SLUG_PATTERN, "slug must match ^[a-z0-9][a-z0-9-]{0,63}$")
    .openapi({
      description:
        "Lowercase letters, digits and hyphens, 1–64 characters, starting with a letter or digit. Stable across overwrites — it is the document's identity within the project.",
    }),
});

export const putDocumentBody = z.object({
  title: z.string().min(1).max(200),
  body: z
    .string()
    .refine(
      (value) => Buffer.byteLength(value, "utf8") <= MAX_DOCUMENT_BODY_BYTES,
      {
        message: "body must be at most 200KB",
      },
    )
    .openapi({
      description:
        "Markdown. At most 200KB (UTF-8 bytes). Overwrites the previous body; there is no append.",
    }),
  taskId: z.string().nullable().optional().openapi({
    description:
      "Optional task this document was produced under. Must belong to the project. When set, the document hangs as a leaf under that task in the overview tree.",
  }),
  domainId: z.string().nullable().optional().openapi({
    description:
      "Optional domain page to file the document under. Must belong to the project's workspace. Omitted or null unfiles it — the body is a full replacement.",
  }),
});
