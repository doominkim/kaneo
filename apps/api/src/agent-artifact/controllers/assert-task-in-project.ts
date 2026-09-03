import { and, eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db, { schema } from "../../database";

/**
 * A linked task must live in the project the route authorized; a task id from
 * another project would let the artifact hang under a tree the caller may not
 * be allowed to see. A missing/null id is fine — the link is optional.
 */
export async function assertTaskInProject(
  projectId: string,
  taskId: string | null | undefined,
) {
  if (!taskId) return;
  const [task] = await db
    .select({ id: schema.taskTable.id })
    .from(schema.taskTable)
    .where(
      and(
        eq(schema.taskTable.id, taskId),
        eq(schema.taskTable.projectId, projectId),
      ),
    )
    .limit(1);
  if (!task) {
    throw new HTTPException(400, {
      message: "taskId does not belong to this project",
    });
  }
}
