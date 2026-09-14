import { and, desc, eq } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { HTTPException } from "hono/http-exception";
import { actorSelection, liftActor } from "../../agent-entry/actor-response";
import db from "../../database";
import { userTable } from "../../database/schema";
import {
  agentActorTable,
  agentSpecRevisionTable,
  type SpecRevisionItem,
} from "../../database/schema-agent-layer";
import type { Author } from "./shared";

export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** A revision belongs to exactly one requirement set or design. */
export type RevisionTarget = { setId: string } | { designId: string };

function targetCondition(target: RevisionTarget) {
  return "setId" in target
    ? eq(agentSpecRevisionTable.setId, target.setId)
    : eq(agentSpecRevisionTable.designId, target.designId);
}

/**
 * Appends one revision inside the save's transaction, so a document never
 * changes without its copy. Only called for saves whose content changed.
 */
export async function insertRevision(
  tx: Tx,
  input: {
    projectId: string;
    target: RevisionTarget;
    title: string;
    body: string;
    requirementKeys: string[] | null;
    /** The set's rows after the save; requirement revisions only. */
    items?: SpecRevisionItem[] | null;
    author: Author;
    revertedFromId?: string | null;
    createdAt: Date;
  },
) {
  await tx.insert(agentSpecRevisionTable).values({
    projectId: input.projectId,
    setId: "setId" in input.target ? input.target.setId : null,
    designId: "designId" in input.target ? input.target.designId : null,
    title: input.title,
    body: input.body,
    requirementKeys: input.requirementKeys,
    items: input.items ?? null,
    createdBy: "updatedBy" in input.author ? input.author.updatedBy : null,
    actorId: "actorId" in input.author ? input.author.actorId : null,
    revertedFromId: input.revertedFromId ?? null,
    createdAt: input.createdAt,
  });
}

const revisionAuthor = alias(userTable, "revision_author");

function revisionQuery() {
  return db
    .select({
      id: agentSpecRevisionTable.id,
      title: agentSpecRevisionTable.title,
      body: agentSpecRevisionTable.body,
      requirementKeys: agentSpecRevisionTable.requirementKeys,
      createdAt: agentSpecRevisionTable.createdAt,
      revertedFromId: agentSpecRevisionTable.revertedFromId,
      createdBy: agentSpecRevisionTable.createdBy,
      authorId: revisionAuthor.id,
      authorName: revisionAuthor.name,
      ...actorSelection,
    })
    .from(agentSpecRevisionTable)
    .leftJoin(
      revisionAuthor,
      eq(agentSpecRevisionTable.createdBy, revisionAuthor.id),
    )
    .leftJoin(
      agentActorTable,
      eq(agentSpecRevisionTable.actorId, agentActorTable.id),
    );
}

type RevisionRow = Awaited<ReturnType<typeof revisionQuery>>[number];

function shapeSummary(row: RevisionRow) {
  return {
    id: row.id,
    title: row.title,
    createdAt: row.createdAt,
    revertedFromId: row.revertedFromId,
    createdBy: row.createdBy,
    author: row.authorId
      ? { userId: row.authorId, name: row.authorName ?? "" }
      : null,
    actor: liftActor(row),
  };
}

/** Newest first. Bodies stay out of the listing; fetch one revision for it. */
export async function listRevisions(target: RevisionTarget) {
  const rows = await revisionQuery()
    .where(targetCondition(target))
    .orderBy(desc(agentSpecRevisionTable.createdAt));
  return rows.map(shapeSummary);
}

export async function getRevision(target: RevisionTarget, revisionId: string) {
  const [row] = await revisionQuery()
    .where(
      and(targetCondition(target), eq(agentSpecRevisionTable.id, revisionId)),
    )
    .limit(1);
  if (!row) {
    throw new HTTPException(404, { message: "Revision not found" });
  }
  return {
    ...shapeSummary(row),
    body: row.body,
    requirementKeys: row.requirementKeys ?? null,
  };
}

/**
 * What a revert needs from a revision, including the stored item rows that
 * the public revision response does not carry.
 */
export async function getRevisionContent(
  target: RevisionTarget,
  revisionId: string,
) {
  const [row] = await db
    .select({
      id: agentSpecRevisionTable.id,
      title: agentSpecRevisionTable.title,
      body: agentSpecRevisionTable.body,
      requirementKeys: agentSpecRevisionTable.requirementKeys,
      items: agentSpecRevisionTable.items,
    })
    .from(agentSpecRevisionTable)
    .where(
      and(targetCondition(target), eq(agentSpecRevisionTable.id, revisionId)),
    )
    .limit(1);
  if (!row) {
    throw new HTTPException(404, { message: "Revision not found" });
  }
  return row;
}

/** A set's rows as a revision stores them: seq order, content fields only. */
export function snapshotItems(
  rows: Array<SpecRevisionItem & { seq: number }>,
): SpecRevisionItem[] {
  return [...rows]
    .sort((a, b) => a.seq - b.seq || a.key.localeCompare(b.key))
    .map(({ key, text, layer, story, status }) => ({
      key,
      text,
      layer,
      story,
      status,
    }));
}
