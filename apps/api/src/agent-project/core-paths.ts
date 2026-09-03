// picomatch@4 has no types; the reference pulls the local declaration into
// every program that compiles this file, including the web and libs
// typechecks that reach it through the typed client.
/// <reference path="../types/picomatch.d.ts" />
import picomatch from "picomatch";

/**
 * Deterministic "core change" judgment (DESIGN.md §6.2).
 *
 * A person defines glob patterns once per project; the server matches every
 * entry's `refs.files` against them at append time. The model never decides
 * what is core — that decision varying per session is exactly the drift this
 * layer exists to remove.
 */

export const MAX_CORE_PATHS = 50;
export const MAX_CORE_PATH_LENGTH = 200;

const WINDOWS_DRIVE = /^[A-Za-z]:[\\/]/;

/** `/x`, `\x` or `C:\x` — repo-relative is the only frame patterns share. */
export function isAbsolutePath(path: string) {
  return (
    path.startsWith("/") || path.startsWith("\\") || WINDOWS_DRIVE.test(path)
  );
}

function hasParentSegment(path: string) {
  return path.split(/[\\/]/).includes("..");
}

/**
 * Canonical repo-relative form, or null when the path cannot be one.
 *
 * Strips surrounding whitespace and any number of leading `./`. Absolute paths
 * and paths with a `..` segment return null rather than a guess: a pattern
 * must not be storable in that form, and a file in that form must never match.
 */
export function normalizeRelativePath(path: string): string | null {
  let out = path.trim();
  while (out.startsWith("./")) out = out.slice(2);
  if (out.length === 0) return null;
  if (isAbsolutePath(out) || hasParentSegment(out)) return null;
  return out;
}

export function isValidCorePattern(pattern: string) {
  return normalizeRelativePath(pattern) !== null;
}

/**
 * - `files` absent → `null`: nothing to judge.
 * - `files` present, no patterns → `[]`: judged, nothing can match.
 * - otherwise the normalized files that match at least one pattern, in input
 *   order, deduplicated. `dot: true` so `src/**` also covers `src/.env.example`.
 *
 * Files that fail normalization (absolute, `..`) are skipped, not rejected:
 * `refs.files` is free-form input from many clients, and a bad path costs the
 * judgment for that path only.
 */
export function judgeCoreChanged(
  files: readonly string[] | null | undefined,
  corePaths: readonly string[],
): string[] | null {
  if (!files) return null;
  if (corePaths.length === 0) return [];

  const isCore = picomatch([...corePaths], { dot: true });
  const matched = new Set<string>();
  for (const raw of files) {
    const file = normalizeRelativePath(raw);
    if (file !== null && isCore(file)) matched.add(file);
  }
  return [...matched];
}
