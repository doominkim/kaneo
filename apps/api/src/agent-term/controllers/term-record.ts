import type { ActorResponse } from "../../agent-entry/actor-response";
import type { AgentTerm } from "../../database/schema-agent-layer";

/**
 * The public term shape, in one place.
 *
 * Four controllers (propose, confirm, list, resolve) all answer with a term,
 * and they used to carry four copies of this projection. A field added to one
 * copy and not the others is a silent contract break, so they share this one.
 *
 * `anchors`/`aliases`/`notToConfuseWith` are jsonb, which Drizzle types as
 * `unknown`; this is the only place they are cast.
 */
export function toTermRecord(row: AgentTerm, actor: ActorResponse | null) {
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
    domainId: row.domainId,
    actorId: row.actorId,
    actor,
    lastVerifiedAt: row.lastVerifiedAt,
    createdAt: row.createdAt,
  };
}

export type TermRecord = ReturnType<typeof toTermRecord>;
