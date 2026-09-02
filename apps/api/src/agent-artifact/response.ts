import { responseTimestamp, z } from "../openapi";

export const artifactSchema = z
  .object({
    id: z.string(),
    projectId: z.string(),
    taskId: z.string().nullable(),
    name: z.string(),
    contentType: z.string(),
    size: z.number().int(),
    uploadedBy: z.string().nullable().openapi({
      description: "User id of the human uploader, or null for an agent.",
    }),
    actorId: z.string().nullable().openapi({
      description: "agent_actor id of the agent uploader, or null for a human.",
    }),
    createdAt: responseTimestamp,
  })
  .openapi("AgentArtifact");

export const artifactListSchema = z
  .object({ artifacts: z.array(artifactSchema) })
  .openapi("AgentArtifactList");

export const presignResultSchema = z
  .object({
    artifactId: z.string(),
    uploadUrl: z.string(),
    storageKey: z.string(),
    expiresAt: responseTimestamp,
    headers: z.record(z.string(), z.string()).openapi({
      description:
        "Headers the PUT must carry. Content-Type is part of the signature, so a different value is rejected by storage.",
    }),
  })
  .openapi("AgentArtifactPresign");

export const urlResultSchema = z
  .object({
    url: z.string(),
    expiresAt: responseTimestamp,
  })
  .openapi("AgentArtifactUrl");

export const deleteResultSchema = z
  .object({ id: z.string() })
  .openapi("AgentArtifactDeleteResult");
