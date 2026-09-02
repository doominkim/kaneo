/**
 * Pure rules for artifacts: which MIME types are accepted, how a display name
 * becomes a storage key segment, and how a download is presented. Kept free of
 * I/O so they can be unit-tested and reasoned about without S3.
 */

export const MAX_ARTIFACT_BYTES = 10 * 1024 * 1024;
export const MAX_ARTIFACT_NAME_LENGTH = 200;
export const ARTIFACT_KEY_ROOT = "agent-artifacts";

/**
 * Exact allowlist (DESIGN.md §10-8). Compared case-insensitively; parameters
 * such as `; charset=utf-8` are NOT accepted, so the stored value is always one
 * of these literals and `response-content-type` can be pinned to it verbatim.
 */
export const ALLOWED_ARTIFACT_CONTENT_TYPES = [
  "text/html",
  "text/markdown",
  "text/plain",
  "application/json",
  "application/pdf",
  "application/zip",
] as const;

export type ArtifactContentType =
  (typeof ALLOWED_ARTIFACT_CONTENT_TYPES)[number];

export type Disposition = "inline" | "attachment";

/**
 * Types a browser may render inline. `application/zip` is deliberately absent:
 * there is nothing to render, and forcing `attachment` keeps a click from
 * ever handing an archive to a browser plugin.
 */
const INLINE_CAPABLE = new Set<ArtifactContentType>([
  "text/html",
  "text/markdown",
  "text/plain",
  "application/json",
  "application/pdf",
]);

export function normalizeArtifactContentType(
  value: string,
): ArtifactContentType | null {
  const normalized = value.trim().toLowerCase();
  return (ALLOWED_ARTIFACT_CONTENT_TYPES as readonly string[]).includes(
    normalized,
  )
    ? (normalized as ArtifactContentType)
    : null;
}

export function hasPathSeparator(name: string) {
  return name.includes("/") || name.includes("\\");
}

/**
 * Key-safe file name: ASCII letters, digits, `.`, `_`, `-` only, no leading
 * dot (a `..` segment must never reach a path-normalising gateway), capped at
 * 128 characters with the extension preserved when there is one.
 */
export function sanitizeArtifactName(name: string) {
  const collapsed = name
    .trim()
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^[.-]+|[.-]+$/g, "");
  if (!collapsed) return "file";

  const dot = collapsed.lastIndexOf(".");
  const extension = dot > 0 ? collapsed.slice(dot) : "";
  const base = dot > 0 ? collapsed.slice(0, dot) : collapsed;
  const safeExtension = extension.slice(0, 16);
  const room = Math.max(1, 128 - safeExtension.length);
  return `${base.slice(0, room) || "file"}${safeExtension}`;
}

/**
 * `agent-artifacts/<workspaceId>/<projectId>/<artifactId>/<sanitized name>`.
 * The artifact id is the uniqueness guarantee; the name is there so a bucket
 * listing is legible to a person.
 */
export function buildArtifactKey(input: {
  workspaceId: string;
  projectId: string;
  artifactId: string;
  name: string;
}) {
  return [
    ARTIFACT_KEY_ROOT,
    input.workspaceId,
    input.projectId,
    input.artifactId,
    sanitizeArtifactName(input.name),
  ].join("/");
}

/**
 * `inline` is honoured only for types that render; everything else — and
 * always zip — is served as `attachment`. Default is `attachment` so a caller
 * has to opt in to inline rendering.
 */
export function resolveDisposition(
  contentType: ArtifactContentType,
  requested: Disposition | undefined,
): Disposition {
  if (requested === "inline" && INLINE_CAPABLE.has(contentType)) {
    return "inline";
  }
  return "attachment";
}

/**
 * RFC 6266 header with an ASCII fallback and an RFC 5987 `filename*` so
 * non-ASCII names survive every browser. Quotes and control characters are
 * stripped from the fallback rather than escaped — S3 echoes the header as
 * given and some gateways mishandle escapes.
 */
export function buildContentDisposition(
  disposition: Disposition,
  name: string,
) {
  const fallback =
    name
      .replace(/[^\x20-\x7e]/g, "")
      .replace(/[";]/g, "")
      .trim() || "file";
  const encoded = encodeRFC5987(name);
  return `${disposition}; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}

function encodeRFC5987(value: string) {
  return encodeURIComponent(value).replace(
    /['()*]/g,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}
