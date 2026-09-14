import { History, Trash2, Undo2 } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
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
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPopup,
  DialogTitle,
} from "@/components/ui/dialog";
import type { SpecTarget } from "@/fetchers/agent-layer/agent-spec-lifecycle";
import {
  useDeleteAgentSpec,
  useRevertAgentSpec,
} from "@/hooks/mutations/agent-layer/use-agent-spec";
import {
  useAgentSpecRevision,
  useAgentSpecRevisions,
} from "@/hooks/queries/agent-layer/use-agent-spec-revisions";
import { cn } from "@/lib/cn";
import { formatDateTime, formatRelativeTime } from "@/lib/format";
import { toast } from "@/lib/toast";
import { AgentAuthorBadge } from "./agent-author-badge";
import { AgentLayerErrorState, AgentLayerSkeleton } from "./agent-layer-state";
import { RequirementKeyChip } from "./spec-badges";

type SpecLifecycleActionsProps = {
  target: SpecTarget;
  /** task:update: a revert is a save. */
  canRevert: boolean;
  /** project:update: the delete route's gate. */
  canDelete: boolean;
};

/**
 * Revision history and soft delete for a requirement document or a design
 * (agent-autoapply). Saves apply at once, so these are how a person undoes
 * one: revert to an earlier revision, or delete and restore later.
 */
export function SpecLifecycleActions({
  target,
  canRevert,
  canDelete,
}: SpecLifecycleActionsProps) {
  const { t } = useTranslation();
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const [isDeleteOpen, setIsDeleteOpen] = useState(false);
  const remove = useDeleteAgentSpec();
  const doc =
    target.kind === "requirement"
      ? t("agentLayer:spec.docRequirements")
      : t("agentLayer:spec.docDesign");

  const handleDelete = async () => {
    try {
      await remove.mutateAsync(target);
      toast.success(t("agentLayer:spec.deleted", { doc }));
      setIsDeleteOpen(false);
    } catch (cause) {
      toast.error(t("agentLayer:spec.deleteFailed"), {
        description: cause instanceof Error ? cause.message : undefined,
      });
    }
  };

  return (
    <>
      <Button
        size="sm"
        variant="ghost"
        onClick={() => setIsHistoryOpen(true)}
        data-testid="open-revisions"
      >
        <History />
        {t("agentLayer:spec.revisions")}
      </Button>
      {canDelete ? (
        <Button
          size="sm"
          variant="ghost"
          onClick={() => setIsDeleteOpen(true)}
          data-testid="delete-spec"
        >
          <Trash2 />
          {t("agentLayer:spec.delete")}
        </Button>
      ) : null}
      {isHistoryOpen ? (
        <SpecRevisionsDialog
          onOpenChange={setIsHistoryOpen}
          target={target}
          canRevert={canRevert}
        />
      ) : null}
      <AlertDialog
        open={isDeleteOpen}
        onOpenChange={(open) =>
          !open && !remove.isPending && setIsDeleteOpen(false)
        }
      >
        <AlertDialogContent data-testid="delete-spec-dialog">
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("agentLayer:spec.deleteTitle", {
                doc,
                feature: target.feature,
              })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("agentLayer:spec.deleteDescription")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogClose
              render={
                <Button
                  variant="outline"
                  size="sm"
                  disabled={remove.isPending}
                />
              }
            >
              {t("agentLayer:spec.cancel")}
            </AlertDialogClose>
            <Button
              size="sm"
              variant="destructive"
              disabled={remove.isPending}
              onClick={handleDelete}
              data-testid="delete-spec-submit"
            >
              {remove.isPending
                ? t("agentLayer:spec.deleting")
                : t("agentLayer:spec.delete")}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

type SpecRevisionsDialogProps = {
  onOpenChange: (open: boolean) => void;
  target: SpecTarget;
  canRevert: boolean;
};

/** Newest first with author and time; the picked revision's text on the right. */
export function SpecRevisionsDialog({
  onOpenChange,
  target,
  canRevert,
}: SpecRevisionsDialogProps) {
  const { t } = useTranslation();
  const revisions = useAgentSpecRevisions(target);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = useAgentSpecRevision(target, selectedId);
  const revert = useRevertAgentSpec();
  const [isConfirmOpen, setIsConfirmOpen] = useState(false);
  const list = revisions.data?.revisions ?? [];
  // The API lists newest first, so the head is the content on screen now;
  // reverting to it would change nothing.
  const currentId = list[0]?.id;

  const handleRevert = async () => {
    if (!selectedId) return;
    try {
      await revert.mutateAsync({ ...target, revisionId: selectedId });
      toast.success(t("agentLayer:spec.reverted"));
      setIsConfirmOpen(false);
      onOpenChange(false);
    } catch (cause) {
      toast.error(t("agentLayer:spec.revertFailed"), {
        description: cause instanceof Error ? cause.message : undefined,
      });
    }
  };

  return (
    <>
      <Dialog open onOpenChange={onOpenChange}>
        <DialogPopup className="sm:max-w-4xl" data-testid="revisions-dialog">
          <DialogHeader>
            <DialogTitle>{t("agentLayer:spec.revisionsTitle")}</DialogTitle>
            <DialogDescription>
              {t("agentLayer:spec.revisionsHint")}
            </DialogDescription>
          </DialogHeader>
          <div className="grid min-h-0 gap-3 px-6 sm:grid-cols-[16rem_1fr]">
            <div className="max-h-[60vh] overflow-y-auto">
              {revisions.isPending ? (
                <AgentLayerSkeleton rows={4} />
              ) : revisions.isError ? (
                <AgentLayerErrorState
                  error={revisions.error}
                  onRetry={() => revisions.refetch()}
                />
              ) : list.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  {t("agentLayer:spec.revisionsEmpty")}
                </p>
              ) : (
                <ul
                  className="space-y-1"
                  aria-label={t("agentLayer:spec.revisionsTitle")}
                >
                  {list.map((revision) => {
                    const active = revision.id === selectedId;
                    return (
                      <li key={revision.id}>
                        <button
                          type="button"
                          aria-pressed={active}
                          onClick={() => setSelectedId(revision.id)}
                          className={cn(
                            "w-full space-y-0.5 rounded-md border px-2 py-1.5 text-left text-xs transition-colors",
                            active
                              ? "border-border bg-secondary"
                              : "border-transparent hover:bg-accent/50",
                          )}
                          data-testid="revision-row"
                        >
                          <span className="flex items-center gap-1.5">
                            <span className="min-w-0 truncate font-medium text-foreground">
                              {revision.title}
                            </span>
                            {revision.id === currentId ? (
                              <Badge variant="outline" size="sm">
                                {t("agentLayer:spec.revisionCurrent")}
                              </Badge>
                            ) : null}
                            {revision.revertedFromId ? (
                              <Badge variant="secondary" size="sm">
                                {t("agentLayer:spec.revisionReverted")}
                              </Badge>
                            ) : null}
                          </span>
                          <span className="flex flex-wrap items-center gap-1 text-muted-foreground">
                            <AgentAuthorBadge
                              actor={revision.actor}
                              humanName={revision.author?.name}
                            />
                            <span
                              title={formatDateTime(revision.createdAt)}
                              data-testid="revision-time"
                            >
                              {formatRelativeTime(revision.createdAt)}
                            </span>
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
            <div
              className="max-h-[60vh] min-w-0 overflow-y-auto rounded-md border border-border/80 p-3"
              data-testid="revision-preview"
            >
              {!selectedId ? (
                <p className="text-xs text-muted-foreground">
                  {t("agentLayer:spec.revisionPickHint")}
                </p>
              ) : selected.isPending ? (
                <AgentLayerSkeleton rows={4} />
              ) : selected.isError ? (
                <AgentLayerErrorState
                  error={selected.error}
                  onRetry={() => selected.refetch()}
                />
              ) : selected.data ? (
                <div className="space-y-2">
                  <h3 className="text-sm font-semibold text-foreground">
                    {selected.data.title}
                  </h3>
                  {selected.data.requirementKeys?.length ? (
                    <div className="flex flex-wrap gap-1">
                      {selected.data.requirementKeys.map((key) => (
                        <RequirementKeyChip
                          key={key}
                          requirementKey={key}
                          className="text-[10px]"
                        />
                      ))}
                    </div>
                  ) : null}
                  <div className="prose prose-sm max-w-none dark:prose-invert">
                    <MarkdownRenderer content={selected.data.body} />
                  </div>
                </div>
              ) : null}
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => onOpenChange(false)}>
              {t("agentLayer:spec.close")}
            </Button>
            {canRevert ? (
              <Button
                disabled={
                  !selectedId || selectedId === currentId || revert.isPending
                }
                onClick={() => setIsConfirmOpen(true)}
                data-testid="revert-revision"
              >
                <Undo2 />
                {t("agentLayer:spec.revert")}
              </Button>
            ) : null}
          </DialogFooter>
        </DialogPopup>
      </Dialog>
      <AlertDialog
        open={isConfirmOpen}
        onOpenChange={(open) =>
          !open && !revert.isPending && setIsConfirmOpen(false)
        }
      >
        <AlertDialogContent data-testid="revert-dialog">
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("agentLayer:spec.revertTitle")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("agentLayer:spec.revertDescription")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogClose
              render={
                <Button
                  variant="outline"
                  size="sm"
                  disabled={revert.isPending}
                />
              }
            >
              {t("agentLayer:spec.cancel")}
            </AlertDialogClose>
            <Button
              size="sm"
              disabled={revert.isPending}
              onClick={handleRevert}
              data-testid="revert-submit"
            >
              {revert.isPending
                ? t("agentLayer:spec.reverting")
                : t("agentLayer:spec.revert")}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
