import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import type { AgentEntryKind } from "@/fetchers/agent-layer/get-agent-entries";
import { useAgentEntries } from "@/hooks/queries/agent-layer/use-agent-entries";
import { cn } from "@/lib/cn";
import {
  AgentLayerEmpty,
  AgentLayerErrorState,
  AgentLayerSkeleton,
} from "./agent-layer-state";
import { EntryDetailSheet } from "./entry-detail-sheet";
import { EntryRow } from "./entry-row";

const KINDS: AgentEntryKind[] = [
  "work",
  "investigation",
  "decision",
  "handoff",
];

type EntryTimelineProps = {
  projectId: string;
  workspaceId: string;
  projectSlug?: string;
  taskNumberById: Map<string, number | null>;
};

/**
 * Project-wide ledger with a kind filter and cursor paging. No longer mounted
 * as a tab (the timeline tab shows entries per task); kept for reuse.
 */
export function EntryTimeline({
  projectId,
  workspaceId,
  projectSlug,
  taskNumberById,
}: EntryTimelineProps) {
  const { t } = useTranslation();
  const [kind, setKind] = useState<AgentEntryKind | undefined>(undefined);
  const [selectedEntryId, setSelectedEntryId] = useState<string | null>(null);
  const query = useAgentEntries(projectId, kind);

  const entries = query.data?.pages.flatMap((page) => page.entries) ?? [];

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b border-border/80 px-3 py-2.5 sm:px-4">
        <h1 className="mr-2 text-sm font-semibold text-foreground">
          {t("agentLayer:timeline.title")}
        </h1>
        <div className="inline-flex h-8 items-center gap-0.5 rounded-lg border border-border/80 bg-background p-0.5">
          <FilterButton
            active={kind === undefined}
            onClick={() => setKind(undefined)}
          >
            {t("agentLayer:timeline.filterAll")}
          </FilterButton>
          {KINDS.map((option) => (
            <FilterButton
              key={option}
              active={kind === option}
              onClick={() => setKind(option)}
            >
              {t(`agentLayer:kind.${option}`)}
            </FilterButton>
          ))}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3 sm:px-4">
        {query.isPending ? (
          <AgentLayerSkeleton rows={6} />
        ) : query.isError ? (
          <AgentLayerErrorState
            error={query.error}
            onRetry={() => query.refetch()}
          />
        ) : entries.length === 0 ? (
          <AgentLayerEmpty
            title={t("agentLayer:timeline.empty")}
            description={t("agentLayer:timeline.emptyHint")}
          />
        ) : (
          <ol className="mx-auto max-w-3xl divide-y divide-border/70 rounded-lg border border-border/80 bg-background">
            {entries.map((entry) => (
              <EntryRow
                key={entry.id}
                entry={entry}
                projectSlug={projectSlug}
                taskNumber={
                  entry.taskId ? taskNumberById.get(entry.taskId) : undefined
                }
                onOpen={() => setSelectedEntryId(entry.id)}
              />
            ))}
          </ol>
        )}

        {query.hasNextPage ? (
          <div className="mx-auto mt-3 flex max-w-3xl justify-center">
            <Button
              variant="outline"
              size="sm"
              disabled={query.isFetchingNextPage}
              onClick={() => query.fetchNextPage()}
            >
              {t("agentLayer:common.loadMore")}
            </Button>
          </div>
        ) : null}
      </div>

      <EntryDetailSheet
        projectId={projectId}
        workspaceId={workspaceId}
        projectSlug={projectSlug}
        entryId={selectedEntryId}
        taskNumberById={taskNumberById}
        onClose={() => setSelectedEntryId(null)}
      />
    </div>
  );
}

function FilterButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <Button
      variant={active ? "secondary" : "ghost"}
      size="xs"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "h-6 rounded-md px-2 text-xs",
        !active && "text-muted-foreground",
      )}
    >
      {children}
    </Button>
  );
}
