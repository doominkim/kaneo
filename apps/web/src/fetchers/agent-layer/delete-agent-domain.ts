import { client } from "@kaneo/libs";
import type { InferResponseType } from "hono/client";
import { throwAgentLayerError } from "./api-error";

export type AgentDomainDeleteResult = InferResponseType<
  (typeof client)["agent-domain"][":workspaceId"][":domainId"]["$delete"],
  200
>;

export type DeleteAgentDomainRequest = {
  workspaceId: string;
  domainId: string;
};

/** 409 carries the API's own counts (children, terms, documents, projects). */
async function deleteAgentDomain({
  workspaceId,
  domainId,
}: DeleteAgentDomainRequest): Promise<AgentDomainDeleteResult> {
  const response = await client["agent-domain"][":workspaceId"][
    ":domainId"
  ].$delete({ param: { workspaceId, domainId } });

  if (!response.ok) {
    return throwAgentLayerError(response);
  }

  return response.json();
}

export default deleteAgentDomain;
