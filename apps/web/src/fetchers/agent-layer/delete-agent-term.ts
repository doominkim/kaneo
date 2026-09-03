import { client } from "@kaneo/libs";
import type { InferResponseType } from "hono/client";
import { throwAgentLayerError } from "./api-error";

export type DeletedAgentTerm = InferResponseType<
  (typeof client)["agent-term"][":workspaceId"][":termId"]["$delete"],
  200
>;

/**
 * Hard delete, `proposed` terms only. A reviewed term answers 409 with a
 * plain-text reason the UI shows as-is.
 */
async function deleteAgentTerm(
  workspaceId: string,
  termId: string,
): Promise<DeletedAgentTerm> {
  const response = await client["agent-term"][":workspaceId"][
    ":termId"
  ].$delete({
    param: { workspaceId, termId },
  });

  if (!response.ok) {
    return throwAgentLayerError(response);
  }

  return response.json();
}

export default deleteAgentTerm;
