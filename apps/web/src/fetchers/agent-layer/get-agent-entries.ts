import { client } from "@kaneo/libs";
import type { InferResponseType } from "hono/client";
import { throwAgentLayerError } from "./api-error";

export type AgentEntryKind = "work" | "investigation" | "decision" | "handoff";

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
};

async function getAgentEntries({
  projectId,
  limit = 20,
  before,
  kind,
  taskId,
}: GetAgentEntriesRequest): Promise<AgentEntryList> {
  const response = await client["agent-entry"][":projectId"].$get({
    param: { projectId },
    query: {
      limit: String(limit),
      ...(before ? { before } : {}),
      ...(kind ? { kind } : {}),
      ...(taskId ? { taskId } : {}),
    },
  });

  if (!response.ok) {
    return throwAgentLayerError(response);
  }

  return response.json();
}

export default getAgentEntries;
