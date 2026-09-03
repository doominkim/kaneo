import { RotateCcw, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { AgentEntrySummary } from "@/fetchers/agent-layer/get-agent-entries";
import { cn } from "@/lib/cn";
import { formatDateTime, formatRelativeTime } from "@/lib/format";
import { BranchChip, formatTokens, KindBadge } from "./chips";
import { EntryAuthor } from "./entry-author";

/**
 * One ledger entry line; shared by the project ledger and the per-task fold.
 * The row itself is presentational: the parent decides whether delete or
 * restore applies (see `canDeleteEntry`) and passes the handler, so the rule
 * lives in one place and this stays a plain render.
 */
export function EntryRow({
  entry,
  projectSlug,
  taskNumber,
  showTask = true,
  onOpen,
  onDelete,
  onRestore,
}: {
  entry: AgentEntrySummary;
  projectSlug?: string;
  taskNumber?: number | null;
  showTask?: boolean;
  onOpen: () => void;
  /** Given only when the viewer may delete this (live) entry. */
  onDelete?: () => void;
  /** Given only for a deleted entry the viewer may restore (project:update). */
  onRestore?: () => void;
}) {
  const { t } = useTranslation();
  // Usage is an agent-only field (the API refuses it on a human entry), so
  // the chip is tied to `actor` rather than to whatever the row carries.
  const tokens = entry.actor ? entry.usage?.totalTokens : undefined;
  const deleted = Boolean(entry.deletedAt);
  const action = deleted
    ? onRestore
      ? { kind: "restore" as const, run: onRestore }
      : null
    : onDelete
      ? { kind: "delete" as const, run: onDelete }
      : null;

  return (
    <li
      className={cn("flex items-start", deleted && "opacity-60")}
      data-deleted={deleted ? "true" : "false"}
    >
      <button
        type="button"
        onClick={onOpen}
        data-testid="entry-row"
        data-author-kind={
          entry.author ? "human" : entry.actor ? "agent" : "unknown"
        }
        data-deleted={deleted ? "true" : "false"}
        className="flex min-w-0 flex-1 flex-col gap-1 px-3 py-2.5 text-left transition-colors hover:bg-muted/60"
      >
        <div className="flex w-full items-start gap-2">
          <KindBadge kind={entry.kind} />
          <span
            className={cn(
              "min-w-0 flex-1 text-sm font-medium leading-snug text-foreground",
              deleted && "line-through decoration-muted-foreground/70",
            )}
          >
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
          <EntryAuthor entry={entry} />
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
          {deleted ? (
            <Badge
              variant="secondary"
              size="sm"
              data-testid="entry-deleted-badge"
              title={
                entry.deletedAt ? formatDateTime(entry.deletedAt) : undefined
              }
            >
              {t("agentLayer:timeline.deleted")}
            </Badge>
          ) : null}
        </div>
      </button>
      {action ? (
        <div className="shrink-0 py-2 pr-2">
          <Button
            type="button"
            variant="ghost"
            size="xs"
            className="text-muted-foreground hover:text-foreground"
            onClick={action.run}
            data-testid={
              action.kind === "delete" ? "entry-delete" : "entry-restore"
            }
            aria-label={
              action.kind === "delete"
                ? t("agentLayer:timeline.delete")
                : t("agentLayer:timeline.restore")
            }
            title={
              action.kind === "delete"
                ? t("agentLayer:timeline.delete")
                : t("agentLayer:timeline.restore")
            }
          >
            {action.kind === "delete" ? <Trash2 /> : <RotateCcw />}
            {action.kind === "restore" ? (
              <span>{t("agentLayer:timeline.restore")}</span>
            ) : null}
          </Button>
        </div>
      ) : null}
    </li>
  );
}
