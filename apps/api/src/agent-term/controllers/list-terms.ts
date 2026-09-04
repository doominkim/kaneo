import { and, asc, eq } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { actorSelection, liftActor } from "../../agent-entry/actor-response";
import db from "../../database";
import { userTable } from "../../database/schema";
import {
  agentActorTable,
  agentTermTable,
} from "../../database/schema-agent-layer";
import { liftReviewer, toTermRecord } from "./term-record";

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
 *
 * The reviewer comes from `user`, joined once and under an alias only so the
 * selected columns read as the reviewer's rather than as bare `user` columns
 * next to the actor's. Nothing forces the alias — the other join is on
 * `agent_actor` — so dropping it would still be valid SQL.
 */
async function listTerms(input: ListInput) {
  const conditions = [eq(agentTermTable.workspaceId, input.workspaceId)];
  if (input.state) conditions.push(eq(agentTermTable.state, input.state));
  if (input.confidence) {
    conditions.push(eq(agentTermTable.confidence, input.confidence));
  }

  const reviewerUser = alias(userTable, "reviewer_user");
  const rows = await db
    .select({
      term: agentTermTable,
      ...actorSelection,
      reviewerUserId: reviewerUser.id,
      reviewerName: reviewerUser.name,
    })
    .from(agentTermTable)
    .leftJoin(agentActorTable, eq(agentTermTable.actorId, agentActorTable.id))
    .leftJoin(reviewerUser, eq(agentTermTable.reviewerId, reviewerUser.id))
    .where(and(...conditions))
    .orderBy(asc(agentTermTable.canonical))
    .limit(input.limit);

  return {
    terms: rows.map((row) =>
      toTermRecord(row.term, liftActor(row), liftReviewer(row)),
    ),
  };
}

export default listTerms;
