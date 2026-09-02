import { client } from "@kaneo/libs";
import type { InferResponseType } from "hono/client";
import { throwAgentLayerError } from "./api-error";

export type AgentLeaseList = InferResponseType<
  (typeof client)["agent-lease"][":projectId"]["$get"],
  200
>;
export type AgentLease = AgentLeaseList["leases"][number];

async function getAgentLeases(projectId: string): Promise<AgentLeaseList> {
  const response = await client["agent-lease"][":projectId"].$get({
    param: { projectId },
  });

  if (!response.ok) {
    return throwAgentLayerError(response);
  }

  return response.json();
}

export default getAgentLeases;
