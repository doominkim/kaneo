const FOREIGN_KEY_VIOLATION = "23503";
const TASK_FK_CONSTRAINT = "agent_document_task_id_task_id_fk";

type PgErrorLike = { code?: unknown; constraint?: unknown; cause?: unknown };

/**
 * True for a PostgreSQL foreign-key violation on `agent_document.task_id`.
 *
 * drizzle-orm wraps driver errors in `DrizzleQueryError` with the pg error as
 * `cause`, so both the wrapper and the raw error are inspected. Only the task
 * constraint is matched: a violation on workspace/project/user/actor would be
 * a different bug and must stay a 500.
 */
export function isTaskForeignKeyViolation(error: unknown): boolean {
  let current: unknown = error;
  for (
    let depth = 0;
    depth < 3 && current && typeof current === "object";
    depth += 1
  ) {
    const candidate = current as PgErrorLike;
    if (
      candidate.code === FOREIGN_KEY_VIOLATION &&
      candidate.constraint === TASK_FK_CONSTRAINT
    ) {
      return true;
    }
    current = candidate.cause;
  }
  return false;
}
