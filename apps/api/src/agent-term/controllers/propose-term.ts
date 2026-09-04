import { and, eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { assertDomainsInWorkspace } from "../../agent-domain/controllers/domain-lookup";
import resolveActor from "../../agent-entry/controllers/resolve-actor";
import db from "../../database";
import { agentTermTable } from "../../database/schema-agent-layer";
import { toTermRecord } from "./term-record";

type ProposeInput = {
  workspaceId: string;
  canonical: string;
  definition?: string | null;
  aliases: string[];
  notToConfuseWith: string[];
  anchors: unknown[];
  sourceEntryId?: string | null;
  domainId?: string | null;
  ownerId: string;
  /** Both set by an agent caller, both absent for a person proposing in the UI. */
  provider?: string | null;
  model?: string | null;
};

/**
 * Adds a term as `proposed`. It never becomes `confirmed` here.
 *
 * Auto-confirming model output is how a lexicon dies: unreviewed entries pile
 * up, trust erodes, and an untrusted lexicon is worse than no lexicon — callers
 * stop checking the code because they got a confident answer.
 *
 * Attribution follows the ledger append, not the document write: `ownerId`
 * stays the human whose session made the call and `actorId` records the model
 * that wrote the proposal, so both halves of "whose Claude proposed this" are
 * on the row. A caller that sends no provider/model is a person, and the term
 * is stored with `actorId` NULL.
 */
async function proposeTerm(input: ProposeInput) {
  const [existing] = await db
    .select({
      id: agentTermTable.id,
      confidence: agentTermTable.confidence,
      rejectReason: agentTermTable.rejectReason,
    })
    .from(agentTermTable)
    .where(
      and(
        eq(agentTermTable.workspaceId, input.workspaceId),
        eq(agentTermTable.canonical, input.canonical),
      ),
    )
    .limit(1);

  if (existing) {
    // A rejected term replays the reason it was rejected. A bare conflict tells
    // the caller nothing it can act on, so the same word gets proposed again
    // every session; the reviewer's verdict is the only thing that stops that.
    throw new HTTPException(409, {
      message:
        existing.confidence === "disputed"
          ? `Term already exists and was rejected: ${input.canonical}${
              existing.rejectReason ? ` — ${existing.rejectReason}` : ""
            }`
          : `Term already exists: ${input.canonical}`,
    });
  }

  if (input.domainId) {
    await assertDomainsInWorkspace(input.workspaceId, [input.domainId]);
  }

  // Resolved, not trusted: the caller names a provider/model, and the actor row
  // it maps to is keyed by (workspace, this human, model) exactly as the ledger
  // does it. No caller can name someone else's actor.
  const actor =
    input.provider && input.model
      ? await resolveActor(
          input.workspaceId,
          input.ownerId,
          input.provider,
          input.model,
        )
      : null;

  const [created] = await db
    .insert(agentTermTable)
    .values({
      workspaceId: input.workspaceId,
      canonical: input.canonical,
      definition: input.definition ?? null,
      aliases: input.aliases,
      notToConfuseWith: input.notToConfuseWith,
      anchors: input.anchors,
      sourceEntryId: input.sourceEntryId ?? null,
      domainId: input.domainId ?? null,
      ownerId: input.ownerId,
      actorId: actor?.id ?? null,
      confidence: "proposed",
      state: "active",
    })
    .returning();

  if (!created) {
    throw new HTTPException(500, { message: "Failed to create term" });
  }

  // `resolveActor` already returned the row, so no second lookup is needed.
  return toTermRecord(
    created,
    actor
      ? {
          id: actor.id,
          provider: actor.provider,
          model: actor.model,
          onBehalfOf: actor.onBehalfOf,
        }
      : null,
  );
}

export default proposeTerm;
