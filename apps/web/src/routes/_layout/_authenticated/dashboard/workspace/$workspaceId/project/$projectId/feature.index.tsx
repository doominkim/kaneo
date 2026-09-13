import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { Plus } from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  AgentLayerErrorState,
  AgentLayerSkeleton,
} from "@/components/agent-layer/agent-layer-state";
import { CreateFeatureDialog } from "@/components/agent-layer/create-feature-dialog";
import {
  SpecStatusBadge,
  StaleBadge,
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
import { usePutAgentRequirementSet } from "@/hooks/mutations/agent-layer/use-agent-spec";
import { useAgentFeatures } from "@/hooks/queries/agent-layer/use-agent-features";
import useGetProject from "@/hooks/queries/project/use-get-project";
import { useWorkspacePermission } from "@/hooks/use-workspace-permission";
import { formatDateTime, formatRelativeTime } from "@/lib/format";
import { toast } from "@/lib/toast";

export const Route = createFileRoute(
  "/_layout/_authenticated/dashboard/workspace/$workspaceId/project/$projectId/feature/",
)({
  component: RouteComponent,
});

/** Feature tab (REQ-FEATURE-HUB-2, 18, 19): one row per feature, everything at a glance. */
function RouteComponent() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { projectId, workspaceId } = Route.useParams();
  const { data: project } = useGetProject({ id: projectId, workspaceId });
  const features = useAgentFeatures(projectId);
  const put = usePutAgentRequirementSet();
  const { canUpdateTasks } = useWorkspacePermission();
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const existing = useMemo(
    () => new Set(features.data?.features.map((f) => f.feature) ?? []),
    [features.data],
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
            {canUpdateTasks() ? (
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
          {features.isError ? (
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
                  <TableHead className="w-28">
                    {t("agentLayer:spec.columnRequirements")}
                  </TableHead>
                  <TableHead className="w-36">
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
                        <SpecStatusBadge status={f.requirements.status} />
                      ) : (
                        <span className="text-xs text-muted-foreground">
                          {t("agentLayer:spec.noRequirements")}
                        </span>
                      )}
                    </TableCell>
                    <TableCell data-testid="feature-design">
                      {f.design ? (
                        <div className="flex flex-wrap items-center gap-1">
                          <SpecStatusBadge status={f.design.status} />
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
