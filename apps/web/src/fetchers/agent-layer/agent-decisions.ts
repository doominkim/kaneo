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
export type AgentDecisionDeleteResult = InferResponseType<
  DecisionClient[":projectId"][":decisionId"]["$delete"],
  200
>;
export type CreateDecisionBody = InferRequestType<
  DecisionClient["$post"]
>["json"];

/** `deleted` lists only soft-deleted ADRs; every other value hides them. */
export type AgentDecisionStatusFilter =
  | "current"
  | "all"
  | "accepted"
  | "superseded"
  | "deleted";

export type AgentDecisionTarget = { projectId: string; decisionId: string };

export async function listAgentDecisions(input: {
  projectId: string;
  before?: string;
  status?: AgentDecisionStatusFilter;
  q?: string;
  taskId?: string;
  limit?: number;
}) {
  const response = await client["agent-decision"][":projectId"].$get({
    param: { projectId: input.projectId },
    query: {
      limit: String(input.limit ?? 20),
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
export async function reviewAgentDecision({
  projectId,
  decisionId,
}: AgentDecisionTarget) {
  const response = await client["agent-decision"][":projectId"][
    ":decisionId"
  ].review.$post({ param: { projectId, decisionId } });
  if (!response.ok) return throwAgentLayerError(response);
  return response.json();
}
export async function deleteAgentDecision({
  projectId,
  decisionId,
}: AgentDecisionTarget): Promise<AgentDecisionDeleteResult> {
  const response = await client["agent-decision"][":projectId"][
    ":decisionId"
  ].$delete({ param: { projectId, decisionId } });
  if (!response.ok) return throwAgentLayerError(response);
  return response.json();
}
export async function restoreAgentDecision({
  projectId,
  decisionId,
}: AgentDecisionTarget) {
  const response = await client["agent-decision"][":projectId"][
    ":decisionId"
  ].restore.$post({ param: { projectId, decisionId } });
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
