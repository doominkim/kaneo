import { Pencil, Plus, Trash2 } from "lucide-react";
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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { isAgentLayerStatus } from "@/fetchers/agent-layer/api-error";
import { useDeleteAgentDocument } from "@/hooks/mutations/agent-layer/use-delete-agent-document";
import { usePutAgentDocument } from "@/hooks/mutations/agent-layer/use-put-agent-document";
import { useAgentDocument } from "@/hooks/queries/agent-layer/use-agent-document";
import { cn } from "@/lib/cn";
import { formatDateTime, formatRelativeTime } from "@/lib/format";
import { toast } from "@/lib/toast";
import { AgentLayerErrorState, AgentLayerSkeleton } from "./agent-layer-state";
import { formatBytes } from "./artifact-kind";
import { documentBodyBytes, MAX_DOCUMENT_BODY_BYTES } from "./document-page";

/**
 * The overview description is an `agent_document` under this reserved slug
 * so MCP `doc_get`/`doc_put` see it like any other document. The docs tab
 * hides it and refuses to create it.
 */
export const OVERVIEW_DOCUMENT_SLUG = "overview";

type ProjectDescriptionProps = {
  projectId: string;
  memberNameById: Map<string, string>;
  canEdit: boolean;
  canDelete: boolean;
};

export function ProjectDescription({
  projectId,
  memberNameById,
  canEdit,
  canDelete,
}: ProjectDescriptionProps) {
  const { t } = useTranslation();
  const query = useAgentDocument(projectId, OVERVIEW_DOCUMENT_SLUG);
  const put = usePutAgentDocument();
  const remove = useDeleteAgentDocument();
  const [isEditing, setIsEditing] = useState(false);
  const [body, setBody] = useState("");
  const [isDeleteOpen, setIsDeleteOpen] = useState(false);

  const document = query.data;
  const missing = query.isError && isAgentLayerStatus(query.error, 404);

  useEffect(() => {
    if (!isEditing) setBody(document?.body ?? "");
  }, [document?.body, isEditing]);

  const bytes = documentBodyBytes(body);
  const tooLarge = bytes > MAX_DOCUMENT_BODY_BYTES;
  const canSave = !put.isPending && !tooLarge;

  const handleSave = async () => {
    if (!canSave) return;
    try {
      await put.mutateAsync({
        projectId,
        slug: OVERVIEW_DOCUMENT_SLUG,
        body: {
          title: document?.title ?? t("agentLayer:overview.descriptionTitle"),
          body,
          taskId: null,
        },
      });
      toast.success(t("agentLayer:overview.descriptionSaved"));
      setIsEditing(false);
    } catch (cause) {
      toast.error(t("agentLayer:overview.descriptionSaveFailed"), {
        description: cause instanceof Error ? cause.message : undefined,
      });
    }
  };

  const handleDelete = async () => {
    try {
      await remove.mutateAsync({ projectId, slug: OVERVIEW_DOCUMENT_SLUG });
      toast.success(t("agentLayer:overview.descriptionDeleted"));
      setIsDeleteOpen(false);
      setIsEditing(false);
    } catch (cause) {
      toast.error(t("agentLayer:overview.descriptionDeleteFailed"), {
        description: cause instanceof Error ? cause.message : undefined,
      });
    }
  };

  if (query.isPending) {
    return <AgentLayerSkeleton rows={3} />;
  }
  if (query.isError && !missing) {
    return (
      <AgentLayerErrorState
        error={query.error}
        onRetry={() => query.refetch()}
      />
    );
  }

  const authorName = document?.updatedBy
    ? (memberNameById.get(document.updatedBy) ?? document.updatedBy)
    : null;

  return (
    <section
      data-testid="project-description"
      className="rounded-lg border border-border/80 bg-background p-3 sm:p-4"
    >
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-sm font-semibold text-foreground">
          {t("agentLayer:overview.descriptionTitle")}
        </h2>
        {document ? (
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
            {document.updatedBy ? (
              <span>{authorName}</span>
            ) : (
              <Badge variant="info" size="sm">
                {t("agentLayer:common.agent")}
              </Badge>
            )}
            <span title={formatDateTime(document.updatedAt)}>
              {formatRelativeTime(document.updatedAt)}
            </span>
          </div>
        ) : null}
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
                onClick={() => {
                  setBody(document?.body ?? "");
                  setIsEditing(false);
                }}
                disabled={put.isPending}
              >
                {t("agentLayer:docs.cancel")}
              </Button>
              <Button
                size="sm"
                onClick={handleSave}
                disabled={!canSave}
                data-testid="save-description"
              >
                {put.isPending
                  ? t("agentLayer:docs.saving")
                  : t("agentLayer:docs.save")}
              </Button>
            </>
          ) : document ? (
            <>
              {canEdit ? (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setIsEditing(true)}
                  data-testid="edit-description"
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
                  data-testid="delete-description"
                >
                  <Trash2 className="size-3.5" />
                  {t("agentLayer:docs.delete")}
                </Button>
              ) : null}
            </>
          ) : null}
        </div>
      </div>

      <div className="mt-3">
        {isEditing ? (
          <div data-testid="description-editor">
            <CommentEditor
              value={body}
              onChange={setBody}
              placeholder={t("agentLayer:overview.descriptionPlaceholder")}
              showQuickAttachButton={false}
              className="min-h-[12rem] rounded-lg border border-border/80"
            />
          </div>
        ) : document?.body.trim() ? (
          <div data-testid="description-body">
            <MarkdownRenderer content={document.body} />
          </div>
        ) : (
          <div className="flex flex-col items-start gap-2">
            <p className="text-sm text-muted-foreground">
              {t("agentLayer:overview.descriptionEmpty")}
            </p>
            {canEdit ? (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setIsEditing(true)}
                data-testid="add-description"
              >
                <Plus className="size-3.5" />
                {t("agentLayer:overview.addDescription")}
              </Button>
            ) : null}
          </div>
        )}
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
              {t("agentLayer:overview.deleteDescriptionTitle")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("agentLayer:overview.deleteDescriptionBody")}
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
    </section>
  );
}
