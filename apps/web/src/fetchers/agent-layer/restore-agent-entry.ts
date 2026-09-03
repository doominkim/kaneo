import { client } from "@kaneo/libs";
import type { InferResponseType } from "hono/client";
import { throwAgentLayerError } from "./api-error";

export type RestoredAgentEntry = InferResponseType<
  (typeof client)["agent-entry"][":projectId"][":entryId"]["restore"]["$post"],
  200
>;

async function restoreAgentEntry(
  projectId: string,
  entryId: string,
): Promise<RestoredAgentEntry> {
  const response = await client["agent-entry"][":projectId"][
    ":entryId"
  ].restore.$post({
    param: { projectId, entryId },
  });

  if (!response.ok) {
    return throwAgentLayerError(response);
  }

  return response.json();
}

export default restoreAgentEntry;
