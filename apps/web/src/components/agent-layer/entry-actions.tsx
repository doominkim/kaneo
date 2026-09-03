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
import { isAgentLayerStatus } from "@/fetchers/agent-layer/api-error";
import { useDeleteAgentEntry } from "@/hooks/mutations/agent-layer/use-delete-agent-entry";
import { useRestoreAgentEntry } from "@/hooks/mutations/agent-layer/use-restore-agent-entry";
import { useWorkspacePermission } from "@/hooks/use-workspace-permission";
import { toast } from "@/lib/toast";
import { useAuth } from "../providers/auth-provider/hooks/use-auth";

/** The two facts the delete rule needs; see `canDeleteEntry`. */
export type EntryPermissions = {
  currentUserId: string | null;
  canUpdateProjects: boolean;
};

/**
 * Who is looking, from the session (`useAuth().user.id`, Better Auth's
 * session user), and whether they hold project:update. Read once per list
 * rather than per row so the capability query is shared.
 */
export function useEntryPermissions(): EntryPermissions {
  const { user } = useAuth();
  const { canUpdateProjects } = useWorkspacePermission();
  return {
    currentUserId: user?.id ?? null,
    canUpdateProjects: canUpdateProjects(),
  };
}

/**
 * Mirrors the API rule: the human author of an entry, or anyone with
 * project:update. An agent entry has no human author, so only the latter
 * applies. An already-deleted row offers restore instead (project:update).
 */
export function canDeleteEntry(
  entry: {
    deletedAt: string | null;
    author: { userId: string } | null;
  },
  { currentUserId, canUpdateProjects }: EntryPermissions,
) {
  if (entry.deletedAt) return false;
  if (canUpdateProjects) return true;
  return Boolean(currentUserId && entry.author?.userId === currentUserId);
}

export type DeletableEntry = { id: string; summary: string };

type EntryDeleteDialogProps = {
  projectId: string;
  /** The entry awaiting confirmation; null keeps the dialog closed. */
  entry: DeletableEntry | null;
  onClose: () => void;
  /** After the API accepted the delete — e.g. to close a sheet showing it. */
  onDeleted?: (entry: DeletableEntry) => void;
};

/**
 * One confirm dialog shared by every entry list and the detail sheet, so the
 * copy and the error mapping (403: not author / no project:update, 404:
 * already gone) stay identical wherever the delete is triggered.
 */
export function EntryDeleteDialog({
  projectId,
  entry,
  onClose,
  onDeleted,
}: EntryDeleteDialogProps) {
  const { t } = useTranslation();
  const remove = useDeleteAgentEntry();

  const handleDelete = async () => {
    if (!entry) return;
    try {
      await remove.mutateAsync({ projectId, entryId: entry.id });
      toast.success(t("agentLayer:timeline.entryDeleted"));
      onClose();
      onDeleted?.(entry);
    } catch (cause) {
      toast.error(t("agentLayer:timeline.deleteFailed"), {
        description: isAgentLayerStatus(cause, 403)
          ? t("agentLayer:timeline.deleteForbidden")
          : isAgentLayerStatus(cause, 404)
            ? t("agentLayer:timeline.deleteNotFound")
            : cause instanceof Error
              ? cause.message
              : undefined,
      });
    }
  };

  return (
    <AlertDialog
      open={Boolean(entry)}
      onOpenChange={(open) => !open && !remove.isPending && onClose()}
    >
      <AlertDialogContent data-testid="entry-delete-dialog">
        <AlertDialogHeader>
          <AlertDialogTitle>
            {t("agentLayer:timeline.deleteTitle")}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {entry ? (
              <span className="mb-1 block truncate font-medium text-foreground">
                {entry.summary}
              </span>
            ) : null}
            {t("agentLayer:timeline.deleteDescription")}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogClose
            render={
              <Button variant="outline" size="sm" disabled={remove.isPending} />
            }
          >
            {t("agentLayer:timeline.cancel")}
          </AlertDialogClose>
          <Button
            size="sm"
            variant="destructive"
            disabled={remove.isPending}
            onClick={handleDelete}
            data-testid="entry-delete-submit"
          >
            {remove.isPending
              ? t("agentLayer:timeline.deleting")
              : t("agentLayer:timeline.delete")}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/**
 * Restore needs no confirmation — it only undoes a hide — so this is the
 * click handler with the toasts, shared by the lists and the sheet.
 */
export function useRestoreEntry(projectId: string) {
  const { t } = useTranslation();
  const restore = useRestoreAgentEntry();

  const run = async (entryId: string) => {
    try {
      await restore.mutateAsync({ projectId, entryId });
      toast.success(t("agentLayer:timeline.entryRestored"));
    } catch (cause) {
      toast.error(t("agentLayer:timeline.restoreFailed"), {
        description: isAgentLayerStatus(cause, 403)
          ? t("agentLayer:timeline.restoreForbidden")
          : isAgentLayerStatus(cause, 404)
            ? t("agentLayer:timeline.restoreNotFound")
            : cause instanceof Error
              ? cause.message
              : undefined,
      });
    }
  };

  return { restore: run, isPending: restore.isPending };
}
