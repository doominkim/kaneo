const UNIQUE_VIOLATION = "23505";
const SLUG_CONSTRAINTS = new Set([
  "agent_domain_workspace_parent_slug_unique",
  "agent_domain_workspace_root_slug_unique",
]);

type PgErrorLike = { code?: unknown; constraint?: unknown; cause?: unknown };

/**
 * True for a PostgreSQL unique violation on one of the two per-level slug
 * constraints (composite for child pages, partial index for root pages).
 * drizzle-orm wraps driver errors, so the wrapper and the cause are both
 * inspected. Any other unique violation stays a 500 — it would be a bug.
 */
export function isDomainSlugViolation(error: unknown): boolean {
  let current: unknown = error;
  for (
    let depth = 0;
    depth < 3 && current && typeof current === "object";
    depth += 1
  ) {
    const candidate = current as PgErrorLike;
    if (
      candidate.code === UNIQUE_VIOLATION &&
      typeof candidate.constraint === "string" &&
      SLUG_CONSTRAINTS.has(candidate.constraint)
    ) {
      return true;
    }
    current = candidate.cause;
  }
  return false;
}
