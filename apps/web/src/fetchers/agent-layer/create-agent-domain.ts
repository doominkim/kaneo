import { client } from "@kaneo/libs";
import type { InferRequestType, InferResponseType } from "hono/client";
import { throwAgentLayerError } from "./api-error";

export type AgentDomain = InferResponseType<
  (typeof client)["agent-domain"][":workspaceId"]["$post"],
  200
>;
export type CreateAgentDomainBody = InferRequestType<
  (typeof client)["agent-domain"][":workspaceId"]["$post"]
>["json"];

export type CreateAgentDomainRequest = {
  workspaceId: string;
  body: CreateAgentDomainBody;
};

async function createAgentDomain({
  workspaceId,
  body,
}: CreateAgentDomainRequest): Promise<AgentDomain> {
  const response = await client["agent-domain"][":workspaceId"].$post({
    param: { workspaceId },
    json: body,
  });

  if (!response.ok) {
    return throwAgentLayerError(response);
  }

  return response.json();
}

export default createAgentDomain;
