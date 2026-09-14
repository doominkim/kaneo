import { client } from "@kaneo/libs";
import type { InferResponseType } from "hono/client";
import { throwAgentLayerError } from "./api-error";

/**
 * Requirement documents and designs share one lifecycle (agent-autoapply):
 * review mark, soft delete and restore, revisions and revert. The two API
 * families have identical shapes, so the pages call one set of functions.
 */
export type SpecKind = "requirement" | "design";

export type SpecTarget = { kind: SpecKind; projectId: string; feature: string };

const requirementRoute = client["agent-requirement"][":projectId"][":feature"];
const designRoute = client["agent-design"][":projectId"][":feature"];

export type AgentSpecRevisionList = InferResponseType<
  (typeof requirementRoute)["revisions"]["$get"],
  200
>;
export type AgentSpecRevisionSummary =
  AgentSpecRevisionList["revisions"][number];
export type AgentSpecRevision = InferResponseType<
  (typeof requirementRoute)["revisions"][":revisionId"]["$get"],
  200
>;

export async function reviewAgentSpec({
  kind,
  projectId,
  feature,
}: SpecTarget) {
  const param = { projectId, feature };
  const response =
    kind === "requirement"
      ? await requirementRoute.review.$post({ param })
      : await designRoute.review.$post({ param });
  if (!response.ok) return throwAgentLayerError(response);
  return response.json();
}

export async function deleteAgentSpec({
  kind,
  projectId,
  feature,
}: SpecTarget) {
  const param = { projectId, feature };
  const response =
    kind === "requirement"
      ? await requirementRoute.$delete({ param })
      : await designRoute.$delete({ param });
  if (!response.ok) return throwAgentLayerError(response);
  return response.json();
}

export async function restoreAgentSpec({
  kind,
  projectId,
  feature,
}: SpecTarget) {
  const param = { projectId, feature };
  const response =
    kind === "requirement"
      ? await requirementRoute.restore.$post({ param })
      : await designRoute.restore.$post({ param });
  if (!response.ok) return throwAgentLayerError(response);
  return response.json();
}

export async function getAgentSpecRevisions({
  kind,
  projectId,
  feature,
}: SpecTarget): Promise<AgentSpecRevisionList> {
  const param = { projectId, feature };
  const response =
    kind === "requirement"
      ? await requirementRoute.revisions.$get({ param })
      : await designRoute.revisions.$get({ param });
  if (!response.ok) return throwAgentLayerError(response);
  return response.json();
}

export async function getAgentSpecRevision({
  kind,
  projectId,
  feature,
  revisionId,
}: SpecTarget & { revisionId: string }): Promise<AgentSpecRevision> {
  const param = { projectId, feature, revisionId };
  const response =
    kind === "requirement"
      ? await requirementRoute.revisions[":revisionId"].$get({ param })
      : await designRoute.revisions[":revisionId"].$get({ param });
  if (!response.ok) return throwAgentLayerError(response);
  return response.json();
}

export async function revertAgentSpec({
  kind,
  projectId,
  feature,
  revisionId,
}: SpecTarget & { revisionId: string }) {
  const param = { projectId, feature, revisionId };
  const response =
    kind === "requirement"
      ? await requirementRoute.revisions[":revisionId"].revert.$post({ param })
      : await designRoute.revisions[":revisionId"].revert.$post({ param });
  if (!response.ok) return throwAgentLayerError(response);
  return response.json();
}
