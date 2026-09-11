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

export function editorColumns(author: DecisionAuthor) {
  return {
    updatedBy: author.userId,
    updatedActorId: author.actorId,
  };
}
