import { Link } from "@tanstack/react-router";
import { ArrowLeft, Pencil, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import CommentEditor from "@/components/activity/comment-editor";
import { MarkdownRenderer } from "@/components/public-project/markdown-renderer";
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
import { Input } from "@/components/ui/input";
import type { AgentDocument } from "@/fetchers/agent-layer/get-agent-document";
import { useDeleteAgentDocument } from "@/hooks/mutations/agent-layer/use-delete-agent-document";
import { usePutAgentDocument } from "@/hooks/mutations/agent-layer/use-put-agent-document";
import { cn } from "@/lib/cn";
import { formatDateTime, formatRelativeTime } from "@/lib/format";
import { toast } from "@/lib/toast";
import { AgentAuthorBadge } from "./agent-author-badge";

/** Matches MAX_DOCUMENT_BODY_BYTES on the API. Bytes, not characters. */
export const MAX_DOCUMENT_BODY_BYTES = 200 * 1024;

const encoder = new TextEncoder();

export function documentBodyBytes(body: string) {
  return encoder.encode(body).length;
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(1)} KB`;
}

type DocumentPageProps = {
  document: AgentDocument;
  workspaceId: string;
  projectId: string;
  projectSlug?: string;
  taskNumber?: number | null;
  authorName?: string | null;
  canEdit: boolean;
  canDelete: boolean;
  startInEdit?: boolean;
  onDeleted: () => void;
};

export function DocumentPage({
  document,
  workspaceId,
  projectId,
  projectSlug,
  taskNumber,
  authorName,
  canEdit,
  canDelete,
  startInEdit = false,
  onDeleted,
}: DocumentPageProps) {
  const { t } = useTranslation();
  const [isEditing, setIsEditing] = useState(startInEdit && canEdit);
  const [title, setTitle] = useState(document.title);
  const [body, setBody] = useState(document.body);
  const [isDeleteOpen, setIsDeleteOpen] = useState(false);
  const put = usePutAgentDocument();
  const remove = useDeleteAgentDocument();

  // A save or an external overwrite replaces the cached document; only pick
  // that up while viewing so an in-progress edit is never clobbered.
  useEffect(() => {
    if (!isEditing) {
      setTitle(document.title);
      setBody(document.body);
    }
  }, [document.title, document.body, isEditing]);

  const bytes = documentBodyBytes(body);
  const tooLarge = bytes > MAX_DOCUMENT_BODY_BYTES;
  const trimmedTitle = title.trim();
  const canSave = !put.isPending && !tooLarge && trimmedTitle.length > 0;

  const handleSave = async () => {
    if (!canSave) return;
    try {
      await put.mutateAsync({
        projectId,
        slug: document.slug,
        // taskId is echoed back so saving never detaches the document from
        // the task it hangs under in the overview tree.
        body: { title: trimmedTitle, body, taskId: document.taskId },
      });
      toast.success(t("agentLayer:docs.saved"));
      setIsEditing(false);
    } catch (cause) {
      toast.error(t("agentLayer:docs.saveFailed"), {
        description: cause instanceof Error ? cause.message : undefined,
      });
    }
  };

  const handleCancel = () => {
    setTitle(document.title);
    setBody(document.body);
    setIsEditing(false);
  };

  const handleDelete = async () => {
    try {
      await remove.mutateAsync({ projectId, slug: document.slug });
      toast.success(t("agentLayer:docs.deleted"));
      setIsDeleteOpen(false);
      onDeleted();
    } catch (cause) {
      toast.error(t("agentLayer:docs.deleteFailed"), {
        description: cause instanceof Error ? cause.message : undefined,
      });
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b border-border/80 px-3 py-2.5 sm:px-4">
        <Link
          to="/dashboard/workspace/$workspaceId/project/$projectId/docs"
          params={{ workspaceId, projectId }}
          className="flex items-center gap-1 text-xs text-muted-foreground underline-offset-2 hover:underline"
        >
          <ArrowLeft className="size-3.5" />
          {t("agentLayer:docs.backToList")}
        </Link>
        <span className="font-mono text-xs text-muted-foreground">
          {document.slug}
        </span>
        <div className="ml-auto flex items-center gap-1.5">
          {isEditing ? (
            <>
              <span
                data-testid="byte-counter"
                className={cn(
                  "text-xs tabular-nums",
                  tooLarge
                    ? "text-destructive-foreground"
                    : "text-muted-foreground",
                )}
              >
                {t("agentLayer:docs.byteCounter", {
                  used: formatBytes(bytes),
                  max: formatBytes(MAX_DOCUMENT_BODY_BYTES),
                })}
              </span>
              <Button
                variant="outline"
                size="sm"
                onClick={handleCancel}
                disabled={put.isPending}
              >
                {t("agentLayer:docs.cancel")}
              </Button>
              <Button
                size="sm"
                onClick={handleSave}
                disabled={!canSave}
                data-testid="save-document"
              >
                {put.isPending
                  ? t("agentLayer:docs.saving")
                  : t("agentLayer:docs.save")}
              </Button>
            </>
          ) : (
            <>
              {canEdit ? (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setIsEditing(true)}
                  data-testid="edit-document"
                >
                  <Pencil className="size-3.5" />
                  {t("agentLayer:docs.edit")}
                </Button>
              ) : null}
              {canDelete ? (
                <Button
                  variant="destructive-outline"
                  size="sm"
                  onClick={() => setIsDeleteOpen(true)}
                  data-testid="delete-document"
                >
                  <Trash2 className="size-3.5" />
                  {t("agentLayer:docs.delete")}
                </Button>
              ) : null}
            </>
          )}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-4 sm:px-4">
        <article className="mx-auto max-w-3xl space-y-4">
          {isEditing ? (
            <Input
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              aria-label={t("agentLayer:docs.titleLabel")}
              className="[&_[data-slot=input]]:text-lg [&_[data-slot=input]]:font-semibold"
            />
          ) : (
            <h1 className="text-xl font-semibold leading-snug text-foreground">
              {document.title}
            </h1>
          )}

          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
            <AgentAuthorBadge
              actor={document.actor}
              humanName={
                document.updatedBy ? (authorName ?? document.updatedBy) : null
              }
            />
            <span title={formatDateTime(document.updatedAt)}>
              {formatRelativeTime(document.updatedAt)}
            </span>
            {document.taskId ? (
              <Link
                to="/dashboard/workspace/$workspaceId/project/$projectId/task/$taskId"
                params={{ workspaceId, projectId, taskId: document.taskId }}
                className="font-mono underline-offset-2 hover:underline"
              >
                {projectSlug ? `${projectSlug}-` : "#"}
                {taskNumber ?? "?"}
              </Link>
            ) : null}
          </div>

          {isEditing ? (
            <div className="space-y-1.5" data-testid="document-editor">
              {/* No taskId is passed on purpose: the upload path requires one
                  (DESIGN.md §10), so file/image attachments stay off here. */}
              <CommentEditor
                value={body}
                onChange={setBody}
                placeholder={t("agentLayer:docs.bodyPlaceholder")}
                showQuickAttachButton={false}
                className="min-h-[24rem] rounded-lg border border-border/80"
              />
              <p className="text-xs text-muted-foreground">
                {t("agentLayer:docs.attachmentsDisabled")}
              </p>
            </div>
          ) : document.body.trim() ? (
            <div data-testid="document-body">
              <MarkdownRenderer content={document.body} />
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              {t("agentLayer:docs.emptyBody")}
            </p>
          )}
        </article>
      </div>

      <AlertDialog
        open={isDeleteOpen}
        onOpenChange={(next) => {
          if (!next && !remove.isPending) setIsDeleteOpen(false);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("agentLayer:docs.deleteTitle")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("agentLayer:docs.deleteDescription", {
                title: document.title,
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
              disabled={remove.isPending}
              data-testid="confirm-delete"
            >
              {remove.isPending
                ? t("agentLayer:docs.deleting")
                : t("agentLayer:docs.delete")}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
