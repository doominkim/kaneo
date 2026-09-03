import { eq } from "drizzle-orm";
import {
  type ActorResponse,
  loadActor,
} from "../../agent-entry/actor-response";
import db, { schema } from "../../database";
import type { AgentDomain } from "../../database/schema-agent-layer";

export type DomainAuthor = { userId: string; name: string } | null;

/**
 * The public page shape without aggregates, in one place — five controllers
 * answer with it. `author` is the human's id and display name only.
 */
export function toDomainRecord(
  row: AgentDomain,
  author: DomainAuthor,
  actor: ActorResponse | null,
) {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    parentId: row.parentId,
    slug: row.slug,
    title: row.title,
    body: row.body,
    position: row.position,
    updatedBy: row.updatedBy,
    actorId: row.actorId,
    author,
    actor,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export async function loadAuthor(userId: string | null): Promise<DomainAuthor> {
  if (!userId) return null;
  const [user] = await db
    .select({ id: schema.userTable.id, name: schema.userTable.name })
    .from(schema.userTable)
    .where(eq(schema.userTable.id, userId))
    .limit(1);
  return user ? { userId: user.id, name: user.name } : null;
}

/** For the write paths, which get their row from `returning()` with no join. */
export async function withAuthors(row: AgentDomain) {
  const [author, actor] = await Promise.all([
    loadAuthor(row.updatedBy),
    loadActor(row.actorId),
  ]);
  return toDomainRecord(row, author, actor);
}

export type DomainRecord = ReturnType<typeof toDomainRecord>;
