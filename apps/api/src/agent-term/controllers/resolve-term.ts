import { and, eq, or, sql } from "drizzle-orm";
import db from "../../database";
import { agentTermTable } from "../../database/schema-agent-layer";

type TermRow = typeof agentTermTable.$inferSelect;

function shape(row: TermRow) {
  return {
    id: row.id,
    canonical: row.canonical,
    definition: row.definition,
    aliases: (row.aliases as string[] | null) ?? [],
    notToConfuseWith: (row.notToConfuseWith as string[] | null) ?? [],
    anchors: row.anchors ?? [],
    confidence: row.confidence,
    state: row.state,
    supersededBy: row.supersededBy,
    lastVerifiedAt: row.lastVerifiedAt,
    createdAt: row.createdAt,
  };
}

/**
 * Deterministic lookup. The same input always returns the same answer.
 *
 * No embedding, no ranking, no model judgement — that is the entire point.
 * A similarity search would hand back "five documents that look related" and
 * the caller would have to infer again, which is the failure this layer exists
 * to remove.
 *
 * `retired` rows are NOT filtered out: a tombstone carries real information
 * ("this is dead, look at X instead"). Hiding it invites the same dead concept
 * to be proposed again six months later.
 */
async function resolveTerm(workspaceId: string, term: string) {
  const normalized = term.trim();

  const rows = await db
    .select()
    .from(agentTermTable)
    .where(
      and(
        eq(agentTermTable.workspaceId, workspaceId),
        or(
          sql`lower(${agentTermTable.canonical}) = lower(${normalized})`,
          // Aliases are matched the same way as the canonical name (case- and
          // whitespace-insensitive), which jsonb containment cannot express.
          sql`exists (
            select 1
            from jsonb_array_elements_text(coalesce(${agentTermTable.aliases}, '[]'::jsonb)) as alias(value)
            where lower(trim(alias.value)) = lower(${normalized})
          )`,
        ),
      ),
    );

  if (rows.length === 0) {
    return { match: "none" as const, term: null, ambiguous: [] };
  }

  const canonicalHit = rows.find(
    (r) => r.canonical.toLowerCase() === normalized.toLowerCase(),
  );
  const hit = canonicalHit ?? rows[0];

  // Retrieval counters feed the decay model that ships later. They are written
  // from day one because adding them afterwards leaves no history to decay against.
  if (hit) {
    await db
      .update(agentTermTable)
      .set({
        lastAccessedAt: new Date(),
        accessCount: sql`${agentTermTable.accessCount} + 1`,
      })
      .where(eq(agentTermTable.id, hit.id));
  }

  return {
    match: canonicalHit ? ("canonical" as const) : ("alias" as const),
    term: hit ? shape(hit) : null,
    // More than one match means a human must decide. The layer does not guess.
    ambiguous: rows.length > 1 ? rows.map(shape) : [],
  };
}

export default resolveTerm;
