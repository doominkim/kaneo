import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { ArrowLeft, Plus, Trash2, Undo2 } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { z } from "zod";
import { AdrEditorDialog } from "@/components/agent-layer/adr-editor-dialog";
import { AgentAuthorBadge } from "@/components/agent-layer/agent-author-badge";
import {
  DeletedStamp,
  UnreviewedBadge,
} from "@/components/agent-layer/spec-badges";
import ProjectLayout from "@/components/common/project-layout";
import PageTitle from "@/components/page-title";
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type {
  AgentDecisionDeleteResult,
  AgentDecisionDetail,
} from "@/fetchers/agent-layer/agent-decisions";
import { isAgentLayerStatus } from "@/fetchers/agent-layer/api-error";
import {
  useDeleteAgentDecision,
  useRestoreAgentDecision,
  useReviewAgentDecision,
} from "@/hooks/mutations/agent-layer/use-agent-decisions";
import { useAgentDecision } from "@/hooks/queries/agent-layer/use-agent-decisions";
import { useMemberNames } from "@/hooks/queries/agent-layer/use-member-names";
import { useReviewOnOpen } from "@/hooks/use-review-on-open";
import { useWorkspacePermission } from "@/hooks/use-workspace-permission";
import { toast } from "@/lib/toast";

const decisionStatus = z.enum([
  "current",
  "all",
  "accepted",
  "superseded",
  "deleted",
]);

export const Route = createFileRoute(
  "/_layout/_authenticated/dashboard/workspace/$workspaceId/project/$projectId/decisions/$decisionId",
)({
  validateSearch: z.object({
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

const padNumber = (value: number) => String(value).padStart(3, "0");

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

type DeletedHere = {
  item: AgentDecisionDetail;
  result: AgentDecisionDeleteResult;
};

function RouteComponent() {
  const { t } = useTranslation();
  const { workspaceId, projectId, decisionId } = Route.useParams();
  const search = Route.useSearch();
  const navigate = useNavigate();
  const decision = useAgentDecision(projectId, decisionId);
  const memberNames = useMemberNames(workspaceId);
  const { canUpdateTasks, canUpdateProjects } = useWorkspacePermission();
  const review = useReviewAgentDecision();
  const remove = useDeleteAgentDecision();
  const restore = useRestoreAgentDecision();
  const [replacement, setReplacement] = useState(false);
  const [isDeleteOpen, setIsDeleteOpen] = useState(false);
  // The detail route does not find a deleted ADR, so the one deleted on this
  // page is kept here: it stays readable and offers its own restore.
  const [deleted, setDeleted] = useState<DeletedHere | null>(null);
  const deletedHere = deleted?.item.id === decisionId ? deleted : null;
  const item = deletedHere?.item ?? decision.data;

  const showUnreviewed = useReviewOnOpen({
    itemId: item?.id,
    reviewed: item?.reviewed,
    enabled: !deletedHere,
    onReview: () => review.mutateAsync({ projectId, decisionId }),
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

  const openRecord = (id: string) =>
    navigate({
      to: "/dashboard/workspace/$workspaceId/project/$projectId/decisions/$decisionId",
      params: { workspaceId, projectId, decisionId: id },
      search,
    });

  const handleDelete = async () => {
    if (!item) return;
    try {
      const result = await remove.mutateAsync({
        projectId,
        decisionId: item.id,
      });
      setDeleted({ item, result });
      setIsDeleteOpen(false);
      toast.success(
        t("agentLayer:adr.deleted", { number: padNumber(item.number) }),
      );
    } catch (cause) {
      toast.error(t("agentLayer:adr.deleteFailed"), {
        description: cause instanceof Error ? cause.message : undefined,
      });
    }
  };

  const handleRestore = async () => {
    if (!item) return;
    try {
      await restore.mutateAsync({ projectId, decisionId: item.id });
      setDeleted(null);
      toast.success(
        t("agentLayer:adr.restored", { number: padNumber(item.number) }),
      );
    } catch (cause) {
      toast.error(
        isAgentLayerStatus(cause, 409)
          ? t("agentLayer:adr.restoreConflict")
          : t("agentLayer:common.restoreFailed"),
        { description: cause instanceof Error ? cause.message : undefined },
      );
    }
  };

  if (!item && decision.isPending) {
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
          {isAgentLayerStatus(decision.error, 404) ? (
            <p className="text-sm text-muted-foreground">
              {t("agentLayer:adr.notFound")}
            </p>
          ) : decision.isError ? (
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

  const isDeleted = Boolean(deletedHere);
  const statusLabel =
    item.status === "accepted"
      ? t("agentLayer:adr.statusAccepted")
      : t("agentLayer:adr.statusSuperseded");
  // Deleting an accepted ADR returns the one it superseded to `accepted`.
  const returnsPrevious =
    item.status === "accepted" && item.supersedes?.status === "superseded"
      ? item.supersedes
      : null;
  const restoredPrevious =
    deletedHere?.result.restoredDecisionId &&
    item.supersedes?.id === deletedHere.result.restoredDecisionId
      ? item.supersedes
      : null;
  const reviewerName = item.reviewedBy
    ? memberNames.get(item.reviewedBy)
    : undefined;
  const refs = item.refs;

  return (
    <ProjectLayout
      projectId={projectId}
      workspaceId={workspaceId}
      activeView="knowledge"
    >
      <PageTitle
        title={`ADR-${padNumber(item.number)} · ${item.title}`}
        hideAppName
      />
      <div className="h-full overflow-y-auto">
        <article className="mx-auto max-w-3xl space-y-7 px-4 py-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <Button variant="ghost" size="sm" onClick={back}>
              <ArrowLeft /> {t("agentLayer:adr.back")}
            </Button>
            <div className="flex gap-2">
              {!isDeleted && item.status === "accepted" && canUpdateTasks() ? (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setReplacement(true)}
                  data-testid="supersede-adr"
                >
                  <Plus /> {t("agentLayer:adr.supersede")}
                </Button>
              ) : null}
              {!isDeleted && canUpdateProjects() ? (
                <Button
                  size="sm"
                  variant="destructive-outline"
                  onClick={() => setIsDeleteOpen(true)}
                  data-testid="delete-adr"
                >
                  <Trash2 /> {t("agentLayer:adr.delete")}
                </Button>
              ) : null}
            </div>
          </div>

          {deletedHere ? (
            <div
              role="status"
              className="space-y-1 rounded-md border border-destructive/40 bg-destructive/8 px-3 py-2 text-sm"
              data-testid="adr-deleted-banner"
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">
                  {t("agentLayer:adr.deletedBanner")}
                </span>
                <DeletedStamp
                  deletedAt={deletedHere.result.deletedAt}
                  deletedByName={memberNames.get(deletedHere.result.deletedBy)}
                />
                {canUpdateProjects() ? (
                  <Button
                    size="xs"
                    variant="outline"
                    className="ml-auto"
                    onClick={handleRestore}
                    disabled={restore.isPending}
                    data-testid="restore-adr"
                  >
                    <Undo2 />
                    {restore.isPending
                      ? t("agentLayer:common.restoring")
                      : t("agentLayer:common.restore")}
                  </Button>
                ) : null}
              </div>
              {restoredPrevious ? (
                <p className="text-xs text-muted-foreground">
                  {t("agentLayer:adr.restoredPrevious", {
                    number: padNumber(restoredPrevious.number),
                  })}
                </p>
              ) : null}
            </div>
          ) : null}

          {!isDeleted && item.supersededBy ? (
            <div
              role="status"
              className="flex flex-wrap items-center gap-2 rounded-md border bg-muted/40 px-3 py-2 text-sm"
              data-testid="adr-superseded-banner"
            >
              <span>
                {t("agentLayer:adr.supersededByRecord", {
                  number: padNumber(item.supersededBy.number),
                  title: item.supersededBy.title,
                })}
              </span>
              <Button
                size="xs"
                variant="outline"
                className="ml-auto"
                onClick={() =>
                  item.supersededBy && openRecord(item.supersededBy.id)
                }
              >
                {t("agentLayer:adr.openRecord")}
              </Button>
            </div>
          ) : null}

          <header className="space-y-2 border-b pb-5">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-sm text-muted-foreground">
                ADR-{padNumber(item.number)}
              </span>
              <Badge
                variant={item.status === "accepted" ? "success" : "secondary"}
                data-testid="adr-status"
              >
                {statusLabel}
              </Badge>
              {isDeleted ? (
                <Badge variant="error" data-testid="adr-deleted">
                  {t("agentLayer:adr.statusDeleted")}
                </Badge>
              ) : null}
              {showUnreviewed && !isDeleted ? <UnreviewedBadge /> : null}
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
              {item.reviewedAt ? (
                <>
                  <span>· {t("agentLayer:adr.reviewedBy")}</span>
                  <span data-testid="adr-reviewer">
                    {reviewerName ?? t("agentLayer:common.unknownAuthor")}
                  </span>
                  <span>· {new Date(item.reviewedAt).toLocaleString()}</span>
                </>
              ) : null}
            </div>
          </header>

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
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span>
                {t("agentLayer:adr.supersedesRecord", {
                  number: padNumber(item.supersedes.number),
                  title: item.supersedes.title,
                })}
              </span>
              <Button
                size="xs"
                variant="ghost"
                onClick={() =>
                  item.supersedes && openRecord(item.supersedes.id)
                }
              >
                {t("agentLayer:adr.openRecord")}
              </Button>
            </div>
          ) : null}
        </article>
      </div>
      <AdrEditorDialog
        open={replacement}
        onOpenChange={setReplacement}
        projectId={projectId}
        supersedes={item}
        onSaved={(created) => openRecord(created.id)}
      />
      <AlertDialog
        open={isDeleteOpen}
        onOpenChange={(open) =>
          !open && !remove.isPending && setIsDeleteOpen(false)
        }
      >
        <AlertDialogContent data-testid="delete-adr-dialog">
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("agentLayer:adr.deleteTitle", {
                number: padNumber(item.number),
              })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("agentLayer:adr.deleteDescription")}
              {returnsPrevious
                ? ` ${t("agentLayer:adr.deleteRestoresPrevious", {
                    number: padNumber(returnsPrevious.number),
                  })}`
                : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogClose
              render={
                <Button
                  variant="outline"
                  size="sm"
                  disabled={remove.isPending}
                />
              }
            >
              {t("agentLayer:adr.cancel")}
            </AlertDialogClose>
            <Button
              size="sm"
              variant="destructive"
              disabled={remove.isPending}
              onClick={handleDelete}
              data-testid="delete-adr-submit"
            >
              {remove.isPending
                ? t("agentLayer:adr.deleting")
                : t("agentLayer:adr.delete")}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </ProjectLayout>
  );
}
