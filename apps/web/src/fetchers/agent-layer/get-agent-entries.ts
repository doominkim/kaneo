import { client } from "@kaneo/libs";
import type { InferResponseType } from "hono/client";
import { throwAgentLayerError } from "./api-error";

export type AgentEntryKind = "work" | "investigation" | "decision" | "handoff";

/**
 * `taskId` sentinel the API reads as "task_id IS NULL": the project-level
 * notes written from the timeline header, which no task node can show.
 */
export const NO_TASK_FILTER = "none";

export type AgentEntryList = InferResponseType<
  (typeof client)["agent-entry"][":projectId"]["$get"],
  200
>;
export type AgentEntrySummary = AgentEntryList["entries"][number];

export type GetAgentEntriesRequest = {
  projectId: string;
  limit?: number;
  before?: string;
  kind?: AgentEntryKind;
  taskId?: string;
  /** Requires project:update on the API (403 otherwise); send only when granted. */
  includeDeleted?: boolean;
};

async function getAgentEntries({
  projectId,
  limit = 20,
  before,
  kind,
  taskId,
  includeDeleted = false,
}: GetAgentEntriesRequest): Promise<AgentEntryList> {
  const response = await client["agent-entry"][":projectId"].$get({
    param: { projectId },
    query: {
      limit: String(limit),
      ...(before ? { before } : {}),
      ...(kind ? { kind } : {}),
      ...(taskId ? { taskId } : {}),
      ...(includeDeleted ? { includeDeleted: "true" as const } : {}),
    },
  });

  if (!response.ok) {
    return throwAgentLayerError(response);
  }

  return response.json();
}

export default getAgentEntries;
