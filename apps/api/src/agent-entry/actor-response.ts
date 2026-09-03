import { eq } from "drizzle-orm";
import db from "../database";
import { agentActorTable } from "../database/schema-agent-layer";
import { z } from "../openapi";

/**
 * The actor block every agent-written record carries.
 *
 * Actor identity lives on `agent_actor`; the records that reference it store
 * only `actor_id`. A bare id is useless to a reader — "who wrote this" has to
 * answer with the model string, not with a cuid — so every read path joins the
 * row in and ships this block beside the id.
 *
 * Deliberately NOT registered as a named OpenAPI component here: the entry
 * responses in `agent-entry/response.ts` derive the named `AgentActor`
 * component from this schema, and registering it twice would collide in the
 * generator's registry. This one inlines wherever it is used, exactly as
 * `agent-lease` already does with its own copy.
 *
 * `provider`/`model` are NOT NULL on the table, so the `?? ""` fallbacks below
 * only exist because a LEFT JOIN types them as nullable.
 */
export const actorResponseSchema = z.object({
  id: z.string(),
  provider: z.string(),
  model: z.string(),
  onBehalfOf: z.string().nullable(),
});

export type ActorResponse = z.infer<typeof actorResponseSchema>;

/**
 * Select fragment for a `leftJoin(agentActorTable, ...)`. Flat rather than
 * nested so a controller can keep its own explicit projection — the whole
 * point of these listings is that the selected columns are visible at the
 * call site.
 */
export const actorSelection = {
  actorId: agentActorTable.id,
  actorProvider: agentActorTable.provider,
  actorModel: agentActorTable.model,
  actorOnBehalfOf: agentActorTable.onBehalfOf,
};

export type ActorJoinRow = {
  actorId: string | null;
  actorProvider: string | null;
  actorModel: string | null;
  actorOnBehalfOf: string | null;
};

/** The joined actor columns under their own names, as a whole-row select gives them. */
export type ActorColumns = {
  id: string | null;
  provider: string | null;
  model: string | null;
  onBehalfOf: string | null;
};

/**
 * The one builder for the actor block. Every read path — entries, documents,
 * artifacts, terms — goes through here, so the field set and the LEFT JOIN
 * fallbacks are decided in a single place.
 *
 * Presence is decided by the joined id rather than by the referencing row's FK
 * column: an all-null join is reported as null instead of as an empty object.
 */
export function toActorResponse(
  actor: ActorColumns | null | undefined,
): ActorResponse | null {
  if (!actor?.id) return null;
  return {
    id: actor.id,
    provider: actor.provider ?? "",
    model: actor.model ?? "",
    onBehalfOf: actor.onBehalfOf ?? null,
  };
}

/** Lifts the prefixed join columns into the nested block. */
export function liftActor(row: ActorJoinRow): ActorResponse | null {
  return toActorResponse({
    id: row.actorId,
    provider: row.actorProvider,
    model: row.actorModel,
    onBehalfOf: row.actorOnBehalfOf,
  });
}

/**
 * One-row lookup for the write paths, which get their row back from
 * `returning()` and so have no join to lift from. Costs a query only when the
 * write was actually attributed to an agent.
 */
export async function loadActor(
  actorId: string | null,
): Promise<ActorResponse | null> {
  if (!actorId) return null;
  const [actor] = await db
    .select({
      id: agentActorTable.id,
      provider: agentActorTable.provider,
      model: agentActorTable.model,
      onBehalfOf: agentActorTable.onBehalfOf,
    })
    .from(agentActorTable)
    .where(eq(agentActorTable.id, actorId))
    .limit(1);
  return actor ?? null;
}
