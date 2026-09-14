import { and, eq, isNotNull, isNull } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import appendEntry from "../../agent-entry/controllers/append-entry";
import {
  getRevision,
  listRevisions,
} from "../../agent-requirement/controllers/spec-revision";
import db from "../../database";
import { agentDesignTable } from "../../database/schema-agent-layer";
import getDesign from "./get-design";
import putDesign from "./put-design";
import { requireDesign } from "./shared";

/*
 * The human side of an auto-applied design (agent-autoapply), mirroring
 * `agent-requirement/controllers/set-lifecycle.ts`. The routes refuse API keys
 * before calling any of these.
 */

function byFeature(projectId: string, feature: string) {
  return and(
    eq(agentDesignTable.projectId, projectId),
    eq(agentDesignTable.feature, feature),
  );
}

function notFound() {
  return new HTTPException(404, { message: "Design not found" });
}

export async function reviewDesign(input: {
  projectId: string;
  feature: string;
  userId: string;
}) {
  const reviewedAt = new Date();
  const [row] = await db
    .update(agentDesignTable)
    .set({ reviewedAt, reviewedBy: input.userId })
    .where(
      and(
        byFeature(input.projectId, input.feature),
        isNull(agentDesignTable.deletedAt),
      ),
    )
    .returning({ id: agentDesignTable.id, feature: agentDesignTable.feature });
  if (!row) throw notFound();
  return { ...row, reviewedAt, reviewedBy: input.userId };
}

/** Soft delete; requirement links, task links and revisions are kept and hidden. */
export async function deleteDesign(input: {
  workspaceId: string;
  projectId: string;
  feature: string;
  userId: string;
}) {
  const deletedAt = new Date();
  const [row] = await db
    .update(agentDesignTable)
    .set({ deletedAt, deletedBy: input.userId })
    .where(
      and(
        byFeature(input.projectId, input.feature),
        isNull(agentDesignTable.deletedAt),
      ),
    )
    .returning({ id: agentDesignTable.id, feature: agentDesignTable.feature });
  if (!row) throw notFound();
  await appendEntry({
    workspaceId: input.workspaceId,
    userId: input.userId,
    projectId: input.projectId,
    kind: "work",
    summary: `[design:${input.feature}] 설계 문서 삭제`,
  });
  return { ...row, deletedAt, deletedBy: input.userId };
}

export async function restoreDesign(input: {
  workspaceId: string;
  projectId: string;
  feature: string;
  userId: string;
}) {
  const [row] = await db
    .update(agentDesignTable)
    .set({ deletedAt: null, deletedBy: null })
    .where(
      and(
        byFeature(input.projectId, input.feature),
        isNotNull(agentDesignTable.deletedAt),
      ),
    )
    .returning({ id: agentDesignTable.id });
  if (!row) throw notFound();
  await appendEntry({
    workspaceId: input.workspaceId,
    userId: input.userId,
    projectId: input.projectId,
    kind: "work",
    summary: `[design:${input.feature}] 설계 문서 복구`,
  });
  return getDesign(input.projectId, input.feature);
}

export async function listDesignRevisions(projectId: string, feature: string) {
  const design = await requireDesign(projectId, feature);
  return { revisions: await listRevisions({ designId: design.id }) };
}

export async function getDesignRevision(
  projectId: string,
  feature: string,
  revisionId: string,
) {
  const design = await requireDesign(projectId, feature);
  return getRevision({ designId: design.id }, revisionId);
}

/**
 * Saves the revision's title, body and covered keys through the normal save
 * as the calling person, recording `revertedFromId` on the new revision. A key
 * whose requirement set has since been deleted is a 400, as on any save.
 */
export async function revertDesign(input: {
  workspaceId: string;
  projectId: string;
  feature: string;
  revisionId: string;
  userId: string;
}) {
  const design = await requireDesign(input.projectId, input.feature);
  const revision = await getRevision({ designId: design.id }, input.revisionId);
  await putDesign({
    workspaceId: input.workspaceId,
    projectId: input.projectId,
    feature: input.feature,
    title: revision.title,
    body: revision.body,
    requirementKeys: revision.requirementKeys ?? undefined,
    author: { updatedBy: input.userId },
    entryAuthor: { userId: input.userId },
    revertedFromId: revision.id,
  });
  return getDesign(input.projectId, input.feature);
}
