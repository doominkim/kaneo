import { client } from "@kaneo/libs";
import type { InferRequestType } from "hono/client";
import { throwAgentLayerError } from "./api-error";
import type { AgentDomain } from "./create-agent-domain";

export type MoveAgentDomainBody = InferRequestType<
  (typeof client)["agent-domain"][":workspaceId"][":domainId"]["move"]["$post"]
>["json"];

export type MoveAgentDomainRequest = {
  workspaceId: string;
  domainId: string;
  body: MoveAgentDomainBody;
};

async function moveAgentDomain({
  workspaceId,
  domainId,
  body,
}: MoveAgentDomainRequest): Promise<AgentDomain> {
  const response = await client["agent-domain"][":workspaceId"][
    ":domainId"
  ].move.$post({ param: { workspaceId, domainId }, json: body });

  if (!response.ok) {
    return throwAgentLayerError(response);
  }

  return response.json();
}

export default moveAgentDomain;
