import { and, asc, eq } from "drizzle-orm";
import { actorSelection, liftActor } from "../../agent-entry/actor-response";
import db from "../../database";
import {
  agentActorTable,
  agentTermTable,
} from "../../database/schema-agent-layer";
import { toTermRecord } from "./term-record";

type ListInput = {
  workspaceId: string;
  state?: string;
  confidence?: string;
  limit: number;
};

/**
 * Lexicon listing, for the human review queue and the knowledge tab.
 *
 * The proposing actor is joined in because the review queue is where it
 * matters most: a reviewer decides differently depending on which model wrote
 * the proposal, and a bare `actorId` does not tell them.
 */
async function listTerms(input: ListInput) {
  const conditions = [eq(agentTermTable.workspaceId, input.workspaceId)];
  if (input.state) conditions.push(eq(agentTermTable.state, input.state));
  if (input.confidence) {
    conditions.push(eq(agentTermTable.confidence, input.confidence));
  }

  const rows = await db
    .select({ term: agentTermTable, ...actorSelection })
    .from(agentTermTable)
    .leftJoin(agentActorTable, eq(agentTermTable.actorId, agentActorTable.id))
    .where(and(...conditions))
    .orderBy(asc(agentTermTable.canonical))
    .limit(input.limit);

  return { terms: rows.map((row) => toTermRecord(row.term, liftActor(row))) };
}

export default listTerms;
