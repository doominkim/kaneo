import { type ActorColumns, toActorResponse } from "../actor-response";

/**
 * Shapes of the jsonb fields on `agent_entry`, as validated at the API edge.
 *
 * Drizzle types jsonb as `unknown`; these are the only places the columns are
 * cast, so a schema change here is a one-file change.
 */
export type EntryRefs = {
  repo?: string;
  branch?: string;
  commits?: string[];
  prs?: string[];
  files?: string[];
};

export type EntryUsage = {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  cacheReadTokens?: number;
};

type AuthorColumns = {
  id: string | null;
  name: string | null;
};

/**
 * The `actor`/`author` pair every entry response carries. Left joins hand back
 * all-null columns for the side that is not set, so presence is decided by the
 * joined id rather than by the entry's FK column: a `SET NULL`ed author is
 * reported as null instead of as a name-less object.
 *
 * The `actor` half is shared with documents, artifacts, and terms; `author` is
 * specific to entries, which are the only records a human can write directly.
 */
export function shapeAuthorship(
  actor: ActorColumns | null | undefined,
  author: AuthorColumns | null | undefined,
) {
  return {
    actor: toActorResponse(actor),
    author: author?.id ? { userId: author.id, name: author.name ?? "" } : null,
  };
}

/** The two refs a listing shows per row; null when refs carries neither. */
export function liftRefs(refs: EntryRefs | null | undefined) {
  return {
    repo: refs?.repo || null,
    branch: refs?.branch || null,
  };
}
