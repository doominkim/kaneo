import { and, eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { assertDomainsInWorkspace } from "../../agent-domain/controllers/domain-lookup";
import { loadActor } from "../../agent-entry/actor-response";
import db from "../../database";
import { agentTermTable } from "../../database/schema-agent-layer";
import { toTermRecord } from "./term-record";

/**
 * Files a term under a domain page, or unfiles it (null). Curating the
 * lexicon is the same gate as reviewing it (workspace:update): where a term
 * belongs is a statement about the workspace's vocabulary, not about the term
 * alone. Nothing else on the row changes — not the author, not the review.
 */
async function setTermDomain(
  workspaceId: string,
  termId: string,
  domainId: string | null,
) {
  if (domainId) {
    await assertDomainsInWorkspace(workspaceId, [domainId]);
  }

  const [updated] = await db
    .update(agentTermTable)
    .set({ domainId })
    .where(
      and(
        eq(agentTermTable.id, termId),
        eq(agentTermTable.workspaceId, workspaceId),
      ),
    )
    .returning();

  if (!updated) {
    throw new HTTPException(404, { message: "Term not found" });
  }

  return toTermRecord(updated, await loadActor(updated.actorId));
}

export default setTermDomain;
