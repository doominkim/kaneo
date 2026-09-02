import { z } from "../openapi";
import {
  ALLOWED_ARTIFACT_CONTENT_TYPES,
  hasPathSeparator,
  MAX_ARTIFACT_BYTES,
  MAX_ARTIFACT_NAME_LENGTH,
} from "./policy";

export const projectIdParam = z.object({ projectId: z.string() });

export const artifactParams = z.object({
  projectId: z.string(),
  artifactId: z.string(),
});

export const listQuery = z.object({
  taskId: z.string().optional().openapi({
    description: "Only artifacts linked to this task.",
  }),
});

export const urlQuery = z.object({
  disposition: z.enum(["inline", "attachment"]).optional().openapi({
    description:
      "Defaults to attachment. inline is honoured only for text/html, text/markdown, text/plain, application/json and application/pdf; application/zip is always served as attachment.",
  }),
});

export const presignBody = z.object({
  name: z
    .string()
    .min(1)
    .max(MAX_ARTIFACT_NAME_LENGTH)
    .refine((value) => value.trim().length > 0, {
      message: "name must not be blank",
    })
    .refine((value) => !hasPathSeparator(value), {
      message: "name must not contain path separators",
    })
    .openapi({
      description:
        "Display file name, 1–200 characters, no `/` or `\\`. Stored as given; a sanitized copy becomes the last key segment.",
    }),
  contentType: z
    .string()
    .min(1)
    .openapi({
      description: `One of ${ALLOWED_ARTIFACT_CONTENT_TYPES.join(", ")} (case-insensitive, no parameters).`,
    }),
  size: z.number().int().min(1).max(MAX_ARTIFACT_BYTES).openapi({
    description: "Exact byte length of the upload. Verified at finalize.",
  }),
  taskId: z.string().nullable().optional().openapi({
    description:
      "Optional task the artifact belongs to. Must be in the project; it then hangs as a leaf under that task in the overview tree.",
  }),
});

export const finalizeBody = z.object({
  artifactId: z.string().min(1),
  storageKey: z.string().min(1).openapi({
    description: "The key returned by presign, echoed back unchanged.",
  }),
});
