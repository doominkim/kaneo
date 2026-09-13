import { client } from "@kaneo/libs";
import type { InferRequestType, InferResponseType } from "hono/client";
import { throwAgentLayerError } from "./api-error";

const route = client["agent-design"][":projectId"];

export type AgentDesignList = InferResponseType<(typeof route)["$get"], 200>;
export type AgentDesignSummary = AgentDesignList["designs"][number];
export type AgentDesign = InferResponseType<
  (typeof route)[":feature"]["$get"],
  200
>;
export type AgentStaleVerdict = AgentDesign["stale"];
export type PutAgentDesignBody = InferRequestType<
  (typeof route)[":feature"]["$put"]
>["json"];

export async function getAgentDesigns(
  projectId: string,
): Promise<AgentDesignList> {
  const response = await route.$get({ param: { projectId } });
  if (!response.ok) return throwAgentLayerError(response);
  return response.json();
}

export async function getAgentDesign(
  projectId: string,
  feature: string,
): Promise<AgentDesign> {
  const response = await route[":feature"].$get({
    param: { projectId, feature },
  });
  if (!response.ok) return throwAgentLayerError(response);
  return response.json();
}

export type PutAgentDesignRequest = {
  projectId: string;
  feature: string;
  body: PutAgentDesignBody;
};

export async function putAgentDesign({
  projectId,
  feature,
  body,
}: PutAgentDesignRequest): Promise<AgentDesign> {
  const response = await route[":feature"].$put({
    param: { projectId, feature },
    json: body,
  });
  if (!response.ok) return throwAgentLayerError(response);
  return response.json();
}

export async function approveAgentDesign({
  projectId,
  feature,
}: {
  projectId: string;
  feature: string;
}) {
  const response = await route[":feature"].approve.$post({
    param: { projectId, feature },
  });
  if (!response.ok) return throwAgentLayerError(response);
  return response.json();
}
