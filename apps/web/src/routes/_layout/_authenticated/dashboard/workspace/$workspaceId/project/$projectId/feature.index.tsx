import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { Plus, Undo2 } from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  AgentLayerErrorState,
  AgentLayerSkeleton,
} from "@/components/agent-layer/agent-layer-state";
import { CreateFeatureDialog } from "@/components/agent-layer/create-feature-dialog";
import {
  DeletedStamp,
  StaleBadge,
  UnreviewedBadge,
} from "@/components/agent-layer/spec-badges";
import ProjectLayout from "@/components/common/project-layout";
import PageTitle from "@/components/page-title";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { AgentFeatureSummary } from "@/fetchers/agent-layer/agent-features";
import type { SpecKind } from "@/fetchers/agent-layer/agent-spec-lifecycle";
import {
  usePutAgentRequirementSet,
  useRestoreAgentSpec,
} from "@/hooks/mutations/agent-layer/use-agent-spec";
import { useAgentFeatures } from "@/hooks/queries/agent-layer/use-agent-features";
import { useMemberNames } from "@/hooks/queries/agent-layer/use-member-names";
import useGetProject from "@/hooks/queries/project/use-get-project";
import { useWorkspacePermission } from "@/hooks/use-workspace-permission";
import { cn } from "@/lib/cn";
import { formatDateTime, formatRelativeTime } from "@/lib/format";
import { toast } from "@/lib/toast";

export const Route = createFileRoute(
  "/_layout/_authenticated/dashboard/workspace/$workspaceId/project/$projectId/feature/",
)({
  component: RouteComponent,
});

type DeletedDoc = {
  key: string;
  feature: string;
  title: string;
  kind: SpecKind;
  deletedAt: string;
  deletedBy: string | null;
};

/** One row per deleted document: a feature can lose its requirements and keep its design. */
function deletedDocsOf(
  features: AgentFeatureSummary[] | undefined,
): DeletedDoc[] {
  const docs: DeletedDoc[] = [];
  for (const feature of features ?? []) {
    const entries = [
      ["requirement", feature.requirements],
      ["design", feature.design],
    ] as const;
    for (const [kind, doc] of entries) {
      if (!doc?.deletedAt) continue;
      docs.push({
        key: `${feature.feature}:${kind}`,
        feature: feature.feature,
        title: feature.title,
        kind,
        deletedAt: doc.deletedAt,
        deletedBy: doc.deletedBy,
      });
    }
  }
  return docs;
}

/** Feature tab (REQ-FEATURE-HUB-2, 18, 19): one row per feature, everything at a glance. */
function RouteComponent() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { projectId, workspaceId } = Route.useParams();
  const { data: project } = useGetProject({ id: projectId, workspaceId });
  const [showDeleted, setShowDeleted] = useState(false);
  const features = useAgentFeatures(projectId);
  const deleted = useAgentFeatures(projectId, {
    deleted: true,
    enabled: showDeleted,
  });
  const memberNames = useMemberNames(workspaceId);
  const put = usePutAgentRequirementSet();
  const restore = useRestoreAgentSpec();
  const { canUpdateTasks, canUpdateProjects } = useWorkspacePermission();
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const existing = useMemo(
    () => new Set(features.data?.features.map((f) => f.feature) ?? []),
    [features.data],
  );
  const deletedDocs = useMemo(
    () => deletedDocsOf(deleted.data?.features),
    [deleted.data],
  );
  const docLabel = (kind: SpecKind) =>
    kind === "requirement"
      ? t("agentLayer:spec.docRequirements")
      : t("agentLayer:spec.docDesign");

  const handleRestore = async (doc: DeletedDoc) => {
    try {
      await restore.mutateAsync({
        kind: doc.kind,
        projectId,
        feature: doc.feature,
      });
      toast.success(t("agentLayer:spec.restored", { doc: docLabel(doc.kind) }));
    } catch (cause) {
      toast.error(t("agentLayer:common.restoreFailed"), {
        description: cause instanceof Error ? cause.message : undefined,
      });
    }
  };

  const filterButton = (value: boolean, label: string, testId: string) => (
    <Button
      variant={showDeleted === value ? "secondary" : "ghost"}
      size="xs"
      aria-pressed={showDeleted === value}
      onClick={() => setShowDeleted(value)}
      className={cn(
        "h-6 rounded-md px-2 text-xs",
        showDeleted !== value && "text-muted-foreground",
      )}
      data-testid={testId}
    >
      {label}
    </Button>
  );

  return (
    <ProjectLayout
      projectId={projectId}
      workspaceId={workspaceId}
      activeView="feature"
    >
      <PageTitle
        title={t("agentLayer:spec.featurePageTitle", { name: project?.name })}
        hideAppName
      />
      <div className="h-full min-h-0 overflow-y-auto bg-background">
        <div className="mx-auto max-w-5xl space-y-4 px-3 py-4 sm:px-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h1 className="text-sm font-semibold text-foreground">
                {t("agentLayer:spec.featureTitle")}
              </h1>
              <p className="text-xs text-muted-foreground">
                {t("agentLayer:spec.featureHint")}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <fieldset className="inline-flex h-8 items-center gap-0.5 rounded-lg border border-border/80 bg-background p-0.5">
                <legend className="sr-only">
                  {t("agentLayer:common.deletedFilter")}
                </legend>
                {filterButton(
                  false,
                  t("agentLayer:common.filterLive"),
                  "show-live-features",
                )}
                {filterButton(
                  true,
                  t("agentLayer:common.filterDeleted"),
                  "show-deleted-features",
                )}
              </fieldset>
              {canUpdateTasks() && !showDeleted ? (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setIsCreateOpen(true)}
                  data-testid="new-feature"
                >
                  <Plus />
                  {t("agentLayer:spec.newFeature")}
                </Button>
              ) : null}
            </div>
          </div>
          {showDeleted ? (
            deleted.isError ? (
              <AgentLayerErrorState
                error={deleted.error}
                onRetry={() => deleted.refetch()}
              />
            ) : !deleted.data ? (
              <AgentLayerSkeleton rows={4} />
            ) : deletedDocs.length === 0 ? (
              <p
                className="text-xs text-muted-foreground"
                data-testid="empty-deleted-features"
              >
                {t("agentLayer:spec.emptyDeleted")}
              </p>
            ) : (
              <Table data-testid="deleted-features">
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("agentLayer:spec.columnFeature")}</TableHead>
                    <TableHead>{t("agentLayer:spec.columnTitle")}</TableHead>
                    <TableHead className="w-36">
                      {t("agentLayer:spec.columnDocument")}
                    </TableHead>
                    <TableHead>{t("agentLayer:spec.columnDeleted")}</TableHead>
                    <TableHead className="w-24">
                      <span className="sr-only">
                        {t("agentLayer:common.restore")}
                      </span>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {deletedDocs.map((doc) => (
                    <TableRow
                      key={doc.key}
                      data-testid="deleted-doc-row"
                      data-kind={doc.kind}
                    >
                      <TableCell className="font-mono text-xs">
                        {doc.feature}
                      </TableCell>
                      <TableCell className="text-xs">{doc.title}</TableCell>
                      <TableCell className="text-xs">
                        {docLabel(doc.kind)}
                      </TableCell>
                      <TableCell>
                        <DeletedStamp
                          deletedAt={doc.deletedAt}
                          deletedByName={
                            doc.deletedBy
                              ? memberNames.get(doc.deletedBy)
                              : null
                          }
                        />
                      </TableCell>
                      <TableCell className="text-right">
                        {canUpdateProjects() ? (
                          <Button
                            size="xs"
                            variant="outline"
                            disabled={
                              restore.isPending &&
                              restore.variables?.feature === doc.feature &&
                              restore.variables?.kind === doc.kind
                            }
                            onClick={() => handleRestore(doc)}
                            data-testid="restore-doc"
                          >
                            <Undo2 />
                            {t("agentLayer:common.restore")}
                          </Button>
                        ) : null}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )
          ) : features.isError ? (
            <AgentLayerErrorState
              error={features.error}
              onRetry={() => features.refetch()}
            />
          ) : !features.data ? (
            <AgentLayerSkeleton rows={4} />
          ) : features.data.features.length === 0 ? (
            <p
              className="text-xs text-muted-foreground"
              data-testid="empty-features"
            >
              {t("agentLayer:spec.emptyFeatures")}
            </p>
          ) : (
            <Table data-testid="features">
              <TableHeader>
                <TableRow>
                  <TableHead>{t("agentLayer:spec.columnFeature")}</TableHead>
                  <TableHead>{t("agentLayer:spec.columnTitle")}</TableHead>
                  <TableHead className="w-40">
                    {t("agentLayer:spec.columnRequirements")}
                  </TableHead>
                  <TableHead className="w-44">
                    {t("agentLayer:spec.columnDesign")}
                  </TableHead>
                  <TableHead className="w-28">
                    {t("agentLayer:spec.columnTaskProgress")}
                  </TableHead>
                  <TableHead className="w-20 text-right">
                    {t("agentLayer:spec.columnCoverageRatio")}
                  </TableHead>
                  <TableHead className="w-28">
                    {t("agentLayer:spec.columnUpdated")}
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {features.data.features.map((f) => (
                  <TableRow key={f.feature} data-testid="feature-row">
                    <TableCell className="font-mono text-xs">
                      <Link
                        to="/dashboard/workspace/$workspaceId/project/$projectId/feature/$feature"
                        params={{ workspaceId, projectId, feature: f.feature }}
                        search={{ tab: "requirements" }}
                        className="underline-offset-2 hover:underline"
                      >
                        {f.feature}
                      </Link>
                    </TableCell>
                    <TableCell className="text-xs">{f.title}</TableCell>
                    <TableCell data-testid="feature-requirements">
                      {f.requirements ? (
                        <div className="flex flex-wrap items-center gap-1">
                          <span
                            className="text-xs text-muted-foreground"
                            title={formatDateTime(f.requirements.revisedAt)}
                          >
                            {t("agentLayer:spec.revisedAt", {
                              when: formatRelativeTime(
                                f.requirements.revisedAt,
                              ),
                            })}
                          </span>
                          {f.requirements.reviewed ? null : <UnreviewedBadge />}
                        </div>
                      ) : (
                        <span className="text-xs text-muted-foreground">
                          {t("agentLayer:spec.noRequirements")}
                        </span>
                      )}
                    </TableCell>
                    <TableCell data-testid="feature-design">
                      {f.design ? (
                        <div className="flex flex-wrap items-center gap-1">
                          <span
                            className="text-xs text-muted-foreground"
                            title={formatDateTime(f.design.revisedAt)}
                          >
                            {t("agentLayer:spec.revisedAt", {
                              when: formatRelativeTime(f.design.revisedAt),
                            })}
                          </span>
                          {f.design.reviewed ? null : <UnreviewedBadge />}
                          <StaleBadge stale={f.design.stale} />
                        </div>
                      ) : (
                        <span className="text-xs text-muted-foreground">
                          {t("agentLayer:spec.noDesign")}
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-xs" data-testid="feature-tasks">
                      {f.tasks.done}/{f.tasks.total}
                      {f.tasks.stale > 0 ? (
                        <span className="ml-1 text-warning-foreground">
                          (
                          {t("agentLayer:spec.staleCount", {
                            count: f.tasks.stale,
                          })}
                          )
                        </span>
                      ) : null}
                    </TableCell>
                    <TableCell
                      className="text-right text-xs"
                      data-testid="feature-coverage"
                    >
                      {f.requirements
                        ? `${f.requirements.coveredCount}/${f.requirements.activeCount}`
                        : "–"}
                    </TableCell>
                    <TableCell
                      className="text-xs text-muted-foreground"
                      title={formatDateTime(f.updatedAt)}
                    >
                      {formatRelativeTime(f.updatedAt)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>
      </div>
      <CreateFeatureDialog
        open={isCreateOpen}
        onOpenChange={setIsCreateOpen}
        existingFeatures={existing}
        dialogTitle={t("agentLayer:spec.newFeature")}
        isPending={put.isPending}
        onCreate={async ({ feature, title }) => {
          try {
            await put.mutateAsync({
              projectId,
              feature,
              body: { title, body: "", items: [] },
            });
            setIsCreateOpen(false);
            navigate({
              to: "/dashboard/workspace/$workspaceId/project/$projectId/feature/$feature",
              params: { workspaceId, projectId, feature },
              search: { tab: "requirements", edit: true },
            });
          } catch (cause) {
            toast.error(t("agentLayer:spec.saveFailed"), {
              description: cause instanceof Error ? cause.message : undefined,
            });
          }
        }}
      />
    </ProjectLayout>
  );
}
