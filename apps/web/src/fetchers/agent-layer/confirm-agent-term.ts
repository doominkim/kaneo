import { client } from "@kaneo/libs";
import { throwAgentLayerError } from "./api-error";
import type { AgentTerm } from "./get-agent-terms";

export type ConfirmAgentTermRequest = {
  workspaceId: string;
  termId: string;
  confidence: "confirmed" | "disputed";
};

async function confirmAgentTerm({
  workspaceId,
  termId,
  confidence,
}: ConfirmAgentTermRequest): Promise<AgentTerm> {
  const response = await client["agent-term"][":workspaceId"].confirm.$post({
    param: { workspaceId },
    json: { termId, confidence },
  });

  if (!response.ok) {
    return throwAgentLayerError(response);
  }

  return response.json();
}

export default confirmAgentTerm;
