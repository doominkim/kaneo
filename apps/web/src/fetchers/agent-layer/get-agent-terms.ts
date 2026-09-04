import { client } from "@kaneo/libs";
import type { InferResponseType } from "hono/client";
import { throwAgentLayerError } from "./api-error";

export type AgentTermList = InferResponseType<
  (typeof client)["agent-term"][":workspaceId"]["$get"],
  200
>;
export type AgentTerm = AgentTermList["terms"][number];

export type AgentTermConfidence = "proposed" | "confirmed" | "disputed";
export type AgentTermState = "active" | "dormant" | "stale" | "retired";

export type GetAgentTermsRequest = {
  workspaceId: string;
  confidence?: AgentTermConfidence;
  state?: AgentTermState;
  /**
   * A domain page id narrows the list to that page; `"none"` asks for the
   * unfiled terms (`domain_id IS NULL`). Omitted, the whole workspace.
   */
  domainId?: string;
  limit?: number;
};

async function getAgentTerms({
  workspaceId,
  confidence,
  state,
  domainId,
  limit = 100,
}: GetAgentTermsRequest): Promise<AgentTermList> {
  const response = await client["agent-term"][":workspaceId"].$get({
    param: { workspaceId },
    query: {
      limit: String(limit),
      ...(confidence ? { confidence } : {}),
      ...(state ? { state } : {}),
      ...(domainId ? { domainId } : {}),
    },
  });

  if (!response.ok) {
    return throwAgentLayerError(response);
  }

  return response.json();
}

export default getAgentTerms;
