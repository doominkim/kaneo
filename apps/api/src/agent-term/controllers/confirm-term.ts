import { and, eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../../database";
import { agentTermTable } from "../../database/schema-agent-layer";

/**
 * Human review outcome. This is the only path from `proposed` to `confirmed`.
 *
 * Also stamps `lastVerifiedAt`, which the re-verification schedule reads: a term
 * that keeps surviving review earns a longer interval, one that keeps changing
 * gets checked more often.
 */
async function confirmTerm(
  workspaceId: string,
  termId: string,
  confidence: "confirmed" | "disputed",
) {
  const [updated] = await db
    .update(agentTermTable)
    .set({ confidence, lastVerifiedAt: new Date() })
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

  return {
    id: updated.id,
    canonical: updated.canonical,
    definition: updated.definition,
    aliases: (updated.aliases as string[] | null) ?? [],
    notToConfuseWith: (updated.notToConfuseWith as string[] | null) ?? [],
    anchors: updated.anchors ?? [],
    confidence: updated.confidence,
    state: updated.state,
    supersededBy: updated.supersededBy,
    lastVerifiedAt: updated.lastVerifiedAt,
    createdAt: updated.createdAt,
  };
}

export default confirmTerm;
