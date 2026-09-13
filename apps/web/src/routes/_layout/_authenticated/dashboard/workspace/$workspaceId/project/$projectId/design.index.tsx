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
import { usePutAgentDesign } from "@/hooks/mutations/agent-layer/use-agent-spec";
import { useAgentDesigns } from "@/hooks/queries/agent-layer/use-agent-designs";
import useGetProject from "@/hooks/queries/project/use-get-project";
import { useWorkspacePermission } from "@/hooks/use-workspace-permission";
import { formatDateTime, formatRelativeTime } from "@/lib/format";
import { toast } from "@/lib/toast";

export const Route = createFileRoute(
  "/_layout/_authenticated/dashboard/workspace/$workspaceId/project/$projectId/design/",
)({
  component: RouteComponent,
});

/** 설계 tab (REQ-SPEC-TABS-12): one row per feature with its stale verdict. */
function RouteComponent() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { projectId, workspaceId } = Route.useParams();
  const { data: project } = useGetProject({ id: projectId, workspaceId });
  const designs = useAgentDesigns(projectId);
  const put = usePutAgentDesign();
  const { canUpdateTasks } = useWorkspacePermission();
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const existing = useMemo(
    () => new Set(designs.data?.designs.map((design) => design.feature) ?? []),
    [designs.data],
  );

  return (
    <ProjectLayout
      projectId={projectId}
      workspaceId={workspaceId}
      activeView="design"
    >
      <PageTitle
        title={t("agentLayer:spec.designPageTitle", { name: project?.name })}
        hideAppName
      />
      <div className="h-full min-h-0 overflow-y-auto bg-background">
        <div className="mx-auto max-w-5xl space-y-4 px-3 py-4 sm:px-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h1 className="text-sm font-semibold text-foreground">
                {t("agentLayer:spec.designTitle")}
              </h1>
              <p className="text-xs text-muted-foreground">
                {t("agentLayer:spec.designHint")}
              </p>
            </div>
            {canUpdateTasks() ? (
              <Button
                size="sm"
                variant="outline"
                onClick={() => setIsCreateOpen(true)}
                data-testid="new-design"
              >
                <Plus />
                {t("agentLayer:spec.newDesign")}
              </Button>
            ) : null}
          </div>
          {designs.isError ? (
            <AgentLayerErrorState
              error={designs.error}
              onRetry={() => designs.refetch()}
            />
          ) : !designs.data ? (
            <AgentLayerSkeleton rows={4} />
          ) : designs.data.designs.length === 0 ? (
            <p
              className="text-xs text-muted-foreground"
              data-testid="empty-designs"
            >
              {t("agentLayer:spec.emptyDesigns")}
            </p>
          ) : (
            <Table data-testid="designs">
              <TableHeader>
                <TableRow>
                  <TableHead>{t("agentLayer:spec.columnFeature")}</TableHead>
                  <TableHead>{t("agentLayer:spec.columnTitle")}</TableHead>
                  <TableHead className="w-40">
                    {t("agentLayer:spec.columnStatus")}
                  </TableHead>
                  <TableHead className="w-28 text-right">
                    {t("agentLayer:spec.columnRequirements")}
                  </TableHead>
                  <TableHead className="w-32">
                    {t("agentLayer:spec.columnUpdated")}
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {designs.data.designs.map((design) => (
                  <TableRow key={design.id} data-testid="design-row">
                    <TableCell className="font-mono text-xs">
                      <Link
                        to="/dashboard/workspace/$workspaceId/project/$projectId/design/$feature"
                        params={{
                          workspaceId,
                          projectId,
                          feature: design.feature,
                        }}
                        className="underline-offset-2 hover:underline"
                      >
                        {design.feature}
                      </Link>
                    </TableCell>
                    <TableCell className="text-xs">{design.title}</TableCell>
                    <TableCell>
                      <div className="flex flex-wrap items-center gap-1">
                        <SpecStatusBadge status={design.status} />
                        <StaleBadge stale={design.stale} />
                      </div>
                    </TableCell>
                    <TableCell className="text-right text-xs">
                      {design.requirementCount}
                    </TableCell>
                    <TableCell
                      className="text-xs text-muted-foreground"
                      title={formatDateTime(design.updatedAt)}
                    >
                      {formatRelativeTime(design.updatedAt)}
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
        dialogTitle={t("agentLayer:spec.newDesign")}
        isPending={put.isPending}
        onCreate={async ({ feature, title }) => {
          try {
            await put.mutateAsync({
              projectId,
              feature,
              body: { title, body: `# ${title}\n`, requirementKeys: [] },
            });
            setIsCreateOpen(false);
            navigate({
              to: "/dashboard/workspace/$workspaceId/project/$projectId/design/$feature",
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
