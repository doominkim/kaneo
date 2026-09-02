import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type {
  AgentEntryKind,
  AgentEntrySummary,
} from "@/fetchers/agent-layer/get-agent-entries";
import { useAgentEntries } from "@/hooks/queries/agent-layer/use-agent-entries";
import { cn } from "@/lib/cn";
import { formatDateTime, formatRelativeTime } from "@/lib/format";
import {
  AgentLayerEmpty,
  AgentLayerErrorState,
  AgentLayerSkeleton,
} from "./agent-layer-state";
import { actorLine, formatTokens, KindBadge } from "./chips";
import { EntryDetailSheet } from "./entry-detail-sheet";

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

/** Notes tab: newest-first ledger with a kind filter and cursor paging (§6). */
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
          {t("agentLayer:notes.title")}
        </h1>
        <div className="inline-flex h-8 items-center gap-0.5 rounded-lg border border-border/80 bg-background p-0.5">
          <FilterButton
            active={kind === undefined}
            onClick={() => setKind(undefined)}
          >
            {t("agentLayer:notes.filterAll")}
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
            title={t("agentLayer:notes.empty")}
            description={t("agentLayer:notes.emptyHint")}
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

function EntryRow({
  entry,
  projectSlug,
  taskNumber,
  onOpen,
}: {
  entry: AgentEntrySummary;
  projectSlug?: string;
  taskNumber?: number | null;
  onOpen: () => void;
}) {
  const { t } = useTranslation();
  const meta = actorLine(entry);
  const tokens = entry.usage?.totalTokens;

  return (
    <li>
      <button
        type="button"
        onClick={onOpen}
        data-testid="entry-row"
        className="flex w-full flex-col gap-1 px-3 py-2.5 text-left transition-colors hover:bg-muted/60"
      >
        <div className="flex w-full items-start gap-2">
          <KindBadge kind={entry.kind} />
          <span className="min-w-0 flex-1 text-sm font-medium leading-snug text-foreground">
            {entry.summary}
          </span>
          <span
            className="shrink-0 text-xs text-muted-foreground"
            title={formatDateTime(entry.createdAt)}
          >
            {formatRelativeTime(entry.createdAt)}
          </span>
        </div>
        <div className="flex w-full flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
          {meta ? <span>{meta}</span> : null}
          {typeof tokens === "number" ? (
            <span>
              {t("agentLayer:common.tokens", { value: formatTokens(tokens) })}
            </span>
          ) : null}
          {entry.taskId ? (
            <span className="font-mono">
              {projectSlug ? `${projectSlug}-` : "#"}
              {taskNumber ?? "?"}
            </span>
          ) : null}
          {entry.hasDecision ? (
            <Badge variant="warning" size="sm">
              {t("agentLayer:notes.hasDecision")}
            </Badge>
          ) : null}
          {entry.coreChanged && entry.coreChanged.length > 0 ? (
            <Badge variant="error" size="sm" data-testid="core-changed-badge">
              {t("agentLayer:notes.coreChanged")}
            </Badge>
          ) : null}
        </div>
      </button>
    </li>
  );
}
