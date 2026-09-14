import { client } from "@kaneo/libs";
import { throwAgentLayerError } from "./api-error";
import type { AgentTerm } from "./get-agent-terms";

/** Clears the soft delete; the term lists and resolves again as it was. */
async function restoreAgentTerm(
  workspaceId: string,
  termId: string,
): Promise<AgentTerm> {
  const response = await client["agent-term"][":workspaceId"][
    ":termId"
  ].restore.$post({
    param: { workspaceId, termId },
  });

  if (!response.ok) {
    return throwAgentLayerError(response);
  }

  return response.json();
}

export default restoreAgentTerm;
