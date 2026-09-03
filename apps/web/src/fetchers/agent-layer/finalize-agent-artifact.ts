import { client } from "@kaneo/libs";
import type { InferResponseType } from "hono/client";
import { throwAgentLayerError } from "./api-error";

export type FinalizedArtifact = InferResponseType<
  (typeof client)["agent-artifact"][":projectId"]["finalize"]["$post"],
  200
>;

async function finalizeAgentArtifact(
  projectId: string,
  body: { artifactId: string; storageKey: string },
): Promise<FinalizedArtifact> {
  const response = await client["agent-artifact"][":projectId"].finalize.$post({
    param: { projectId },
    json: body,
  });

  if (!response.ok) {
    return throwAgentLayerError(response);
  }

  return response.json();
}

export default finalizeAgentArtifact;
