import { and, eq, isNull, max } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../../database";
import { agentDomainTable } from "../../database/schema-agent-layer";
import { assertDomainsInWorkspace } from "./domain-lookup";
import { withAuthors } from "./domain-record";
import { isDomainSlugViolation } from "./is-domain-unique-violation";

export type DomainAuthorInput = { updatedBy: string } | { actorId: string };

type CreateInput = {
  workspaceId: string;
  parentId?: string | null;
  slug: string;
  title: string;
  body: string;
  /** Exactly one of these is set; the other is written as NULL. */
  author: DomainAuthorInput;
};

export function authorColumns(author: DomainAuthorInput) {
  return "updatedBy" in author
    ? { updatedBy: author.updatedBy, actorId: null }
    : { updatedBy: null, actorId: author.actorId };
}

/**
 * New page under `parentId` (or at the root). The slug conflict is left to
 * the database: two concurrent creates of the same slug must not both pass a
 * pre-check, and the unique constraints already say exactly what is allowed.
 * The new page goes last among its siblings so creation order is kept.
 */
async function createDomain(input: CreateInput) {
  const parentId = input.parentId ?? null;
  if (parentId) {
    await assertDomainsInWorkspace(
      input.workspaceId,
      [parentId],
      "parentId does not belong to this workspace",
    );
  }

  const [sibling] = await db
    .select({ position: max(agentDomainTable.position) })
    .from(agentDomainTable)
    .where(
      and(
        eq(agentDomainTable.workspaceId, input.workspaceId),
        parentId
          ? eq(agentDomainTable.parentId, parentId)
          : isNull(agentDomainTable.parentId),
      ),
    );
  const position =
    sibling?.position === null ? 0 : (sibling?.position ?? -1) + 1;

  const now = new Date();
  let created: typeof agentDomainTable.$inferSelect | undefined;
  try {
    [created] = await db
      .insert(agentDomainTable)
      .values({
        workspaceId: input.workspaceId,
        parentId,
        slug: input.slug,
        title: input.title,
        body: input.body,
        position,
        ...authorColumns(input.author),
        createdAt: now,
        updatedAt: now,
      })
      .returning();
  } catch (error) {
    if (isDomainSlugViolation(error)) {
      throw new HTTPException(409, {
        message: `A page with slug "${input.slug}" already exists at this level`,
      });
    }
    throw error;
  }

  if (!created) {
    throw new HTTPException(500, { message: "Failed to create domain" });
  }
  return withAuthors(created);
}

export default createDomain;
