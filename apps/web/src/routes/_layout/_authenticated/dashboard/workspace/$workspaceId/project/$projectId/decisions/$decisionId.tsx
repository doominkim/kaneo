import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { ArrowLeft, Pencil, Plus, Search } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { z } from "zod";
import { AdrEditorDialog } from "@/components/agent-layer/adr-editor-dialog";
import { AgentAuthorBadge } from "@/components/agent-layer/agent-author-badge";
import ProjectLayout from "@/components/common/project-layout";
import PageTitle from "@/components/page-title";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAcceptAgentDecision } from "@/hooks/mutations/agent-layer/use-agent-decisions";
import {
  useAgentDecision,
  useAgentDecisions,
} from "@/hooks/queries/agent-layer/use-agent-decisions";
import { useWorkspacePermission } from "@/hooks/use-workspace-permission";

const decisionStatus = z.enum([
  "current",
  "all",
  "draft",
  "accepted",
  "superseded",
]);

export const Route = createFileRoute(
  "/_layout/_authenticated/dashboard/workspace/$workspaceId/project/$projectId/decisions/$decisionId",
)({
  validateSearch: z.object({
    supersedes: z.string().optional(),
    origin: z
      .enum(["knowledge", "task"])
      .catch("knowledge")
      .default("knowledge"),
    taskId: z.string().optional(),
    status: decisionStatus.catch("current").default("current"),
    q: z.string().max(200).optional(),
  }),
  component: RouteComponent,
});

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-2">
      <h2 className="text-sm font-semibold">{title}</h2>
      <div className="whitespace-pre-wrap text-sm leading-6 text-foreground">
        {children}
      </div>
    </section>
  );
}

function RefList({ label, items }: { label: string; items?: string[] }) {
  if (!items?.length) return null;
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd>
        <ul className="space-y-0.5 font-mono text-xs break-all">
          {items.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </dd>
    </div>
  );
}

function RouteComponent() {
  const { t } = useTranslation();
  const { workspaceId, projectId, decisionId } = Route.useParams();
  const search = Route.useSearch();
  const navigate = useNavigate();
  const decision = useAgentDecision(projectId, decisionId);
  const { canUpdateTasks, canUpdateProjects } = useWorkspacePermission();
  const [edit, setEdit] = useState(false);
  const [replacement, setReplacement] = useState(false);
  const [acceptedSearch, setAcceptedSearch] = useState("");
  const [replacementChoice, setReplacementChoice] = useState<{
    ownerId: string;
    value: string;
  } | null>(null);
  const [acceptError, setAcceptError] = useState<string | null>(null);
  const accept = useAcceptAgentDecision();
  const item = decision.data;
  const selectedSupersedes =
    replacementChoice && replacementChoice.ownerId === decisionId
      ? replacementChoice.value
      : (search.supersedes ?? "");
  const selectedSupersedesDetail = useAgentDecision(
    projectId,
    selectedSupersedes || undefined,
  );
  const accepted = useAgentDecisions({
    projectId,
    status: "accepted",
    q: acceptedSearch.trim() || undefined,
  });

  const back = () => {
    if (search.origin === "task" && search.taskId) {
      return navigate({
        to: "/dashboard/workspace/$workspaceId/project/$projectId/task/$taskId",
        params: { workspaceId, projectId, taskId: search.taskId },
      });
    }
    return navigate({
      to: "/dashboard/workspace/$workspaceId/project/$projectId/knowledge",
      params: { workspaceId, projectId },
      search: {
        tab: "decisions",
        status: search.status,
        ...(search.q ? { q: search.q } : {}),
      },
    });
  };

  const acceptDraft = async () => {
    if (!item) return;
    if (
      selectedSupersedes &&
      !window.confirm(t("agentLayer:adr.confirmSupersede"))
    ) {
      return;
    }
    try {
      setAcceptError(null);
      await accept.mutateAsync({
        projectId,
        decisionId: item.id,
        expectedUpdatedAt: item.updatedAt,
        ...(selectedSupersedes
          ? { supersedesDecisionId: selectedSupersedes }
          : {}),
      });
    } catch {
      setAcceptError(t("agentLayer:adr.acceptFailed"));
    }
  };

  if (decision.isPending) {
    return (
      <ProjectLayout
        projectId={projectId}
        workspaceId={workspaceId}
        activeView="knowledge"
      >
        <p className="p-5 text-sm text-muted-foreground">
          {t("agentLayer:adr.loadingDetail")}
        </p>
      </ProjectLayout>
    );
  }
  if (!item) {
    return (
      <ProjectLayout
        projectId={projectId}
        workspaceId={workspaceId}
        activeView="knowledge"
      >
        <div className="space-y-3 p-5">
          {decision.isError ? (
            <p className="text-sm text-destructive">
              {t("agentLayer:adr.detailLoadFailed")}
            </p>
          ) : null}
          <Button variant="outline" onClick={back}>
            {t("agentLayer:adr.back")}
          </Button>
        </div>
      </ProjectLayout>
    );
  }

  const statusLabel = {
    draft: t("agentLayer:adr.statusDraft"),
    accepted: t("agentLayer:adr.statusAccepted"),
    superseded: t("agentLayer:adr.statusSuperseded"),
  }[item.status];
  const acceptedRecords =
    accepted.data?.pages
      .flatMap((page) => page.decisions)
      .filter((record) => record.id !== item.id) ?? [];
  const selectedRecord = selectedSupersedesDetail.data;
  const acceptedOptions = [
    ...acceptedRecords,
    ...(selectedRecord &&
    selectedRecord.id !== item.id &&
    !acceptedRecords.some((record) => record.id === selectedRecord.id)
      ? [selectedRecord]
      : []),
  ];
  const refs = item.refs;

  return (
    <ProjectLayout
      projectId={projectId}
      workspaceId={workspaceId}
      activeView="knowledge"
    >
      <PageTitle
        title={`ADR-${String(item.number).padStart(3, "0")} · ${item.title}`}
        hideAppName
      />
      <div className="h-full overflow-y-auto">
        <article className="mx-auto max-w-3xl space-y-7 px-4 py-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <Button variant="ghost" size="sm" onClick={back}>
              <ArrowLeft /> {t("agentLayer:adr.back")}
            </Button>
            <div className="flex gap-2">
              {item.status === "draft" && canUpdateTasks() ? (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setEdit(true)}
                >
                  <Pencil /> {t("agentLayer:adr.editAction")}
                </Button>
              ) : null}
              {item.status === "draft" && canUpdateProjects() ? (
                <Button
                  size="sm"
                  onClick={acceptDraft}
                  disabled={accept.isPending}
                  data-testid="accept-adr"
                >
                  {accept.isPending
                    ? t("agentLayer:adr.accepting")
                    : t("agentLayer:adr.accept")}
                </Button>
              ) : null}
              {item.status === "accepted" && canUpdateTasks() ? (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setReplacement(true)}
                >
                  <Plus /> {t("agentLayer:adr.createReplacement")}
                </Button>
              ) : null}
            </div>
          </div>

          <header className="space-y-2 border-b pb-5">
            <div className="flex items-center gap-2">
              <span className="font-mono text-sm text-muted-foreground">
                ADR-{String(item.number).padStart(3, "0")}
              </span>
              <Badge
                variant={
                  item.status === "accepted"
                    ? "success"
                    : item.status === "superseded"
                      ? "secondary"
                      : "outline"
                }
              >
                {statusLabel}
              </Badge>
            </div>
            <h1 className="text-2xl font-semibold">{item.title}</h1>
            <div className="flex flex-wrap items-center gap-1.5 text-sm text-muted-foreground">
              <span>{t("agentLayer:adr.createdBy")}</span>
              {item.createdAuthor || item.createdActor ? (
                <AgentAuthorBadge
                  actor={item.createdActor}
                  humanName={item.createdAuthor?.name}
                />
              ) : (
                <span>{t("agentLayer:common.unknownAuthor")}</span>
              )}
              <span>· {new Date(item.createdAt).toLocaleString()}</span>
              {item.acceptedAt ? (
                <>
                  <span>· {t("agentLayer:adr.acceptedBy")}</span>
                  {item.acceptor ? (
                    <AgentAuthorBadge humanName={item.acceptor.name} />
                  ) : (
                    <span>{t("agentLayer:common.unknownAuthor")}</span>
                  )}
                  <span>· {new Date(item.acceptedAt).toLocaleString()}</span>
                </>
              ) : null}
            </div>
          </header>

          {item.status === "draft" && canUpdateProjects() ? (
            <section className="space-y-2">
              <label
                className="block text-sm font-medium"
                htmlFor="adr-supersedes-search"
              >
                {t("agentLayer:adr.supersedes")}
              </label>
              <div className="relative">
                <Search className="absolute left-2 top-2 size-4 text-muted-foreground" />
                <Input
                  id="adr-supersedes-search"
                  className="pl-8"
                  value={acceptedSearch}
                  onChange={(event) => setAcceptedSearch(event.target.value)}
                  placeholder={t("agentLayer:adr.searchAccepted")}
                />
              </div>
              <select
                className="w-full rounded border bg-background p-2 text-sm"
                value={selectedSupersedes}
                onChange={(event) =>
                  setReplacementChoice({
                    ownerId: decisionId,
                    value: event.target.value,
                  })
                }
                data-testid="adr-supersedes-select"
                disabled={accept.isPending}
              >
                <option value="">{t("agentLayer:adr.noSupersedes")}</option>
                {acceptedOptions.map((record) => (
                  <option value={record.id} key={record.id}>
                    ADR-{String(record.number).padStart(3, "0")} ·{" "}
                    {record.title}
                  </option>
                ))}
              </select>
              {accepted.isError ? (
                <div className="flex items-center gap-2">
                  <p className="text-xs text-destructive">
                    {t("agentLayer:adr.acceptedLoadFailed")}
                  </p>
                  <Button
                    size="xs"
                    variant="outline"
                    onClick={() => accepted.refetch()}
                  >
                    {t("agentLayer:adr.retry")}
                  </Button>
                </div>
              ) : null}
              {accepted.hasNextPage ? (
                <Button
                  size="xs"
                  variant="outline"
                  onClick={() => accepted.fetchNextPage()}
                  disabled={accepted.isFetchingNextPage}
                >
                  {t("agentLayer:adr.loadMoreAccepted")}
                </Button>
              ) : null}
            </section>
          ) : null}

          {acceptError ? (
            <div className="flex items-center gap-2" role="alert">
              <p className="text-sm text-destructive">{acceptError}</p>
              <Button size="xs" variant="outline" onClick={acceptDraft}>
                {t("agentLayer:adr.retryAccept")}
              </Button>
            </div>
          ) : null}
          <Section title={t("agentLayer:adr.context")}>{item.context}</Section>
          <Section title={t("agentLayer:adr.decision")}>
            {item.decision}
          </Section>
          {item.alternatives ? (
            <Section title={t("agentLayer:adr.alternatives")}>
              {item.alternatives}
            </Section>
          ) : null}
          {item.consequences ? (
            <Section title={t("agentLayer:adr.consequences")}>
              {item.consequences}
            </Section>
          ) : null}
          {item.sourceNote ? (
            <Section title={t("agentLayer:adr.sourceNote")}>
              {item.sourceNote}
            </Section>
          ) : null}

          {refs ? (
            <Section title={t("agentLayer:adr.references")}>
              <dl className="space-y-2">
                {refs.repo ? (
                  <div>
                    <dt className="text-xs text-muted-foreground">
                      {t("agentLayer:adr.refRepo")}
                    </dt>
                    <dd className="font-mono text-xs break-all">{refs.repo}</dd>
                  </div>
                ) : null}
                {refs.branch ? (
                  <div>
                    <dt className="text-xs text-muted-foreground">
                      {t("agentLayer:adr.refBranch")}
                    </dt>
                    <dd className="font-mono text-xs break-all">
                      {refs.branch}
                    </dd>
                  </div>
                ) : null}
                <RefList
                  label={t("agentLayer:adr.refCommits")}
                  items={refs.commits}
                />
                <RefList label={t("agentLayer:adr.refPrs")} items={refs.prs} />
                <RefList
                  label={t("agentLayer:adr.refFiles")}
                  items={refs.files}
                />
              </dl>
            </Section>
          ) : null}

          <section className="space-y-2">
            <h2 className="text-sm font-semibold">
              {t("agentLayer:adr.relatedTasks")}
            </h2>
            {item.tasks.length ? (
              <ul className="list-inside list-disc text-sm">
                {item.tasks.map((task) => (
                  <li key={task.id}>
                    {task.number != null ? `#${task.number} ` : ""}
                    {task.title}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">
                {t("agentLayer:adr.noRelatedTasks")}
              </p>
            )}
          </section>
          {item.supersedes ? (
            <p className="text-sm">
              {t("agentLayer:adr.supersedesRecord", {
                number: String(item.supersedes.number).padStart(3, "0"),
                title: item.supersedes.title,
              })}
            </p>
          ) : null}
          {item.supersededBy ? (
            <p className="text-sm">
              {t("agentLayer:adr.supersededByRecord", {
                number: String(item.supersededBy.number).padStart(3, "0"),
                title: item.supersededBy.title,
              })}
            </p>
          ) : null}
        </article>
      </div>
      <AdrEditorDialog
        open={edit}
        onOpenChange={setEdit}
        projectId={projectId}
        decision={item}
        onSaved={() => setEdit(false)}
      />
      <AdrEditorDialog
        open={replacement}
        onOpenChange={setReplacement}
        projectId={projectId}
        initial={item}
        onSaved={(created) =>
          navigate({
            to: "/dashboard/workspace/$workspaceId/project/$projectId/decisions/$decisionId",
            params: { workspaceId, projectId, decisionId: created.id },
            search: { ...search, supersedes: item.id },
          })
        }
      />
    </ProjectLayout>
  );
}
