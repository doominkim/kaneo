import { client } from "@kaneo/libs";
import type { InferResponseType } from "hono/client";
import { throwAgentLayerError } from "./api-error";

export type AgentDocumentList = InferResponseType<
  (typeof client)["agent-document"][":projectId"]["$get"],
  200
>;
export type AgentDocumentSummary = AgentDocumentList["documents"][number];

async function getAgentDocuments(
  projectId: string,
): Promise<AgentDocumentList> {
  const response = await client["agent-document"][":projectId"].$get({
    param: { projectId },
  });

  if (!response.ok) {
    return throwAgentLayerError(response);
  }

  return response.json();
}

export default getAgentDocuments;
