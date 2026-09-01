import { z } from "../openapi";

export const projectIdParam = z.object({ projectId: z.string() });

export const acquireLeaseBody = z.object({
  taskId: z.string(),
  provider: z.string(),
  model: z.string(),
  sessionId: z.string().min(1).openapi({
    description:
      "Session-scoped, not actor-scoped: two concurrent sessions of the same model are distinct holders.",
  }),
  ttlMinutes: z.number().int().min(1).max(480).default(60).openapi({
    description:
      "Mandatory expiry. A session that dies must not hold a task forever, so there is no unbounded option.",
  }),
});

export const releaseLeaseBody = z.object({
  taskId: z.string(),
  sessionId: z.string().min(1).openapi({
    description:
      "Only the holding session may release. Prevents one agent from stealing another's claim.",
  }),
});
