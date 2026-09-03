import { Link } from "@tanstack/react-router";
import { Download, Eye, PenLine, Trash2, Upload } from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import type { AgentArtifact } from "@/fetchers/agent-layer/get-agent-artifacts";
import type { AgentDocumentSummary } from "@/fetchers/agent-layer/get-agent-documents";
import { useDeleteAgentArtifact } from "@/hooks/mutations/agent-layer/use-delete-agent-artifact";
import { useDeleteAgentDocument } from "@/hooks/mutations/agent-layer/use-delete-agent-document";
import { cn } from "@/lib/cn";
import { downloadAgentArtifact } from "@/lib/download-agent-artifact";
import {
  formatDateMedium,
  formatDateTime,
  formatRelativeTime,
} from "@/lib/format";
import { toast } from "@/lib/toast";
import { AgentAuthorBadge } from "./agent-author-badge";
import { AgentLayerEmpty } from "./agent-layer-state";
import {
  ARTIFACT_KIND_ICONS,
  artifactKindOf,
  formatBytes,
  groupLibraryItems,
  isInlineViewable,
  type LibraryGroupMode,
  type LibraryItem,
  libraryItemId,
  libraryItemName,
  libraryItemTime,
} from "./artifact-kind";
import { ArtifactUploader, type UploadTaskOption } from "./artifact-uploader";

type FileLibraryProps = {
  artifacts: AgentArtifact[];
  documents: AgentDocumentSummary[];
  workspaceId: string;
  projectId: string;
  projectSlug?: string;
  tasks: UploadTaskOption[];
  memberNameById: Map<string, string>;
  canUpload: boolean;
  canDelete: boolean;
  onCreateDocument: () => void;
};

const KIND_LABEL_KEYS = {
  html: "agentLayer:docs.kindHtml",
  zip: "agentLayer:docs.kindZip",
  pdf: "agentLayer:docs.kindPdf",
  md: "agentLayer:docs.kindMd",
  json: "agentLayer:docs.kindJson",
  txt: "agentLayer:docs.kindTxt",
  doc: "agentLayer:docs.kindDoc",
} as const;

/**
 * DESIGN.md §6 (2026-09-03): the docs tab is the project's artifact and file
 * library. Uploaded files and markdown documents share one list, grouped by
 * task (default) or by day.
 */
export function FileLibrary({
  artifacts,
  documents,
  workspaceId,
  projectId,
  projectSlug,
  tasks,
  memberNameById,
  canUpload,
  canDelete,
  onCreateDocument,
}: FileLibraryProps) {
  const { t } = useTranslation();
  const [mode, setMode] = useState<LibraryGroupMode>("task");
  const [showUploader, setShowUploader] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<LibraryItem | null>(null);
  const deleteArtifact = useDeleteAgentArtifact();
  const deleteDocument = useDeleteAgentDocument();

  const taskById = useMemo(
    () => new Map(tasks.map((task) => [task.id, task])),
    [tasks],
  );
  const groups = useMemo(
    () => groupLibraryItems(artifacts, documents, mode),
    [artifacts, documents, mode],
  );
  const isEmpty = artifacts.length === 0 && documents.length === 0;
  const taskKey = (taskId: string) => {
    const task = taskById.get(taskId);
    return `${projectSlug ? `${projectSlug}-` : "#"}${task?.number ?? "?"}`;
  };

  const handleDownload = async (artifact: AgentArtifact) => {
    try {
      await downloadAgentArtifact(projectId, artifact.id);
    } catch (cause) {
      toast.error(t("agentLayer:docs.downloadFailed"), {
        description: cause instanceof Error ? cause.message : undefined,
      });
    }
  };

  const isDeleting = deleteArtifact.isPending || deleteDocument.isPending;
  const handleDelete = async () => {
    if (!pendingDelete) return;
    try {
      if (pendingDelete.kind === "artifact") {
        await deleteArtifact.mutateAsync({
          projectId,
          artifactId: pendingDelete.artifact.id,
        });
        toast.success(t("agentLayer:docs.fileDeleted"));
      } else {
        await deleteDocument.mutateAsync({
          projectId,
          slug: pendingDelete.document.slug,
        });
        toast.success(t("agentLayer:docs.deleted"));
      }
      setPendingDelete(null);
    } catch (cause) {
      toast.error(
        pendingDelete.kind === "artifact"
          ? t("agentLayer:docs.fileDeleteFailed")
          : t("agentLayer:docs.deleteFailed"),
        { description: cause instanceof Error ? cause.message : undefined },
      );
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b border-border/80 px-3 py-2.5 sm:px-4">
        <h1 className="text-sm font-semibold text-foreground">
          {t("agentLayer:docs.title")}
        </h1>
        <div className="ml-auto flex items-center gap-1.5">
          <span className="hidden text-xs text-muted-foreground sm:inline">
            {t("agentLayer:docs.groupBy")}
          </span>
          <div className="inline-flex h-7 items-center gap-0.5 rounded-lg border border-border/80 bg-background p-0.5">
            {(["task", "date"] as const).map((option) => (
              <Button
                key={option}
                variant={mode === option ? "secondary" : "ghost"}
                size="xs"
                aria-pressed={mode === option}
                data-testid={`group-${option}`}
                onClick={() => setMode(option)}
                className={cn(
                  "h-6 rounded-md px-2 text-xs",
                  mode !== option && "text-muted-foreground",
                )}
              >
                {option === "task"
                  ? t("agentLayer:docs.groupTask")
                  : t("agentLayer:docs.groupDate")}
              </Button>
            ))}
          </div>
        </div>
        {canUpload ? (
          <>
            <Button
              variant="outline"
              size="sm"
              onClick={onCreateDocument}
              data-testid="new-document"
            >
              <PenLine className="size-3.5" />
              {t("agentLayer:docs.newMarkdown")}
            </Button>
            <Button
              size="sm"
              aria-pressed={showUploader}
              onClick={() => setShowUploader((current) => !current)}
              data-testid="toggle-upload"
            >
              <Upload className="size-3.5" />
              {t("agentLayer:docs.upload")}
            </Button>
          </>
        ) : null}
      </div>

      <div className="min-h-0 flex-1 overflow-auto px-3 py-3 sm:px-4">
        <div className="mx-auto max-w-5xl space-y-4">
          {canUpload && (showUploader || isEmpty) ? (
            <ArtifactUploader
              projectId={projectId}
              projectSlug={projectSlug}
              tasks={tasks}
            />
          ) : null}

          {isEmpty ? (
            <AgentLayerEmpty
              title={t("agentLayer:docs.empty")}
              description={t("agentLayer:docs.emptyHint")}
            />
          ) : (
            groups.map((group) => (
              <section
                key={group.key}
                data-testid="library-group"
                className="space-y-1.5"
              >
                <h2 className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  {group.day ? (
                    <span data-testid="group-label">
                      {formatDateMedium(`${group.day}T00:00:00`)}
                    </span>
                  ) : group.taskId ? (
                    <Link
                      to="/dashboard/workspace/$workspaceId/project/$projectId/task/$taskId"
                      params={{ workspaceId, projectId, taskId: group.taskId }}
                      data-testid="group-label"
                      className="flex min-w-0 items-center gap-1.5 normal-case underline-offset-2 hover:underline"
                    >
                      <span className="font-mono">{taskKey(group.taskId)}</span>
                      <span className="truncate text-foreground">
                        {taskById.get(group.taskId)?.title ?? ""}
                      </span>
                    </Link>
                  ) : (
                    <span data-testid="group-label">
                      {t("agentLayer:docs.groupProject")}
                    </span>
                  )}
                  <span className="text-muted-foreground/70">
                    {group.items.length}
                  </span>
                </h2>
                <div className="overflow-x-auto rounded-lg border border-border/80 bg-background">
                  <table className="w-full min-w-[40rem] text-sm">
                    <thead className="text-left text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                      <tr className="border-b border-border/70">
                        <th className="px-3 py-2">
                          {t("agentLayer:docs.columnName")}
                        </th>
                        <th className="px-3 py-2">
                          {t("agentLayer:docs.columnKind")}
                        </th>
                        <th className="px-3 py-2 text-right">
                          {t("agentLayer:docs.columnSize")}
                        </th>
                        {mode === "date" ? (
                          <th className="px-3 py-2">
                            {t("agentLayer:docs.columnTask")}
                          </th>
                        ) : null}
                        <th className="px-3 py-2">
                          {t("agentLayer:docs.columnAuthor")}
                        </th>
                        <th className="px-3 py-2">
                          {t("agentLayer:docs.columnTime")}
                        </th>
                        <th className="px-3 py-2">
                          <span className="sr-only">
                            {t("agentLayer:docs.columnActions")}
                          </span>
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border/70">
                      {group.items.map((item) => (
                        <LibraryRow
                          key={libraryItemId(item)}
                          item={item}
                          workspaceId={workspaceId}
                          projectId={projectId}
                          showTask={mode === "date"}
                          taskKey={taskKey}
                          memberNameById={memberNameById}
                          canDelete={canDelete}
                          onDownload={handleDownload}
                          onDelete={() => setPendingDelete(item)}
                        />
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            ))
          )}
        </div>
      </div>

      <AlertDialog
        open={pendingDelete !== null}
        onOpenChange={(next) => {
          if (!next && !isDeleting) setPendingDelete(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {pendingDelete?.kind === "document"
                ? t("agentLayer:docs.deleteTitle")
                : t("agentLayer:docs.deleteFileTitle")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {pendingDelete?.kind === "document"
                ? t("agentLayer:docs.deleteDescription", {
                    title: pendingDelete.document.title,
                  })
                : t("agentLayer:docs.deleteFileDescription", {
                    name: pendingDelete ? libraryItemName(pendingDelete) : "",
                  })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogClose render={<Button variant="outline" />}>
              {t("agentLayer:docs.cancel")}
            </AlertDialogClose>
            <Button
              variant="destructive"
              onClick={handleDelete}
              disabled={isDeleting}
              data-testid="confirm-delete"
            >
              {isDeleting
                ? t("agentLayer:docs.deleting")
                : t("agentLayer:docs.delete")}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function LibraryRow({
  item,
  workspaceId,
  projectId,
  showTask,
  taskKey,
  memberNameById,
  canDelete,
  onDownload,
  onDelete,
}: {
  item: LibraryItem;
  workspaceId: string;
  projectId: string;
  showTask: boolean;
  taskKey: (taskId: string) => string;
  memberNameById: Map<string, string>;
  canDelete: boolean;
  onDownload: (artifact: AgentArtifact) => void;
  onDelete: () => void;
}) {
  const { t } = useTranslation();
  const kind =
    item.kind === "artifact"
      ? artifactKindOf(item.artifact.contentType)
      : "doc";
  const Icon = ARTIFACT_KIND_ICONS[kind];
  const taskId =
    item.kind === "artifact" ? item.artifact.taskId : item.document.taskId;
  const uploaderId =
    item.kind === "artifact"
      ? item.artifact.uploadedBy
      : item.document.updatedBy;
  const author = uploaderId
    ? (memberNameById.get(uploaderId) ?? uploaderId)
    : null;
  const actor =
    item.kind === "artifact" ? item.artifact.actor : item.document.actor;
  const time = libraryItemTime(item);
  const name = libraryItemName(item);
  const linkClassName =
    "flex min-w-0 items-center gap-2 font-medium text-foreground underline-offset-2 hover:underline";

  const nameCell =
    item.kind === "document" ? (
      <Link
        to="/dashboard/workspace/$workspaceId/project/$projectId/docs/$slug"
        params={{ workspaceId, projectId, slug: item.document.slug }}
        className={linkClassName}
      >
        <Icon className="size-4 shrink-0 text-muted-foreground" />
        <span className="truncate">{name}</span>
        <span className="truncate font-mono text-xs font-normal text-muted-foreground">
          {item.document.slug}
        </span>
      </Link>
    ) : isInlineViewable(item.artifact.contentType) ? (
      <Link
        to="/dashboard/workspace/$workspaceId/project/$projectId/docs/artifact/$artifactId"
        params={{ workspaceId, projectId, artifactId: item.artifact.id }}
        className={linkClassName}
      >
        <Icon className="size-4 shrink-0 text-muted-foreground" />
        <span className="truncate">{name}</span>
      </Link>
    ) : (
      <button
        type="button"
        onClick={() => onDownload(item.artifact)}
        className={cn(linkClassName, "text-left")}
        data-testid="download-name"
      >
        <Icon className="size-4 shrink-0 text-muted-foreground" />
        <span className="truncate">{name}</span>
      </button>
    );

  return (
    <tr
      data-testid="library-row"
      data-kind={item.kind}
      className="transition-colors hover:bg-muted/60"
    >
      <td className="max-w-[24rem] px-3 py-2">{nameCell}</td>
      <td className="px-3 py-2 text-xs text-muted-foreground">
        {t(KIND_LABEL_KEYS[kind])}
      </td>
      <td className="whitespace-nowrap px-3 py-2 text-right text-xs tabular-nums text-muted-foreground">
        {item.kind === "artifact" ? formatBytes(item.artifact.size) : "—"}
      </td>
      {showTask ? (
        <td className="px-3 py-2 font-mono text-xs text-muted-foreground">
          {taskId ? (
            <Link
              to="/dashboard/workspace/$workspaceId/project/$projectId/task/$taskId"
              params={{ workspaceId, projectId, taskId }}
              className="underline-offset-2 hover:underline"
            >
              {taskKey(taskId)}
            </Link>
          ) : (
            "—"
          )}
        </td>
      ) : null}
      <td className="px-3 py-2 text-muted-foreground">
        <AgentAuthorBadge actor={actor} humanName={author} />
      </td>
      <td
        className="whitespace-nowrap px-3 py-2 text-xs text-muted-foreground"
        title={formatDateTime(time)}
      >
        {formatRelativeTime(time)}
      </td>
      <td className="px-3 py-2">
        <div className="flex items-center justify-end gap-0.5">
          {item.kind === "document" ? (
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label={t("agentLayer:docs.view")}
              title={t("agentLayer:docs.view")}
              render={
                <Link
                  to="/dashboard/workspace/$workspaceId/project/$projectId/docs/$slug"
                  params={{ workspaceId, projectId, slug: item.document.slug }}
                />
              }
            >
              <Eye className="size-3.5" />
            </Button>
          ) : (
            <>
              {isInlineViewable(item.artifact.contentType) ? (
                <Button
                  variant="ghost"
                  size="icon-xs"
                  aria-label={t("agentLayer:docs.view")}
                  title={t("agentLayer:docs.view")}
                  data-testid="view-artifact"
                  render={
                    <Link
                      to="/dashboard/workspace/$workspaceId/project/$projectId/docs/artifact/$artifactId"
                      params={{
                        workspaceId,
                        projectId,
                        artifactId: item.artifact.id,
                      }}
                    />
                  }
                >
                  <Eye className="size-3.5" />
                </Button>
              ) : null}
              <Button
                variant="ghost"
                size="icon-xs"
                aria-label={t("agentLayer:docs.download")}
                title={t("agentLayer:docs.download")}
                data-testid="download-artifact"
                onClick={() => onDownload(item.artifact)}
              >
                <Download className="size-3.5" />
              </Button>
            </>
          )}
          {canDelete ? (
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label={t("agentLayer:docs.delete")}
              title={t("agentLayer:docs.delete")}
              data-testid="delete-item"
              className="text-muted-foreground hover:text-destructive-foreground"
              onClick={onDelete}
            >
              <Trash2 className="size-3.5" />
            </Button>
          ) : null}
        </div>
      </td>
    </tr>
  );
}
