import { useTranslation } from "react-i18next";
import { Badge } from "@/components/ui/badge";
import type { AgentEntrySummary } from "@/fetchers/agent-layer/get-agent-entries";
import { formatDateTime, formatRelativeTime } from "@/lib/format";
import { actorLine, BranchChip, formatTokens, KindBadge } from "./chips";

/** One ledger entry line; shared by the project ledger and the per-task fold. */
export function EntryRow({
  entry,
  projectSlug,
  taskNumber,
  showTask = true,
  onOpen,
}: {
  entry: AgentEntrySummary;
  projectSlug?: string;
  taskNumber?: number | null;
  showTask?: boolean;
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
          {showTask && entry.taskId ? (
            <span className="font-mono">
              {projectSlug ? `${projectSlug}-` : "#"}
              {taskNumber ?? "?"}
            </span>
          ) : null}
          {entry.branch ? (
            <BranchChip repo={entry.repo} branch={entry.branch} />
          ) : null}
          {entry.hasDecision ? (
            <Badge variant="warning" size="sm">
              {t("agentLayer:timeline.hasDecision")}
            </Badge>
          ) : null}
          {entry.coreChanged && entry.coreChanged.length > 0 ? (
            <Badge variant="error" size="sm" data-testid="core-changed-badge">
              {t("agentLayer:timeline.coreChanged")}
            </Badge>
          ) : null}
        </div>
      </button>
    </li>
  );
}
