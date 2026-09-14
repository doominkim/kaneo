import { client } from "@kaneo/libs";
import { throwAgentLayerError } from "./api-error";
import type { AgentTerm } from "./get-agent-terms";

export type ReviewAgentTermRequest = { workspaceId: string; termId: string };

/**
 * Records that the calling person read a knowledge item. Any reader may call
 * it; confidence is left alone, which is what `confirm` is for.
 */
async function reviewAgentTerm({
  workspaceId,
  termId,
}: ReviewAgentTermRequest): Promise<AgentTerm> {
  const response = await client["agent-term"][":workspaceId"][
    ":termId"
  ].review.$post({
    param: { workspaceId, termId },
  });

  if (!response.ok) {
    return throwAgentLayerError(response);
  }

  return response.json();
}

export default reviewAgentTerm;
