import { and, eq, isNotNull, isNull } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import appendEntry from "../../agent-entry/controllers/append-entry";
import db from "../../database";
import { agentRequirementSetTable } from "../../database/schema-agent-layer";
import getSet from "./get-set";
import putSet from "./put-set";
import { requireSet } from "./shared";
import { getRevision, listRevisions } from "./spec-revision";

/*
 * The human side of an auto-applied requirement set (agent-autoapply):
 * review, soft delete and restore, and the revision history a wrong write is
 * undone from. The routes refuse API keys before calling any of these.
 */

function byFeature(projectId: string, feature: string) {
  return and(
    eq(agentRequirementSetTable.projectId, projectId),
    eq(agentRequirementSetTable.feature, feature),
  );
}

function notFound() {
  return new HTTPException(404, { message: "Requirement set not found" });
}

/** No timeline entry: reading a document changes nothing about it. */
export async function reviewSet(input: {
  projectId: string;
  feature: string;
  userId: string;
}) {
  const reviewedAt = new Date();
  const [row] = await db
    .update(agentRequirementSetTable)
    .set({ reviewedAt, reviewedBy: input.userId })
    .where(
      and(
        byFeature(input.projectId, input.feature),
        isNull(agentRequirementSetTable.deletedAt),
      ),
    )
    .returning({
      id: agentRequirementSetTable.id,
      feature: agentRequirementSetTable.feature,
    });
  if (!row) throw notFound();
  return { ...row, reviewedAt, reviewedBy: input.userId };
}

/**
 * Soft delete. The predicate repeats `deleted_at IS NULL` so two concurrent
 * deletes cannot both win. Items, design links, task links and revisions stay
 * untouched; reads hide them while the set is deleted.
 */
export async function deleteSet(input: {
  workspaceId: string;
  projectId: string;
  feature: string;
  userId: string;
}) {
  const deletedAt = new Date();
  const [row] = await db
    .update(agentRequirementSetTable)
    .set({ deletedAt, deletedBy: input.userId })
    .where(
      and(
        byFeature(input.projectId, input.feature),
        isNull(agentRequirementSetTable.deletedAt),
      ),
    )
    .returning({
      id: agentRequirementSetTable.id,
      feature: agentRequirementSetTable.feature,
    });
  if (!row) throw notFound();
  await appendEntry({
    workspaceId: input.workspaceId,
    userId: input.userId,
    projectId: input.projectId,
    kind: "work",
    summary: `[requirements:${input.feature}] 요구사항 문서 삭제`,
  });
  return { ...row, deletedAt, deletedBy: input.userId };
}

/** A set that is not deleted is "not found", so a double restore reports it did nothing. */
export async function restoreSet(input: {
  workspaceId: string;
  projectId: string;
  feature: string;
  userId: string;
}) {
  const [row] = await db
    .update(agentRequirementSetTable)
    .set({ deletedAt: null, deletedBy: null })
    .where(
      and(
        byFeature(input.projectId, input.feature),
        isNotNull(agentRequirementSetTable.deletedAt),
      ),
    )
    .returning({ id: agentRequirementSetTable.id });
  if (!row) throw notFound();
  await appendEntry({
    workspaceId: input.workspaceId,
    userId: input.userId,
    projectId: input.projectId,
    kind: "work",
    summary: `[requirements:${input.feature}] 요구사항 문서 복구`,
  });
  return getSet(input.projectId, input.feature);
}

export async function listSetRevisions(projectId: string, feature: string) {
  const set = await requireSet(projectId, feature);
  return { revisions: await listRevisions({ setId: set.id }) };
}

export async function getSetRevision(
  projectId: string,
  feature: string,
  revisionId: string,
) {
  const set = await requireSet(projectId, feature);
  return getRevision({ setId: set.id }, revisionId);
}

/**
 * Restores a revision by saving its title and body through the ordinary save
 * path as the calling person, so keys, dropped lines, item clocks and design
 * staleness follow exactly as for a hand-written save. The new revision
 * records where it came from; restoring content identical to the current one
 * changes nothing, like any identical save.
 */
export async function revertSet(input: {
  workspaceId: string;
  projectId: string;
  feature: string;
  revisionId: string;
  userId: string;
}) {
  const set = await requireSet(input.projectId, input.feature);
  const revision = await getRevision({ setId: set.id }, input.revisionId);
  await putSet({
    workspaceId: input.workspaceId,
    projectId: input.projectId,
    feature: input.feature,
    title: revision.title,
    body: revision.body,
    items: [],
    author: { updatedBy: input.userId },
    entryAuthor: { userId: input.userId },
    revertedFromId: revision.id,
  });
  return getSet(input.projectId, input.feature);
}
