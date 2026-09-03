import { client } from "@kaneo/libs";
import { throwAgentLayerError } from "./api-error";
import type { AgentTerm } from "./get-agent-terms";

export type SetAgentTermDomainRequest = {
  workspaceId: string;
  termId: string;
  domainId: string | null;
};

async function setAgentTermDomain({
  workspaceId,
  termId,
  domainId,
}: SetAgentTermDomainRequest): Promise<AgentTerm> {
  const response = await client["agent-term"][":workspaceId"][
    ":termId"
  ].domain.$patch({ param: { workspaceId, termId }, json: { domainId } });

  if (!response.ok) {
    return throwAgentLayerError(response);
  }

  return response.json();
}

export default setAgentTermDomain;
