import { and, eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../../database";
import { agentTermTable } from "../../database/schema-agent-layer";

type ProposeInput = {
  workspaceId: string;
  canonical: string;
  definition?: string | null;
  aliases: string[];
  notToConfuseWith: string[];
  anchors: unknown[];
  sourceEntryId?: string | null;
  ownerId: string;
};

/**
 * Adds a term as `proposed`. It never becomes `confirmed` here.
 *
 * Auto-confirming model output is how a lexicon dies: unreviewed entries pile
 * up, trust erodes, and an untrusted lexicon is worse than no lexicon — callers
 * stop checking the code because they got a confident answer.
 */
async function proposeTerm(input: ProposeInput) {
  const [existing] = await db
    .select({ id: agentTermTable.id })
    .from(agentTermTable)
    .where(
      and(
        eq(agentTermTable.workspaceId, input.workspaceId),
        eq(agentTermTable.canonical, input.canonical),
      ),
    )
    .limit(1);

  if (existing) {
    throw new HTTPException(409, {
      message: `Term already exists: ${input.canonical}`,
    });
  }

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
      ownerId: input.ownerId,
      confidence: "proposed",
      state: "active",
    })
    .returning();

  if (!created) {
    throw new HTTPException(500, { message: "Failed to create term" });
  }

  return {
    id: created.id,
    canonical: created.canonical,
    definition: created.definition,
    aliases: (created.aliases as string[] | null) ?? [],
    notToConfuseWith: (created.notToConfuseWith as string[] | null) ?? [],
    anchors: created.anchors ?? [],
    confidence: created.confidence,
    state: created.state,
    supersededBy: created.supersededBy,
    lastVerifiedAt: created.lastVerifiedAt,
    createdAt: created.createdAt,
  };
}

export default proposeTerm;
