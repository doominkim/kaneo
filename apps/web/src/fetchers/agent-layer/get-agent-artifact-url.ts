import { client } from "@kaneo/libs";
import type { InferResponseType } from "hono/client";
import { throwAgentLayerError } from "./api-error";

export type AgentArtifactUrl = InferResponseType<
  (typeof client)["agent-artifact"][":projectId"][":artifactId"]["url"]["$get"],
  200
>;

export type ArtifactDisposition = "inline" | "attachment";

/**
 * Mints a short-lived (60s by default) presigned GET. Never cache the result:
 * every click asks again so an expired URL is never handed to an iframe.
 */
async function getAgentArtifactUrl(
  projectId: string,
  artifactId: string,
  disposition: ArtifactDisposition,
): Promise<AgentArtifactUrl> {
  const response = await client["agent-artifact"][":projectId"][
    ":artifactId"
  ].url.$get({
    param: { projectId, artifactId },
    query: { disposition },
  });

  if (!response.ok) {
    return throwAgentLayerError(response);
  }

  return response.json();
}

export default getAgentArtifactUrl;
