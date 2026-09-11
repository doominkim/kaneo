type PgError = { code?: unknown; constraint?: unknown; cause?: unknown };

export function isConstraintError(
  error: unknown,
  code: string,
  constraint: string,
) {
  let current: unknown = error;
  for (
    let depth = 0;
    depth < 3 && current && typeof current === "object";
    depth += 1
  ) {
    const value = current as PgError;
    if (value.code === code && value.constraint === constraint) return true;
    current = value.cause;
  }
  return false;
}

export function isDecisionTaskForeignKeyError(error: unknown) {
  return isConstraintError(
    error,
    "23503",
    "agent_decision_task_task_id_task_id_fk",
  );
}
