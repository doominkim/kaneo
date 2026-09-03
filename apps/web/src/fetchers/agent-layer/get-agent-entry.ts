import { client } from "@kaneo/libs";
import type { InferResponseType } from "hono/client";
import { throwAgentLayerError } from "./api-error";

export type AgentEntryDetail = InferResponseType<
  (typeof client)["agent-entry"][":projectId"][":entryId"]["$get"],
  200
>;

/**
 * `includeDeleted` is only honoured for project:update holders (403
 * otherwise), so the flag is sent solely when the caller asked for it — a
 * plain `includeDeleted=false` would be harmless but is noise on the wire.
 */
async function getAgentEntry(
  projectId: string,
  entryId: string,
  includeDeleted = false,
): Promise<AgentEntryDetail> {
  const response = await client["agent-entry"][":projectId"][":entryId"].$get({
    param: { projectId, entryId },
    query: includeDeleted ? { includeDeleted: "true" } : {},
  });

  if (!response.ok) {
    return throwAgentLayerError(response);
  }

  return response.json();
}

export default getAgentEntry;
