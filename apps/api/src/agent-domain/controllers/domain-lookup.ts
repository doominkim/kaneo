import { and, eq, inArray } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../../database";
import { agentDomainTable } from "../../database/schema-agent-layer";

/** Bound on the ancestor walk; a tree deeper than this is a bug, not a page. */
export const MAX_TREE_DEPTH = 64;

export async function findDomainInWorkspace(
  workspaceId: string,
  domainId: string,
) {
  const [row] = await db
    .select()
    .from(agentDomainTable)
    .where(
      and(
        eq(agentDomainTable.id, domainId),
        eq(agentDomainTable.workspaceId, workspaceId),
      ),
    )
    .limit(1);
  return row ?? null;
}

/** 404 when the page is not in this workspace — a foreign id reads as absent. */
export async function requireDomainInWorkspace(
  workspaceId: string,
  domainId: string,
) {
  const row = await findDomainInWorkspace(workspaceId, domainId);
  if (!row) {
    throw new HTTPException(404, { message: "Domain not found" });
  }
  return row;
}

/**
 * The shared "must be a page in this workspace" check for links: a parent
 * on create, `domainId` on a term or document, `domainIds` on project
 * settings. A foreign or unknown id is a 400 (bad input), not a 404 — the
 * request's own resource exists, only the reference is wrong.
 */
export async function assertDomainsInWorkspace(
  workspaceId: string,
  domainIds: readonly string[],
  message = "domainId does not belong to this workspace",
) {
  if (domainIds.length === 0) return;
  const rows = await db
    .select({ id: agentDomainTable.id })
    .from(agentDomainTable)
    .where(
      and(
        eq(agentDomainTable.workspaceId, workspaceId),
        inArray(agentDomainTable.id, [...domainIds]),
      ),
    );
  const found = new Set(rows.map((row) => row.id));
  if (domainIds.some((id) => !found.has(id))) {
    throw new HTTPException(400, { message });
  }
}

/**
 * Root first, immediate parent last. Walks one parent per query; the depth
 * bound makes a corrupted (cyclic) tree terminate instead of spinning.
 */
export async function loadAncestors(
  workspaceId: string,
  parentId: string | null,
) {
  const ancestors: Array<{ id: string; slug: string; title: string }> = [];
  let cursor = parentId;
  for (let depth = 0; cursor && depth < MAX_TREE_DEPTH; depth += 1) {
    const [row] = await db
      .select({
        id: agentDomainTable.id,
        slug: agentDomainTable.slug,
        title: agentDomainTable.title,
        parentId: agentDomainTable.parentId,
      })
      .from(agentDomainTable)
      .where(
        and(
          eq(agentDomainTable.id, cursor),
          eq(agentDomainTable.workspaceId, workspaceId),
        ),
      )
      .limit(1);
    if (!row) break;
    ancestors.unshift({ id: row.id, slug: row.slug, title: row.title });
    cursor = row.parentId;
  }
  return ancestors;
}
