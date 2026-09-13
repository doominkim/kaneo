import { client } from "@kaneo/libs";
import type { InferRequestType, InferResponseType } from "hono/client";
import { throwAgentLayerError } from "./api-error";

const route = client["agent-task-link"][":projectId"];

export type AgentTaskLinkBadgeList = InferResponseType<
  (typeof route)["$get"],
  200
>;
export type AgentTaskLinkBadge = AgentTaskLinkBadgeList["tasks"][number];
export type AgentTaskLinks = InferResponseType<
  (typeof route)[":taskId"]["$get"],
  200
>;
export type PutAgentTaskLinksBody = InferRequestType<
  (typeof route)[":taskId"]["$put"]
>["json"];

export async function getAgentTaskLinkBadges(
  projectId: string,
): Promise<AgentTaskLinkBadgeList> {
  const response = await route.$get({ param: { projectId } });
  if (!response.ok) return throwAgentLayerError(response);
  return response.json();
}

export async function getAgentTaskLinks(
  projectId: string,
  taskId: string,
): Promise<AgentTaskLinks> {
  const response = await route[":taskId"].$get({
    param: { projectId, taskId },
  });
  if (!response.ok) return throwAgentLayerError(response);
  return response.json();
}

export type PutAgentTaskLinksRequest = {
  projectId: string;
  taskId: string;
  body: PutAgentTaskLinksBody;
};

export async function putAgentTaskLinks({
  projectId,
  taskId,
  body,
}: PutAgentTaskLinksRequest): Promise<AgentTaskLinks> {
  const response = await route[":taskId"].$put({
    param: { projectId, taskId },
    json: body,
  });
  if (!response.ok) return throwAgentLayerError(response);
  return response.json();
}

export async function acknowledgeAgentTaskLinks({
  projectId,
  taskId,
}: {
  projectId: string;
  taskId: string;
}) {
  const response = await route[":taskId"].acknowledge.$post({
    param: { projectId, taskId },
  });
  if (!response.ok) return throwAgentLayerError(response);
  return response.json();
}
