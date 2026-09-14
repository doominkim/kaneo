import { client } from "@kaneo/libs";
import type { InferResponseType } from "hono/client";
import { throwAgentLayerError } from "./api-error";

const route = client["agent-feature"][":projectId"];

export type AgentFeatureList = InferResponseType<(typeof route)["$get"], 200>;
export type AgentFeatureSummary = AgentFeatureList["features"][number];
export type AgentFeatureTaskList = InferResponseType<
  (typeof route)[":feature"]["tasks"]["$get"],
  200
>;
export type AgentFeatureTask = AgentFeatureTaskList["tasks"][number];

/**
 * `deleted` lists only the soft-deleted requirement documents and designs,
 * each carrying `deletedAt`/`deletedBy`; the default is the live ones.
 */
export async function getAgentFeatures(
  projectId: string,
  { deleted = false }: { deleted?: boolean } = {},
): Promise<AgentFeatureList> {
  const response = await route.$get({
    param: { projectId },
    query: deleted ? { deleted: "true" } : {},
  });
  if (!response.ok) return throwAgentLayerError(response);
  return response.json();
}

export async function getAgentFeatureTasks(
  projectId: string,
  feature: string,
): Promise<AgentFeatureTaskList> {
  const response = await route[":feature"].tasks.$get({
    param: { projectId, feature },
  });
  if (!response.ok) return throwAgentLayerError(response);
  return response.json();
}
