import { NotebookPen } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { NO_TASK_FILTER } from "@/fetchers/agent-layer/get-agent-entries";
import { useAgentEntries } from "@/hooks/queries/agent-layer/use-agent-entries";
import { AgentLayerErrorState, AgentLayerSkeleton } from "./agent-layer-state";
import {
  canDeleteEntry,
  type DeletableEntry,
  EntryDeleteDialog,
  useEntryPermissions,
  useRestoreEntry,
} from "./entry-actions";
import { EntryRow } from "./entry-row";

type ProjectEntriesProps = {
  projectId: string;
  projectSlug?: string;
  /** Maintainer's view: also list soft-deleted rows (needs project:update). */
  showDeleted?: boolean;
  onOpenEntry: (entryId: string) => void;
};

/**
 * The project-level ledger: entries with no task, newest first. The task tree
 * hangs entries under task nodes, so a note written from the timeline header
 * (task_id NULL) has nowhere else to appear. Same page size and cursor as the
 * per-task fold; the append mutation's prefix invalidation covers this key.
 */
export function ProjectEntries({
  projectId,
  projectSlug,
  showDeleted = false,
  onOpenEntry,
}: ProjectEntriesProps) {
  const { t } = useTranslation();
  const query = useAgentEntries(
    projectId,
    undefined,
    NO_TASK_FILTER,
    showDeleted,
  );
  const entries = query.data?.pages.flatMap((page) => page.entries) ?? [];
  const permissions = useEntryPermissions();
  const { restore } = useRestoreEntry(projectId);
  const [pendingDelete, setPendingDelete] = useState<DeletableEntry | null>(
    null,
  );

  return (
    <section
      data-testid="project-entries"
      aria-labelledby="project-entries-heading"
      className="mb-5 space-y-2"
    >
      <h2
        id="project-entries-heading"
        className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground"
      >
        <NotebookPen className="size-3.5" />
        {t("agentLayer:timeline.projectEntries")}
      </h2>
      {query.isPending ? (
        <AgentLayerSkeleton rows={2} />
      ) : query.isError ? (
        <AgentLayerErrorState
          error={query.error}
          onRetry={() => query.refetch()}
        />
      ) : entries.length === 0 ? (
        <p
          data-testid="project-entries-empty"
          className="rounded-md border border-dashed border-border px-3 py-2 text-xs text-muted-foreground"
        >
          {t("agentLayer:timeline.projectEntriesEmpty")}
        </p>
      ) : (
        <ol className="divide-y divide-border/70 rounded-lg border border-border/80 bg-background">
          {entries.map((entry) => (
            <EntryRow
              key={entry.id}
              entry={entry}
              projectSlug={projectSlug}
              showTask={false}
              onOpen={() => onOpenEntry(entry.id)}
              onDelete={
                canDeleteEntry(entry, permissions)
                  ? () => setPendingDelete(entry)
                  : undefined
              }
              onRestore={
                entry.deletedAt && permissions.canUpdateProjects
                  ? () => restore(entry.id)
                  : undefined
              }
            />
          ))}
        </ol>
      )}
      {query.hasNextPage ? (
        <div className="flex justify-center">
          <Button
            variant="outline"
            size="xs"
            data-testid="project-entries-more"
            disabled={query.isFetchingNextPage}
            onClick={() => query.fetchNextPage()}
          >
            {t("agentLayer:common.loadMore")}
          </Button>
        </div>
      ) : null}
      <EntryDeleteDialog
        projectId={projectId}
        entry={pendingDelete}
        onClose={() => setPendingDelete(null)}
      />
    </section>
  );
}
