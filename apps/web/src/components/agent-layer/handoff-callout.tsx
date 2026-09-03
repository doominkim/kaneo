import { ArrowRightLeft } from "lucide-react";
import { useTranslation } from "react-i18next";
import { MarkdownRenderer } from "@/components/public-project/markdown-renderer";
import type { LatestAgentEntry } from "@/hooks/queries/agent-layer/use-agent-latest-entry";
import { formatDateTime, formatRelativeTime } from "@/lib/format";
import { AgentLayerEmpty } from "./agent-layer-state";
import { BranchChip, KindBadge } from "./chips";
import { EntryAuthor } from "./entry-author";

type HandoffCalloutProps = {
  latest: LatestAgentEntry;
};

/**
 * Notion-style callout: the newest handoff's summary as heading, its body as
 * markdown, and the author as footer (DESIGN.md §6 item 1). The source is the
 * newest handoff regardless of who wrote it; a person's handoff shows their
 * name where an agent's shows the model.
 */
export function HandoffCallout({ latest }: HandoffCalloutProps) {
  const { t } = useTranslation();

  if (!latest) {
    return (
      <AgentLayerEmpty
        title={t("agentLayer:overview.handoffEmpty")}
        description={t("agentLayer:overview.handoffEmptyHint")}
      />
    );
  }

  const { entry, isFallback } = latest;

  return (
    <section
      data-testid="handoff-callout"
      className="rounded-xl border border-border/80 bg-muted/40 p-4 sm:p-5"
    >
      <div className="flex items-start gap-3">
        <div className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-md border border-border bg-background text-foreground">
          <ArrowRightLeft className="size-4" />
        </div>
        <div className="min-w-0 flex-1 space-y-3">
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              <span>
                {isFallback
                  ? t("agentLayer:overview.latestEntryTitle")
                  : t("agentLayer:overview.handoffTitle")}
              </span>
              <KindBadge kind={entry.kind} />
              {entry.refs?.branch ? (
                <BranchChip
                  repo={entry.refs.repo}
                  branch={entry.refs.branch}
                  className="normal-case tracking-normal"
                />
              ) : null}
            </div>
            <h2 className="text-base font-semibold leading-snug text-foreground">
              {entry.summary}
            </h2>
            {isFallback ? (
              <p className="text-xs text-muted-foreground">
                {t("agentLayer:overview.handoffFallbackHint")}
              </p>
            ) : null}
          </div>

          {entry.body ? (
            <div className="text-sm">
              <MarkdownRenderer content={entry.body} />
            </div>
          ) : null}

          <p
            data-testid="handoff-footer"
            className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-muted-foreground"
            title={formatDateTime(entry.createdAt)}
          >
            <EntryAuthor entry={entry} />
            <span aria-hidden="true">·</span>
            <span>{formatRelativeTime(entry.createdAt)}</span>
          </p>
        </div>
      </div>
    </section>
  );
}
