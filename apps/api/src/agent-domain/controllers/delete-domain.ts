import { count, eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../../database";
import {
  agentDocumentTable,
  agentDomainTable,
  agentProjectDomainTable,
  agentTermTable,
} from "../../database/schema-agent-layer";
import { requireDomainInWorkspace } from "./domain-lookup";

/**
 * Hard delete, refused while anything still points here. The links would
 * survive as SET NULL / CASCADE, but a page that silently unfiles twelve
 * terms and detaches three projects is exactly the kind of data loss the
 * refusal exists to make a person look at. The message carries the counts so
 * the person knows what to unlink.
 */
async function deleteDomain(workspaceId: string, domainId: string) {
  await requireDomainInWorkspace(workspaceId, domainId);

  const [[children], [terms], [documents], [projects]] = await Promise.all([
    db
      .select({ n: count() })
      .from(agentDomainTable)
      .where(eq(agentDomainTable.parentId, domainId)),
    db
      .select({ n: count() })
      .from(agentTermTable)
      .where(eq(agentTermTable.domainId, domainId)),
    db
      .select({ n: count() })
      .from(agentDocumentTable)
      .where(eq(agentDocumentTable.domainId, domainId)),
    db
      .select({ n: count() })
      .from(agentProjectDomainTable)
      .where(eq(agentProjectDomainTable.domainId, domainId)),
  ]);

  const blockers = [
    [children?.n ?? 0, "child page"],
    [terms?.n ?? 0, "term"],
    [documents?.n ?? 0, "document"],
    [projects?.n ?? 0, "project"],
  ] as const;
  const held = blockers.filter(([n]) => n > 0);
  if (held.length > 0) {
    const summary = held
      .map(([n, label]) => `${n} ${label}${n === 1 ? "" : "s"}`)
      .join(", ");
    throw new HTTPException(409, {
      message: `Domain still has ${summary}; move or unlink them first`,
    });
  }

  const [deleted] = await db
    .delete(agentDomainTable)
    .where(eq(agentDomainTable.id, domainId))
    .returning({ id: agentDomainTable.id, slug: agentDomainTable.slug });

  if (!deleted) {
    throw new HTTPException(404, { message: "Domain not found" });
  }
  return deleted;
}

export default deleteDomain;
