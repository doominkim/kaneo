import { and, eq, inArray } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../../database";
import { taskTable } from "../../database/schema";
import { agentDesignTable } from "../../database/schema-agent-layer";

export async function requireTaskInProject(projectId: string, taskId: string) {
  const [task] = await db
    .select({ id: taskTable.id })
    .from(taskTable)
    .where(and(eq(taskTable.id, taskId), eq(taskTable.projectId, projectId)))
    .limit(1);
  if (!task) {
    throw new HTTPException(400, {
      message: "taskId does not belong to this project",
    });
  }
  return task;
}

export async function resolveDesignsByFeature(
  projectId: string,
  features: string[],
) {
  const unique = [...new Set(features)];
  if (unique.length === 0) return [];
  const rows = await db
    .select()
    .from(agentDesignTable)
    .where(
      and(
        eq(agentDesignTable.projectId, projectId),
        inArray(agentDesignTable.feature, unique),
      ),
    );
  const found = new Set(rows.map((row) => row.feature));
  const missing = unique.filter((feature) => !found.has(feature));
  if (missing.length) {
    throw new HTTPException(400, {
      message: `Unknown designs: ${missing.join(", ")}`,
    });
  }
  return rows;
}
