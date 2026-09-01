import { responseTimestamp, z } from "../openapi";

export const leaseSchema = z
  .object({
    id: z.string(),
    taskId: z.string(),
    sessionId: z.string(),
    acquiredAt: responseTimestamp,
    expiresAt: responseTimestamp,
    actor: z
      .object({
        id: z.string(),
        provider: z.string(),
        model: z.string(),
        onBehalfOf: z.string().nullable(),
      })
      .nullable(),
  })
  .openapi("AgentLease");

export const acquireResultSchema = z
  .object({
    acquired: z.boolean().openapi({
      description:
        "False when another live session already holds the task. The caller must not proceed — this is the whole point of asking.",
    }),
    lease: leaseSchema.nullable().openapi({
      description:
        "On failure this is the CURRENT holder, so the caller can say who has it rather than just failing.",
    }),
  })
  .openapi("AgentLeaseAcquisition");

export const leaseListSchema = z
  .object({ leases: z.array(leaseSchema) })
  .openapi("AgentLeaseList");

export const releaseResultSchema = z
  .object({ released: z.boolean() })
  .openapi("AgentLeaseRelease");
