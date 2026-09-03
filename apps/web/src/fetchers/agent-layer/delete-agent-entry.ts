import { client } from "@kaneo/libs";
import type { InferResponseType } from "hono/client";
import { throwAgentLayerError } from "./api-error";

export type DeletedAgentEntry = InferResponseType<
  (typeof client)["agent-entry"][":projectId"][":entryId"]["$delete"],
  200
>;

/** Soft delete: the API keeps the row and stamps `deletedAt`. */
async function deleteAgentEntry(
  projectId: string,
  entryId: string,
): Promise<DeletedAgentEntry> {
  const response = await client["agent-entry"][":projectId"][
    ":entryId"
  ].$delete({
    param: { projectId, entryId },
  });

  if (!response.ok) {
    return throwAgentLayerError(response);
  }

  return response.json();
}

export default deleteAgentEntry;
