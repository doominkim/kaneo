import { client } from "@kaneo/libs";
import type { InferRequestType, InferResponseType } from "hono/client";
import { throwAgentLayerError } from "./api-error";

const route = client["agent-requirement"][":projectId"];

export type AgentRequirementSetList = InferResponseType<
  (typeof route)["$get"],
  200
>;
export type AgentRequirementSetSummary =
  AgentRequirementSetList["sets"][number];
export type AgentRequirementSet = InferResponseType<
  (typeof route)[":feature"]["$get"],
  200
>;
export type AgentRequirementItem = AgentRequirementSet["items"][number];
export type PutAgentRequirementSetBody = InferRequestType<
  (typeof route)[":feature"]["$put"]
>["json"];
export type AgentRequirementItemInput = NonNullable<
  PutAgentRequirementSetBody["items"]
>[number];

/** `REQ-SPEC-TABS-3` → `spec-tabs`: the feature slug is the key prefix, lower-cased. */
export function featureOfKey(key: string): string {
  return key.replace(/^REQ-/, "").replace(/-\d+$/, "").toLowerCase();
}

export async function getAgentRequirementSets(
  projectId: string,
): Promise<AgentRequirementSetList> {
  const response = await route.$get({ param: { projectId } });
  if (!response.ok) return throwAgentLayerError(response);
  return response.json();
}

export async function getAgentRequirementSet(
  projectId: string,
  feature: string,
): Promise<AgentRequirementSet> {
  const response = await route[":feature"].$get({
    param: { projectId, feature },
  });
  if (!response.ok) return throwAgentLayerError(response);
  return response.json();
}

export type PutAgentRequirementSetRequest = {
  projectId: string;
  feature: string;
  body: PutAgentRequirementSetBody;
};

export async function putAgentRequirementSet({
  projectId,
  feature,
  body,
}: PutAgentRequirementSetRequest): Promise<AgentRequirementSet> {
  const response = await route[":feature"].$put({
    param: { projectId, feature },
    json: body,
  });
  if (!response.ok) return throwAgentLayerError(response);
  return response.json();
}

export async function approveAgentRequirementSet({
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
