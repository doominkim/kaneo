import { client } from "@kaneo/libs";
import type { InferResponseType } from "hono/client";
import { throwAgentLayerError } from "./api-error";

export type AgentDomainList = InferResponseType<
  (typeof client)["agent-domain"][":workspaceId"]["$get"],
  200
>;
export type AgentDomainNode = AgentDomainList["domains"][number];

/** Flat listing; the client builds the tree (see `domain-tree.ts`). */
async function getAgentDomains(workspaceId: string): Promise<AgentDomainList> {
  const response = await client["agent-domain"][":workspaceId"].$get({
    param: { workspaceId },
  });

  if (!response.ok) {
    return throwAgentLayerError(response);
  }

  return response.json();
}

export default getAgentDomains;
