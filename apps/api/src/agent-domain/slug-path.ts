import { DOMAIN_SLUG_PATTERN } from "./schema";

export const MAX_SLUG_PATH_DEPTH = 16;

type DomainRow = {
  id: string;
  parentId: string | null;
  slug: string;
};

/**
 * "billing/refunds" → ["billing", "refunds"]. Null when any segment is not a
 * valid slug, the path is empty, or it is deeper than a tree can sensibly be.
 * Leading/trailing slashes are tolerated because people type them.
 */
export function parseSlugPath(path: string): string[] | null {
  const segments = path
    .split("/")
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0);
  if (segments.length === 0 || segments.length > MAX_SLUG_PATH_DEPTH) {
    return null;
  }
  for (const segment of segments) {
    if (!DOMAIN_SLUG_PATTERN.test(segment)) return null;
  }
  return segments;
}

/**
 * Walks root → child over a flat listing. Pure so the MCP tool can resolve a
 * path from the tree it already fetched, and so it is testable without a
 * database. Returns the id of the last segment, or null when any step has no
 * match at that level.
 */
export function resolveSlugPath<T extends DomainRow>(
  domains: readonly T[],
  segments: readonly string[],
): T | null {
  let parentId: string | null = null;
  let current: T | null = null;
  for (const segment of segments) {
    const next =
      domains.find((d) => d.parentId === parentId && d.slug === segment) ??
      null;
    if (!next) return null;
    current = next;
    parentId = next.id;
  }
  return current;
}
