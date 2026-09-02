import { client } from "@kaneo/libs";
import type { InferResponseType } from "hono/client";
import { throwAgentLayerError } from "./api-error";

export type AgentEntryDetail = InferResponseType<
  (typeof client)["agent-entry"][":projectId"][":entryId"]["$get"],
  200
>;

async function getAgentEntry(
  projectId: string,
  entryId: string,
): Promise<AgentEntryDetail> {
  const response = await client["agent-entry"][":projectId"][":entryId"].$get({
    param: { projectId, entryId },
  });

  if (!response.ok) {
    return throwAgentLayerError(response);
  }

  return response.json();
}

export default getAgentEntry;
