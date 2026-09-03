/**
 * Client-side mirror of apps/api/src/agent-project/core-paths.ts and the PUT
 * body limits. The server stays the authority; this only turns the textarea
 * into a body and reports per-line problems before the round trip.
 */
export const MAX_CORE_PATHS = 50;
export const MAX_CORE_PATH_LENGTH = 200;
export const THRESHOLD_RANGE = { min: 1, max: 500 } as const;
export const ARCHIVE_DAYS_RANGE = { min: 1, max: 365 } as const;

const WINDOWS_DRIVE = /^[A-Za-z]:[\\/]/;

export type CorePathIssue = {
  line: number;
  reason: "absolute" | "parent" | "tooLong";
};

export type ParsedCorePaths = {
  patterns: string[];
  issues: CorePathIssue[];
  tooMany: boolean;
};

function isAbsolutePath(path: string) {
  return (
    path.startsWith("/") || path.startsWith("\\") || WINDOWS_DRIVE.test(path)
  );
}

function hasParentSegment(path: string) {
  return path.split(/[\\/]/).includes("..");
}

/** Same normalisation the server applies on save: trim and strip leading `./`. */
export function normalizeCorePattern(raw: string) {
  let out = raw.trim();
  while (out.startsWith("./")) out = out.slice(2);
  return out;
}

/** One pattern per line; blank lines are skipped, duplicates collapse. */
export function parseCorePaths(text: string): ParsedCorePaths {
  const patterns: string[] = [];
  const issues: CorePathIssue[] = [];
  const seen = new Set<string>();

  text.split(/\r?\n/).forEach((rawLine, index) => {
    const line = index + 1;
    const pattern = normalizeCorePattern(rawLine);
    if (pattern.length === 0) return;
    if (pattern.length > MAX_CORE_PATH_LENGTH) {
      issues.push({ line, reason: "tooLong" });
      return;
    }
    if (isAbsolutePath(pattern)) {
      issues.push({ line, reason: "absolute" });
      return;
    }
    if (hasParentSegment(pattern)) {
      issues.push({ line, reason: "parent" });
      return;
    }
    if (seen.has(pattern)) return;
    seen.add(pattern);
    patterns.push(pattern);
  });

  return { patterns, issues, tooMany: patterns.length > MAX_CORE_PATHS };
}

export function isInRange(value: number, range: { min: number; max: number }) {
  return Number.isInteger(value) && value >= range.min && value <= range.max;
}
