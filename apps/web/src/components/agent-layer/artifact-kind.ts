import {
  Archive,
  FileCode2,
  FileJson2,
  FileText,
  FileType2,
  Globe,
  type LucideIcon,
} from "lucide-react";
import type { AgentArtifact } from "@/fetchers/agent-layer/get-agent-artifacts";
import type { AgentDocumentSummary } from "@/fetchers/agent-layer/get-agent-documents";

export type ArtifactKind = "html" | "zip" | "pdf" | "md" | "json" | "txt";

/** Everything the docs tab lists: uploaded files and markdown documents. */
export type LibraryItem =
  | { kind: "artifact"; artifact: AgentArtifact }
  | { kind: "document"; document: AgentDocumentSummary };

const KIND_BY_CONTENT_TYPE: Record<string, ArtifactKind> = {
  "text/html": "html",
  "application/zip": "zip",
  "application/pdf": "pdf",
  "text/markdown": "md",
  "application/json": "json",
  "text/plain": "txt",
};

export function artifactKindOf(contentType: string): ArtifactKind {
  return KIND_BY_CONTENT_TYPE[contentType.toLowerCase()] ?? "txt";
}

/** Same set as the API's INLINE_CAPABLE: everything but zip may be served inline. */
export function isInlineViewable(contentType: string) {
  return artifactKindOf(contentType) !== "zip";
}

/**
 * What the sandboxed viewer can actually show. Chrome refuses its PDF plugin
 * inside any sandboxed frame (verified 2026-09-03, with and without
 * allow-scripts), so PDFs get a new-tab/download panel instead of a blank frame.
 */
export function isFramePreviewable(contentType: string) {
  const kind = artifactKindOf(contentType);
  return kind !== "zip" && kind !== "pdf";
}

export const ARTIFACT_KIND_ICONS: Record<ArtifactKind | "doc", LucideIcon> = {
  html: Globe,
  zip: Archive,
  pdf: FileType2,
  md: FileText,
  json: FileJson2,
  txt: FileCode2,
  doc: FileText,
};

export function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function libraryItemId(item: LibraryItem) {
  return item.kind === "artifact"
    ? `artifact:${item.artifact.id}`
    : `document:${item.document.id}`;
}

export function libraryItemTaskId(item: LibraryItem) {
  return item.kind === "artifact" ? item.artifact.taskId : item.document.taskId;
}

export function libraryItemTime(item: LibraryItem) {
  return item.kind === "artifact"
    ? item.artifact.createdAt
    : item.document.updatedAt;
}

export function libraryItemName(item: LibraryItem) {
  return item.kind === "artifact" ? item.artifact.name : item.document.title;
}

export type LibraryGroupMode = "task" | "date";

export type LibraryGroup = {
  key: string;
  taskId: string | null;
  /** ISO day (YYYY-MM-DD) in local time when grouped by date. */
  day: string | null;
  items: LibraryItem[];
};

function localDay(value: string) {
  const date = new Date(value);
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

/**
 * Newest first inside every group. Task groups are ordered by their newest
 * item, with the unlinked ("project") group pinned first because it is the
 * catch-all people look at before drilling into a task.
 */
export function groupLibraryItems(
  artifacts: AgentArtifact[],
  documents: AgentDocumentSummary[],
  mode: LibraryGroupMode,
): LibraryGroup[] {
  const items: LibraryItem[] = [
    ...artifacts.map(
      (artifact): LibraryItem => ({ kind: "artifact", artifact }),
    ),
    ...documents.map(
      (document): LibraryItem => ({ kind: "document", document }),
    ),
  ].sort(
    (a, b) =>
      new Date(libraryItemTime(b)).getTime() -
      new Date(libraryItemTime(a)).getTime(),
  );

  const groups = new Map<string, LibraryGroup>();
  for (const item of items) {
    const taskId = libraryItemTaskId(item);
    const key =
      mode === "task"
        ? `task:${taskId ?? ""}`
        : `day:${localDay(libraryItemTime(item))}`;
    let group = groups.get(key);
    if (!group) {
      group = {
        key,
        taskId: mode === "task" ? taskId : null,
        day: mode === "date" ? localDay(libraryItemTime(item)) : null,
        items: [],
      };
      groups.set(key, group);
    }
    group.items.push(item);
  }

  const ordered = [...groups.values()];
  if (mode === "task") {
    ordered.sort((a, b) => {
      if (a.taskId === null) return -1;
      if (b.taskId === null) return 1;
      return 0;
    });
  }
  return ordered;
}
