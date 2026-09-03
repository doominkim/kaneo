import { client } from "@kaneo/libs";
import type { InferResponseType } from "hono/client";
import { throwAgentLayerError } from "./api-error";

export type AgentArtifactList = InferResponseType<
  (typeof client)["agent-artifact"][":projectId"]["$get"],
  200
>;
export type AgentArtifact = AgentArtifactList["artifacts"][number];

async function getAgentArtifacts(
  projectId: string,
  taskId?: string,
): Promise<AgentArtifactList> {
  const response = await client["agent-artifact"][":projectId"].$get({
    param: { projectId },
    query: taskId ? { taskId } : {},
  });

  if (!response.ok) {
    return throwAgentLayerError(response);
  }

  return response.json();
}

export default getAgentArtifacts;
