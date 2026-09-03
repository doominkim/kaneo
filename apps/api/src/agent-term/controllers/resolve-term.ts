import { and, eq, or, sql } from "drizzle-orm";
import { actorSelection, liftActor } from "../../agent-entry/actor-response";
import db from "../../database";
import {
  agentActorTable,
  agentTermTable,
} from "../../database/schema-agent-layer";
import { toTermRecord } from "./term-record";

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
 *
 * The proposing actor rides along on every returned term, including the
 * `ambiguous` list: when a human has to disambiguate, "which model proposed
 * each of these" is part of what they are deciding on.
 */
async function resolveTerm(workspaceId: string, term: string) {
  const normalized = term.trim();

  const rows = await db
    .select({ term: agentTermTable, ...actorSelection })
    .from(agentTermTable)
    .leftJoin(agentActorTable, eq(agentTermTable.actorId, agentActorTable.id))
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
    (r) => r.term.canonical.toLowerCase() === normalized.toLowerCase(),
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
      .where(eq(agentTermTable.id, hit.term.id));
  }

  const shape = (row: (typeof rows)[number]) =>
    toTermRecord(row.term, liftActor(row));

  return {
    match: canonicalHit ? ("canonical" as const) : ("alias" as const),
    term: hit ? shape(hit) : null,
    // More than one match means a human must decide. The layer does not guess.
    ambiguous: rows.length > 1 ? rows.map(shape) : [],
  };
}

export default resolveTerm;
