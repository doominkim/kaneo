import { and, asc, eq, isNull } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { assertDomainsInWorkspace } from "../../agent-domain/controllers/domain-lookup";
import { actorSelection, liftActor } from "../../agent-entry/actor-response";
import db from "../../database";
import { userTable } from "../../database/schema";
import {
  agentActorTable,
  agentTermTable,
} from "../../database/schema-agent-layer";
import { NO_DOMAIN_FILTER } from "../schema";
import { liftReviewer, toTermRecord } from "./term-record";

type ListInput = {
  workspaceId: string;
  state?: string;
  confidence?: string;
  /** An exact domain page id, or NO_DOMAIN_FILTER for the unfiled rows. */
  domainId?: string;
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
  if (input.domainId === NO_DOMAIN_FILTER) {
    conditions.push(isNull(agentTermTable.domainId));
  } else if (input.domainId) {
    // Empty means unspecified, as it does on resolve's projectId: a caller
    // building the query string from an unset value asked for no narrowing.
    // An unknown or foreign id is a 400 rather than an empty page, which would
    // read exactly like a page with nothing filed under it.
    await assertDomainsInWorkspace(input.workspaceId, [input.domainId]);
    conditions.push(eq(agentTermTable.domainId, input.domainId));
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
