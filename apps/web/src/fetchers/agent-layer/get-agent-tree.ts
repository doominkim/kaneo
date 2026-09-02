import { client } from "@kaneo/libs";
import type { InferResponseType } from "hono/client";
import { throwAgentLayerError } from "./api-error";

export type AgentTree = InferResponseType<
  (typeof client)["agent-project"][":projectId"]["tree"]["$get"],
  200
>;
export type AgentTreeNode = AgentTree["nodes"][number];

async function getAgentTree(projectId: string): Promise<AgentTree> {
  const response = await client["agent-project"][":projectId"].tree.$get({
    param: { projectId },
  });

  if (!response.ok) {
    return throwAgentLayerError(response);
  }

  return response.json();
}

export default getAgentTree;
