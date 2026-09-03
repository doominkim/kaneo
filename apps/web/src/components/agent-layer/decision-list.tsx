import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { useAgentEntries } from "@/hooks/queries/agent-layer/use-agent-entries";
import {
  AgentLayerEmpty,
  AgentLayerErrorState,
  AgentLayerSkeleton,
} from "./agent-layer-state";
import { EntryRow } from "./entry-row";

type DecisionListProps = {
  projectId: string;
  projectSlug?: string;
  taskNumberById: Map<string, number | null>;
  onOpenEntry: (entryId: string) => void;
};

/** Decision section of the knowledge tab: `kind=decision` entries, newest first. */
export function DecisionList({
  projectId,
  projectSlug,
  taskNumberById,
  onOpenEntry,
}: DecisionListProps) {
  const { t } = useTranslation();
  const query = useAgentEntries(projectId, "decision");
  const entries = query.data?.pages.flatMap((page) => page.entries) ?? [];

  return (
    <div className="space-y-3" data-testid="decision-list">
      {query.isPending ? (
        <AgentLayerSkeleton rows={4} />
      ) : query.isError ? (
        <AgentLayerErrorState
          error={query.error}
          onRetry={() => query.refetch()}
        />
      ) : entries.length === 0 ? (
        <AgentLayerEmpty
          title={t("agentLayer:knowledge.decisionsEmpty")}
          description={t("agentLayer:knowledge.decisionsEmptyHint")}
        />
      ) : (
        <ol className="divide-y divide-border/70 rounded-lg border border-border/80 bg-background">
          {entries.map((entry) => (
            <EntryRow
              key={entry.id}
              entry={entry}
              projectSlug={projectSlug}
              taskNumber={
                entry.taskId ? taskNumberById.get(entry.taskId) : undefined
              }
              onOpen={() => onOpenEntry(entry.id)}
            />
          ))}
        </ol>
      )}
      {query.hasNextPage ? (
        <div className="flex justify-center">
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
  );
}
