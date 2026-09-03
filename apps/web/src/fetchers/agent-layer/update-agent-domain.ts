import { client } from "@kaneo/libs";
import type { InferRequestType } from "hono/client";
import { throwAgentLayerError } from "./api-error";
import type { AgentDomain } from "./create-agent-domain";

export type UpdateAgentDomainBody = InferRequestType<
  (typeof client)["agent-domain"][":workspaceId"][":domainId"]["$put"]
>["json"];

export type UpdateAgentDomainRequest = {
  workspaceId: string;
  domainId: string;
  body: UpdateAgentDomainBody;
};

async function updateAgentDomain({
  workspaceId,
  domainId,
  body,
}: UpdateAgentDomainRequest): Promise<AgentDomain> {
  const response = await client["agent-domain"][":workspaceId"][
    ":domainId"
  ].$put({ param: { workspaceId, domainId }, json: body });

  if (!response.ok) {
    return throwAgentLayerError(response);
  }

  return response.json();
}

export default updateAgentDomain;
