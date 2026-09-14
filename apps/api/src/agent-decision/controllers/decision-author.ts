import { HTTPException } from "hono/http-exception";
import resolveActor from "../../agent-entry/controllers/resolve-actor";

export type DecisionAuthor =
  | { userId: string; actorId: null }
  | { userId: null; actorId: string };

export async function resolveDecisionAuthor(input: {
  workspaceId: string;
  userId: string;
  provider?: string;
  model?: string;
}): Promise<DecisionAuthor> {
  if (!input.provider || !input.model) {
    return { userId: input.userId, actorId: null };
  }
  const actor = await resolveActor(
    input.workspaceId,
    input.userId,
    input.provider,
    input.model,
  );
  if (!actor) {
    throw new HTTPException(500, { message: "Failed to resolve ADR actor" });
  }
  return { userId: null, actorId: actor.id };
}

export function creatorColumns(author: DecisionAuthor) {
  return {
    createdBy: author.userId,
    createdActorId: author.actorId,
    updatedBy: author.userId,
    updatedActorId: author.actorId,
  };
}

/**
 * An ADR is accepted the moment it is created (agent-autoapply). A person's
 * ADR is also reviewed by them; an agent's stays unreviewed until a person
 * marks it, and `acceptedBy` stays null because no person accepted it.
 */
export function acceptanceColumns(author: DecisionAuthor, now: Date) {
  return {
    status: "accepted",
    acceptedAt: now,
    acceptedBy: author.userId,
    reviewedAt: author.userId ? now : null,
    reviewedBy: author.userId,
  };
}
