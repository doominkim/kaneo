import { z } from "../openapi";

export const projectIdParam = z.object({ projectId: z.string() });
