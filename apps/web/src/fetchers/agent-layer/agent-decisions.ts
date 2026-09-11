import { client } from "@kaneo/libs";
import type { InferRequestType, InferResponseType } from "hono/client";
import { throwAgentLayerError } from "./api-error";

type DecisionClient = (typeof client)["agent-decision"];
export type AgentDecisionList = InferResponseType<
  DecisionClient[":projectId"]["$get"],
  200
>;
export type AgentDecisionSummary = AgentDecisionList["decisions"][number];
export type AgentDecisionDetail = InferResponseType<
  DecisionClient[":projectId"][":decisionId"]["$get"],
  200
>;
export type CreateDecisionBody = InferRequestType<
  DecisionClient["$post"]
>["json"];
export type UpdateDecisionBody = InferRequestType<
  DecisionClient[":projectId"][":decisionId"]["$patch"]
>["json"];

export async function listAgentDecisions(input: {
  projectId: string;
  before?: string;
  status?: "current" | "all" | "draft" | "accepted" | "superseded";
  q?: string;
  taskId?: string;
}) {
  const response = await client["agent-decision"][":projectId"].$get({
    param: { projectId: input.projectId },
    query: {
      limit: "20",
      ...(input.before ? { before: input.before } : {}),
      ...(input.status ? { status: input.status } : {}),
      ...(input.q ? { q: input.q } : {}),
      ...(input.taskId ? { taskId: input.taskId } : {}),
    },
  });
  if (!response.ok) return throwAgentLayerError(response);
  return response.json();
}
export async function getAgentDecision(projectId: string, decisionId: string) {
  const response = await client["agent-decision"][":projectId"][
    ":decisionId"
  ].$get({ param: { projectId, decisionId } });
  if (!response.ok) return throwAgentLayerError(response);
  return response.json();
}
export async function createAgentDecision(body: CreateDecisionBody) {
  const response = await client["agent-decision"].$post({ json: body });
  if (!response.ok) return throwAgentLayerError(response);
  return response.json();
}
export async function updateAgentDecision(input: {
  projectId: string;
  decisionId: string;
  body: UpdateDecisionBody;
}) {
  const response = await client["agent-decision"][":projectId"][
    ":decisionId"
  ].$patch({
    param: { projectId: input.projectId, decisionId: input.decisionId },
    json: input.body,
  });
  if (!response.ok) return throwAgentLayerError(response);
  return response.json();
}
export async function acceptAgentDecision(input: {
  projectId: string;
  decisionId: string;
  expectedUpdatedAt: string;
  supersedesDecisionId?: string;
}) {
  const response = await client["agent-decision"][":projectId"][
    ":decisionId"
  ].accept.$post({
    param: { projectId: input.projectId, decisionId: input.decisionId },
    json: {
      expectedUpdatedAt: input.expectedUpdatedAt,
      ...(input.supersedesDecisionId
        ? { supersedesDecisionId: input.supersedesDecisionId }
        : {}),
    },
  });
  if (!response.ok) return throwAgentLayerError(response);
  return response.json();
}
export async function promoteAgentDecisionEntry(
  projectId: string,
  entryId: string,
) {
  const response = await client["agent-decision"][":projectId"]["from-entry"][
    ":entryId"
  ].$post({ param: { projectId, entryId } });
  if (!response.ok) return throwAgentLayerError(response);
  return response.json();
}
