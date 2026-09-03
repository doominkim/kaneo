import { createFileRoute } from "@tanstack/react-router";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import {
  AgentLayerErrorState,
  AgentLayerSkeleton,
} from "@/components/agent-layer/agent-layer-state";
import { HandoffCallout } from "@/components/agent-layer/handoff-callout";
import { ProjectDescription } from "@/components/agent-layer/project-description";
import { StatusStrip } from "@/components/agent-layer/status-strip";
import { flattenTree } from "@/components/agent-layer/tree-utils";
import ProjectLayout from "@/components/common/project-layout";
import PageTitle from "@/components/page-title";
import { useAgentLatestEntry } from "@/hooks/queries/agent-layer/use-agent-latest-entry";
import { useAgentLeases } from "@/hooks/queries/agent-layer/use-agent-leases";
import { useAgentTree } from "@/hooks/queries/agent-layer/use-agent-tree";
import { useMemberNames } from "@/hooks/queries/agent-layer/use-member-names";
import useGetProject from "@/hooks/queries/project/use-get-project";
import { useWorkspacePermission } from "@/hooks/use-workspace-permission";

export const Route = createFileRoute(
  "/_layout/_authenticated/dashboard/workspace/$workspaceId/project/$projectId/overview",
)({
  component: RouteComponent,
});

/** 개요: description (reserved `overview` document), latest handoff, live status. */
function RouteComponent() {
  const { t } = useTranslation();
  const { projectId, workspaceId } = Route.useParams();
  const { data: project } = useGetProject({ id: projectId, workspaceId });
  const tree = useAgentTree(projectId);
  const latest = useAgentLatestEntry(projectId);
  const leases = useAgentLeases(projectId);
  const memberNameById = useMemberNames(workspaceId);
  const { canUpdateTasks, canUpdateProjects } = useWorkspacePermission();
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
        <div className="mx-auto max-w-4xl space-y-6 px-3 py-4 sm:px-4">
          <ProjectDescription
            projectId={projectId}
            memberNameById={memberNameById}
            canEdit={canUpdateTasks()}
            canDelete={canUpdateProjects()}
          />

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
          ) : tree.isError ? (
            <AgentLayerErrorState
              error={tree.error}
              onRetry={() => tree.refetch()}
            />
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
        </div>
      </div>
    </ProjectLayout>
  );
}
