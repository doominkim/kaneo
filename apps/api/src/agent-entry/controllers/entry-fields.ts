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

/** The two refs a listing shows per row; null when refs carries neither. */
export function liftRefs(refs: EntryRefs | null | undefined) {
  return {
    repo: refs?.repo || null,
    branch: refs?.branch || null,
  };
}
