import { client } from "@kaneo/libs";
import type { InferRequestType, InferResponseType } from "hono/client";
import { throwAgentLayerError } from "./api-error";

type PresignRoute =
  (typeof client)["agent-artifact"][":projectId"]["presign"]["$post"];

export type PresignArtifactBody = InferRequestType<PresignRoute>["json"];
export type PresignArtifactResult = InferResponseType<PresignRoute, 200>;

async function presignAgentArtifact(
  projectId: string,
  body: PresignArtifactBody,
): Promise<PresignArtifactResult> {
  const response = await client["agent-artifact"][":projectId"].presign.$post({
    param: { projectId },
    json: body,
  });

  if (!response.ok) {
    return throwAgentLayerError(response);
  }

  return response.json();
}

export default presignAgentArtifact;
