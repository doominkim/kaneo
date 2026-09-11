import { and, asc, eq, inArray } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db, { schema } from "../../database";

type DbOrTx = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

export async function assertTasksInProject(
  projectId: string,
  taskIds: string[],
  database: DbOrTx = db,
) {
  if (taskIds.length === 0) return;
  const sortedTaskIds = [...taskIds].sort();
  const rows = await database
    .select({ id: schema.taskTable.id })
    .from(schema.taskTable)
    .where(
      and(
        eq(schema.taskTable.projectId, projectId),
        inArray(schema.taskTable.id, sortedTaskIds),
      ),
    )
    .orderBy(asc(schema.taskTable.id))
    .for("share");
  if (rows.length !== sortedTaskIds.length) {
    throw new HTTPException(400, {
      message: "Every taskId must belong to the ADR project",
    });
  }
}
