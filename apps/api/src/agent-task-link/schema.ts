import { FEATURE_PATTERN, KEY_PATTERN } from "../agent-requirement/keys";
import { z } from "../openapi";

export const taskParams = z.object({
  projectId: z.string(),
  taskId: z.string(),
});

export const putTaskLinksBody = z.object({
  requirementKeys: z
    .array(z.string().regex(KEY_PATTERN))
    .max(200)
    .optional()
    .openapi({
      description: "Replaces the task's requirement links when sent.",
    }),
  designFeatures: z
    .array(z.string().regex(FEATURE_PATTERN))
    .max(50)
    .optional()
    .openapi({ description: "Replaces the task's design links when sent." }),
});
