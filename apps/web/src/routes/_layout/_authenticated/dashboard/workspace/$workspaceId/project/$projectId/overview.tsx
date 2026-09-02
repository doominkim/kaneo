import { createFileRoute } from "@tanstack/react-router";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import {
  AgentLayerEmpty,
  AgentLayerErrorState,
  AgentLayerSkeleton,
} from "@/components/agent-layer/agent-layer-state";
import { HandoffCallout } from "@/components/agent-layer/handoff-callout";
import { StatusStrip } from "@/components/agent-layer/status-strip";
import { TaskTimelineTree } from "@/components/agent-layer/task-timeline-tree";
import { flattenTree } from "@/components/agent-layer/tree-utils";
import ProjectLayout from "@/components/common/project-layout";
import PageTitle from "@/components/page-title";
import { useAgentLatestEntry } from "@/hooks/queries/agent-layer/use-agent-latest-entry";
import { useAgentLeases } from "@/hooks/queries/agent-layer/use-agent-leases";
import { useAgentTree } from "@/hooks/queries/agent-layer/use-agent-tree";
import useGetProject from "@/hooks/queries/project/use-get-project";

export const Route = createFileRoute(
  "/_layout/_authenticated/dashboard/workspace/$workspaceId/project/$projectId/overview",
)({
  component: RouteComponent,
});

function RouteComponent() {
  const { t } = useTranslation();
  const { projectId, workspaceId } = Route.useParams();
  const { data: project } = useGetProject({ id: projectId, workspaceId });
  const tree = useAgentTree(projectId);
  const latest = useAgentLatestEntry(projectId);
  const leases = useAgentLeases(projectId);
  const flattened = useMemo(() => flattenTree(tree.data?.nodes), [tree.data]);

  return (
    <ProjectLayout
      projectId={projectId}
      workspaceId={workspaceId}
      activeView="overview"
    >
      <PageTitle
        title={t("agentLayer:overview.pageTitle", { name: project?.name })}
        hideAppName
      />
      <div className="h-full min-h-0 overflow-y-auto bg-background">
        {tree.isError ? (
          <AgentLayerErrorState
            error={tree.error}
            onRetry={() => tree.refetch()}
          />
        ) : (
          <div className="mx-auto max-w-6xl space-y-6 px-3 py-4 sm:px-4">
            <section>
              {latest.isPending ? (
                <AgentLayerSkeleton rows={3} />
              ) : latest.isError ? (
                <AgentLayerErrorState
                  error={latest.error}
                  onRetry={() => latest.refetch()}
                />
              ) : (
                <HandoffCallout latest={latest.data} />
              )}
            </section>

            {tree.isPending ? (
              <AgentLayerSkeleton rows={2} />
            ) : (
              <StatusStrip
                workspaceId={workspaceId}
                projectId={projectId}
                projectSlug={project?.slug}
                openCount={flattened.openCount}
                doneCount={flattened.doneCount}
                leases={leases.data?.leases ?? []}
                tasksById={flattened.byId}
              />
            )}

            <section className="space-y-2">
              <h2 className="text-sm font-semibold text-foreground">
                {t("agentLayer:overview.treeTitle")}
              </h2>
              {tree.isPending ? (
                <AgentLayerSkeleton rows={4} />
              ) : tree.data.nodes.length === 0 ? (
                <AgentLayerEmpty
                  title={t("agentLayer:overview.treeEmpty")}
                  description={t("agentLayer:overview.treeEmptyHint")}
                />
              ) : (
                <TaskTimelineTree
                  nodes={tree.data.nodes}
                  workspaceId={workspaceId}
                  projectId={projectId}
                  projectSlug={project?.slug}
                />
              )}
            </section>
          </div>
        )}
      </div>
    </ProjectLayout>
  );
}
