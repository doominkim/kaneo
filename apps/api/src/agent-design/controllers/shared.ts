import { and, eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../../database";
import { agentDesignTable } from "../../database/schema-agent-layer";

export async function findDesign(projectId: string, feature: string) {
  const [design] = await db
    .select()
    .from(agentDesignTable)
    .where(
      and(
        eq(agentDesignTable.projectId, projectId),
        eq(agentDesignTable.feature, feature),
      ),
    )
    .limit(1);
  return design ?? null;
}

export async function requireDesign(projectId: string, feature: string) {
  const design = await findDesign(projectId, feature);
  if (!design) throw new HTTPException(404, { message: "Design not found" });
  return design;
}
