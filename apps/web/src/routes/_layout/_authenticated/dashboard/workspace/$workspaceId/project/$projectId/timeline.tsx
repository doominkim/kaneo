import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  AgentLayerEmpty,
  AgentLayerErrorState,
  AgentLayerSkeleton,
} from "@/components/agent-layer/agent-layer-state";
import { EntryDetailSheet } from "@/components/agent-layer/entry-detail-sheet";
import { TaskTimelineTree } from "@/components/agent-layer/task-timeline-tree";
import ProjectLayout from "@/components/common/project-layout";
import PageTitle from "@/components/page-title";
import { useAgentTaskIndex } from "@/hooks/queries/agent-layer/use-agent-task-index";
import useGetProject from "@/hooks/queries/project/use-get-project";

export const Route = createFileRoute(
  "/_layout/_authenticated/dashboard/workspace/$workspaceId/project/$projectId/timeline",
)({
  component: RouteComponent,
});

function RouteComponent() {
  const { t } = useTranslation();
  const { projectId, workspaceId } = Route.useParams();
  const { data: project } = useGetProject({ id: projectId, workspaceId });
  const { tree, taskNumberById } = useAgentTaskIndex(projectId);
  const [selectedEntryId, setSelectedEntryId] = useState<string | null>(null);

  return (
    <ProjectLayout
      projectId={projectId}
      workspaceId={workspaceId}
      activeView="timeline"
    >
      <PageTitle
        title={t("agentLayer:timeline.pageTitle", { name: project?.name })}
        hideAppName
      />
      <div className="h-full min-h-0 overflow-y-auto bg-background">
        <div className="mx-auto max-w-4xl px-3 py-4 sm:px-4">
          <h1 className="mb-3 text-sm font-semibold text-foreground">
            {t("agentLayer:timeline.title")}
          </h1>
          {tree.isPending ? (
            <AgentLayerSkeleton rows={5} />
          ) : tree.isError ? (
            <AgentLayerErrorState
              error={tree.error}
              onRetry={() => tree.refetch()}
            />
          ) : tree.data.nodes.length === 0 ? (
            <AgentLayerEmpty
              title={t("agentLayer:timeline.empty")}
              description={t("agentLayer:timeline.emptyHint")}
            />
          ) : (
            <TaskTimelineTree
              nodes={tree.data.nodes}
              workspaceId={workspaceId}
              projectId={projectId}
              projectSlug={project?.slug}
              onOpenEntry={setSelectedEntryId}
            />
          )}
        </div>
      </div>

      <EntryDetailSheet
        projectId={projectId}
        workspaceId={workspaceId}
        projectSlug={project?.slug}
        entryId={selectedEntryId}
        taskNumberById={taskNumberById}
        onClose={() => setSelectedEntryId(null)}
      />
    </ProjectLayout>
  );
}
