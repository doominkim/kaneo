import { and, asc, eq } from "drizzle-orm";
import db from "../../database";
import { agentTermTable } from "../../database/schema-agent-layer";

type ListInput = {
  workspaceId: string;
  state?: string;
  confidence?: string;
  limit: number;
};

/** Lexicon listing, for the human review queue and the knowledge tab. */
async function listTerms(input: ListInput) {
  const conditions = [eq(agentTermTable.workspaceId, input.workspaceId)];
  if (input.state) conditions.push(eq(agentTermTable.state, input.state));
  if (input.confidence) {
    conditions.push(eq(agentTermTable.confidence, input.confidence));
  }

  const rows = await db
    .select()
    .from(agentTermTable)
    .where(and(...conditions))
    .orderBy(asc(agentTermTable.canonical))
    .limit(input.limit);

  return {
    terms: rows.map((row) => ({
      id: row.id,
      canonical: row.canonical,
      definition: row.definition,
      aliases: (row.aliases as string[] | null) ?? [],
      notToConfuseWith: (row.notToConfuseWith as string[] | null) ?? [],
      anchors: row.anchors ?? [],
      confidence: row.confidence,
      state: row.state,
      supersededBy: row.supersededBy,
      lastVerifiedAt: row.lastVerifiedAt,
      createdAt: row.createdAt,
    })),
  };
}

export default listTerms;
