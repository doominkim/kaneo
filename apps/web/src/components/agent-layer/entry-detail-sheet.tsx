import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { MarkdownRenderer } from "@/components/public-project/markdown-renderer";
import { Badge } from "@/components/ui/badge";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { useAgentEntry } from "@/hooks/queries/agent-layer/use-agent-entry";
import { formatDateTime } from "@/lib/format";
import { AgentLayerErrorState, AgentLayerSkeleton } from "./agent-layer-state";
import { BranchChip, formatTokens, KindBadge } from "./chips";
import { EntryAuthor } from "./entry-author";

type EntryDetailSheetProps = {
  projectId: string;
  workspaceId: string;
  projectSlug?: string;
  entryId: string | null;
  taskNumberById: Map<string, number | null>;
  onClose: () => void;
};

type Decision = {
  what: string;
  why: string;
  rejected?: string | null;
  reversible?: boolean;
};

// `decision` is typed `unknown` on the wire; older rows may carry any shape.
function parseDecision(value: unknown): Decision | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  if (typeof record.what !== "string" || typeof record.why !== "string") {
    return null;
  }
  return {
    what: record.what,
    why: record.why,
    rejected: typeof record.rejected === "string" ? record.rejected : null,
    reversible:
      typeof record.reversible === "boolean" ? record.reversible : undefined,
  };
}

export function EntryDetailSheet({
  projectId,
  workspaceId,
  projectSlug,
  entryId,
  taskNumberById,
  onClose,
}: EntryDetailSheetProps) {
  const { t } = useTranslation();
  const query = useAgentEntry(projectId, entryId);
  const entry = query.data;
  const decision = entry ? parseDecision(entry.decision) : null;
  const refs = entry?.refs ?? null;

  return (
    <Sheet open={Boolean(entryId)} onOpenChange={(open) => !open && onClose()}>
      <SheetContent
        side="right"
        className="w-full max-w-full sm:max-w-lg md:max-w-2xl"
      >
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            {entry ? <KindBadge kind={entry.kind} /> : null}
            <span className="min-w-0 truncate">
              {entry?.summary ?? t("agentLayer:timeline.detailTitle")}
            </span>
          </SheetTitle>
          <SheetDescription className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
            {entry ? (
              <>
                <EntryAuthor entry={entry} />
                <span aria-hidden="true">·</span>
                <span>{formatDateTime(entry.createdAt)}</span>
              </>
            ) : null}
          </SheetDescription>
        </SheetHeader>

        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-6 pb-6 text-sm">
          {query.isPending && entryId ? (
            <AgentLayerSkeleton rows={4} />
          ) : query.isError ? (
            <AgentLayerErrorState
              error={query.error}
              onRetry={() => query.refetch()}
            />
          ) : entry ? (
            <>
              <div className="flex flex-wrap items-center gap-1.5">
                {entry.taskId ? (
                  <Link
                    to="/dashboard/workspace/$workspaceId/project/$projectId/task/$taskId"
                    params={{ workspaceId, projectId, taskId: entry.taskId }}
                    className="font-mono text-xs text-foreground/80 underline-offset-2 hover:underline"
                  >
                    {t("agentLayer:timeline.task")}{" "}
                    {projectSlug ? `${projectSlug}-` : "#"}
                    {taskNumberById.get(entry.taskId) ?? "?"}
                  </Link>
                ) : null}
                {refs?.branch ? (
                  <BranchChip repo={refs.repo} branch={refs.branch} />
                ) : null}
                {entry.actor && entry.usage?.totalTokens !== undefined ? (
                  <Badge variant="outline" size="sm">
                    {t("agentLayer:common.tokens", {
                      value: formatTokens(entry.usage.totalTokens),
                    })}
                  </Badge>
                ) : null}
              </div>

              <Section title={t("agentLayer:timeline.body")}>
                {entry.body ? (
                  <MarkdownRenderer content={entry.body} />
                ) : (
                  <p className="text-muted-foreground">
                    {t("agentLayer:timeline.noBody")}
                  </p>
                )}
              </Section>

              {decision ? (
                <Section title={t("agentLayer:timeline.decision")}>
                  <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5">
                    <Term>{t("agentLayer:timeline.decisionWhat")}</Term>
                    <dd>{decision.what}</dd>
                    <Term>{t("agentLayer:timeline.decisionWhy")}</Term>
                    <dd>{decision.why}</dd>
                    {decision.rejected ? (
                      <>
                        <Term>{t("agentLayer:timeline.decisionRejected")}</Term>
                        <dd>{decision.rejected}</dd>
                      </>
                    ) : null}
                    {decision.reversible !== undefined ? (
                      <>
                        <Term>{t("agentLayer:timeline.reversible")}</Term>
                        <dd>
                          <Badge
                            variant={
                              decision.reversible ? "success" : "warning"
                            }
                            size="sm"
                          >
                            {decision.reversible
                              ? t("agentLayer:timeline.reversible")
                              : t("agentLayer:timeline.irreversible")}
                          </Badge>
                        </dd>
                      </>
                    ) : null}
                  </dl>
                </Section>
              ) : null}

              {refs ? (
                <Section title={t("agentLayer:timeline.refs")}>
                  <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5">
                    {refs.repo ? (
                      <>
                        <Term>{t("agentLayer:timeline.refsRepo")}</Term>
                        <dd className="font-mono text-xs">{refs.repo}</dd>
                      </>
                    ) : null}
                    {refs.branch ? (
                      <>
                        <Term>{t("agentLayer:timeline.refsBranch")}</Term>
                        <dd className="font-mono text-xs">{refs.branch}</dd>
                      </>
                    ) : null}
                    <RefList
                      label={t("agentLayer:timeline.refsCommits")}
                      items={refs.commits}
                    />
                    <RefList
                      label={t("agentLayer:timeline.refsPrs")}
                      items={refs.prs}
                    />
                    <RefList
                      label={t("agentLayer:timeline.refsFiles")}
                      items={refs.files}
                    />
                  </dl>
                </Section>
              ) : null}

              {entry.coreChanged && entry.coreChanged.length > 0 ? (
                <Section title={t("agentLayer:timeline.coreChangedList")}>
                  <ul className="space-y-0.5 font-mono text-xs">
                    {entry.coreChanged.map((path) => (
                      <li key={path}>{path}</li>
                    ))}
                  </ul>
                </Section>
              ) : null}
            </>
          ) : null}
        </div>
      </SheetContent>
    </Sheet>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-1.5">
      <h3 className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        {title}
      </h3>
      {children}
    </section>
  );
}

function Term({ children }: { children: React.ReactNode }) {
  return <dt className="text-xs text-muted-foreground">{children}</dt>;
}

function RefList({ label, items }: { label: string; items?: string[] }) {
  if (!items || items.length === 0) return null;
  return (
    <>
      <Term>{label}</Term>
      <dd>
        <ul className="space-y-0.5 font-mono text-xs break-all">
          {items.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </dd>
    </>
  );
}
