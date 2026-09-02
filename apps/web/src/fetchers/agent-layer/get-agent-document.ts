import { client } from "@kaneo/libs";
import type { InferResponseType } from "hono/client";
import { throwAgentLayerError } from "./api-error";

export type AgentDocument = InferResponseType<
  (typeof client)["agent-document"][":projectId"][":slug"]["$get"],
  200
>;

async function getAgentDocument(
  projectId: string,
  slug: string,
): Promise<AgentDocument> {
  const response = await client["agent-document"][":projectId"][":slug"].$get({
    param: { projectId, slug },
  });

  if (!response.ok) {
    return throwAgentLayerError(response);
  }

  return response.json();
}

export default getAgentDocument;
