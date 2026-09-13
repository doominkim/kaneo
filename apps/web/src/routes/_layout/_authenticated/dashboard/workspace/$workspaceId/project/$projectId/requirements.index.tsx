import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { Plus } from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  AgentLayerErrorState,
  AgentLayerSkeleton,
} from "@/components/agent-layer/agent-layer-state";
import { CreateFeatureDialog } from "@/components/agent-layer/create-feature-dialog";
import { SpecStatusBadge } from "@/components/agent-layer/spec-badges";
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
import { useAgentRequirementSets } from "@/hooks/queries/agent-layer/use-agent-requirements";
import useGetProject from "@/hooks/queries/project/use-get-project";
import { useWorkspacePermission } from "@/hooks/use-workspace-permission";
import { formatDateTime, formatRelativeTime } from "@/lib/format";
import { toast } from "@/lib/toast";

export const Route = createFileRoute(
  "/_layout/_authenticated/dashboard/workspace/$workspaceId/project/$projectId/requirements/",
)({
  component: RouteComponent,
});

/** 요구사항 tab (REQ-SPEC-TABS-11): one row per feature. */
function RouteComponent() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { projectId, workspaceId } = Route.useParams();
  const { data: project } = useGetProject({ id: projectId, workspaceId });
  const sets = useAgentRequirementSets(projectId);
  const put = usePutAgentRequirementSet();
  const { canUpdateTasks } = useWorkspacePermission();
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const existing = useMemo(
    () => new Set(sets.data?.sets.map((set) => set.feature) ?? []),
    [sets.data],
  );

  return (
    <ProjectLayout
      projectId={projectId}
      workspaceId={workspaceId}
      activeView="requirements"
    >
      <PageTitle
        title={t("agentLayer:spec.requirementsPageTitle", {
          name: project?.name,
        })}
        hideAppName
      />
      <div className="h-full min-h-0 overflow-y-auto bg-background">
        <div className="mx-auto max-w-5xl space-y-4 px-3 py-4 sm:px-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h1 className="text-sm font-semibold text-foreground">
                {t("agentLayer:spec.requirementsTitle")}
              </h1>
              <p className="text-xs text-muted-foreground">
                {t("agentLayer:spec.requirementsHint")}
              </p>
            </div>
            {canUpdateTasks() ? (
              <Button
                size="sm"
                variant="outline"
                onClick={() => setIsCreateOpen(true)}
                data-testid="new-set"
              >
                <Plus />
                {t("agentLayer:spec.newSet")}
              </Button>
            ) : null}
          </div>
          {sets.isError ? (
            <AgentLayerErrorState
              error={sets.error}
              onRetry={() => sets.refetch()}
            />
          ) : !sets.data ? (
            <AgentLayerSkeleton rows={4} />
          ) : sets.data.sets.length === 0 ? (
            <p
              className="text-xs text-muted-foreground"
              data-testid="empty-sets"
            >
              {t("agentLayer:spec.emptySets")}
            </p>
          ) : (
            <Table data-testid="requirement-sets">
              <TableHeader>
                <TableRow>
                  <TableHead>{t("agentLayer:spec.columnFeature")}</TableHead>
                  <TableHead>{t("agentLayer:spec.columnTitle")}</TableHead>
                  <TableHead className="w-28">
                    {t("agentLayer:spec.columnStatus")}
                  </TableHead>
                  <TableHead className="w-24 text-right">
                    {t("agentLayer:spec.columnItems")}
                  </TableHead>
                  <TableHead className="w-32">
                    {t("agentLayer:spec.columnUpdated")}
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sets.data.sets.map((set) => (
                  <TableRow key={set.id} data-testid="set-row">
                    <TableCell className="font-mono text-xs">
                      <Link
                        to="/dashboard/workspace/$workspaceId/project/$projectId/requirements/$feature"
                        params={{
                          workspaceId,
                          projectId,
                          feature: set.feature,
                        }}
                        className="underline-offset-2 hover:underline"
                      >
                        {set.feature}
                      </Link>
                    </TableCell>
                    <TableCell className="text-xs">{set.title}</TableCell>
                    <TableCell>
                      <SpecStatusBadge status={set.status} />
                    </TableCell>
                    <TableCell
                      className="text-right text-xs"
                      data-testid="set-counts"
                    >
                      {set.activeCount}/{set.itemCount}
                    </TableCell>
                    <TableCell
                      className="text-xs text-muted-foreground"
                      title={formatDateTime(set.updatedAt)}
                    >
                      {formatRelativeTime(set.updatedAt)}
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
        dialogTitle={t("agentLayer:spec.newSet")}
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
              to: "/dashboard/workspace/$workspaceId/project/$projectId/requirements/$feature",
              params: { workspaceId, projectId, feature },
              search: { edit: true },
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
