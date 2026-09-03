import { client } from "@kaneo/libs";
import type { InferResponseType } from "hono/client";
import { throwAgentLayerError } from "./api-error";

export type AgentDomainPage = InferResponseType<
  (typeof client)["agent-domain"][":workspaceId"][":domainId"]["$get"],
  200
>;
export type AgentDomainRef = AgentDomainPage["ancestors"][number];

async function getAgentDomain(
  workspaceId: string,
  domainId: string,
): Promise<AgentDomainPage> {
  const response = await client["agent-domain"][":workspaceId"][
    ":domainId"
  ].$get({ param: { workspaceId, domainId } });

  if (!response.ok) {
    return throwAgentLayerError(response);
  }

  return response.json();
}

export default getAgentDomain;
