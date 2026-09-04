import { client } from "@kaneo/libs";
import { throwAgentLayerError } from "./api-error";
import type { AgentTerm } from "./get-agent-terms";

export type ConfirmAgentTermRequest = {
  workspaceId: string;
  termId: string;
  confidence: "confirmed" | "disputed";
  /**
   * Why the term was rejected. The API requires it for `disputed` and refuses
   * the request with a 400 without it; a confirmation carries no reason, so it
   * is left off the body entirely rather than sent as an empty string.
   */
  rejectReason?: string | null;
};

async function confirmAgentTerm({
  workspaceId,
  termId,
  confidence,
  rejectReason,
}: ConfirmAgentTermRequest): Promise<AgentTerm> {
  const response = await client["agent-term"][":workspaceId"].confirm.$post({
    param: { workspaceId },
    json: {
      termId,
      confidence,
      ...(confidence === "disputed" && rejectReason ? { rejectReason } : {}),
    },
  });

  if (!response.ok) {
    return throwAgentLayerError(response);
  }

  return response.json();
}

export default confirmAgentTerm;
