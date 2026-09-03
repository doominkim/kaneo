import { client } from "@kaneo/libs";
import type { InferResponseType } from "hono/client";
import { throwAgentLayerError } from "./api-error";

export type AgentTermResolution = InferResponseType<
  (typeof client)["agent-term"][":workspaceId"]["resolve"]["$get"],
  200
>;

async function resolveAgentTerm(
  workspaceId: string,
  term: string,
): Promise<AgentTermResolution> {
  const response = await client["agent-term"][":workspaceId"].resolve.$get({
    param: { workspaceId },
    query: { term },
  });

  if (!response.ok) {
    return throwAgentLayerError(response);
  }

  return response.json();
}

export default resolveAgentTerm;
