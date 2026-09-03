import { createFileRoute } from "@tanstack/react-router";
import { PenLine } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  AgentLayerEmpty,
  AgentLayerErrorState,
  AgentLayerSkeleton,
} from "@/components/agent-layer/agent-layer-state";
import { EntryComposer } from "@/components/agent-layer/entry-composer";
import { EntryDetailSheet } from "@/components/agent-layer/entry-detail-sheet";
import { ProjectEntries } from "@/components/agent-layer/project-entries";
import { TaskTimelineTree } from "@/components/agent-layer/task-timeline-tree";
import ProjectLayout from "@/components/common/project-layout";
import PageTitle from "@/components/page-title";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { useAgentTaskIndex } from "@/hooks/queries/agent-layer/use-agent-task-index";
import useGetProject from "@/hooks/queries/project/use-get-project";
import { useWorkspacePermission } from "@/hooks/use-workspace-permission";

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
  const { canUpdateTasks, canUpdateProjects } = useWorkspacePermission();
  const canWrite = canUpdateTasks();
  // project:update is what the API demands for `includeDeleted`; the toggle
  // is hidden (and forced off) for everyone else so the listing never 403s.
  const canSeeDeleted = canUpdateProjects();
  const [selectedEntryId, setSelectedEntryId] = useState<string | null>(null);
  const [composing, setComposing] = useState(false);
  const [showDeletedRequested, setShowDeletedRequested] = useState(false);
  const showDeleted = canSeeDeleted && showDeletedRequested;

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
          <div className="mb-3 flex items-center justify-between gap-2">
            <h1 className="text-sm font-semibold text-foreground">
              {t("agentLayer:timeline.title")}
            </h1>
            <div className="flex items-center gap-3">
              {canSeeDeleted ? (
                <label
                  htmlFor="show-deleted-toggle"
                  className="flex cursor-pointer items-center gap-2 text-xs text-muted-foreground"
                >
                  <Switch
                    id="show-deleted-toggle"
                    checked={showDeleted}
                    onCheckedChange={(checked) =>
                      setShowDeletedRequested(checked)
                    }
                    data-testid="show-deleted-toggle"
                  />
                  {t("agentLayer:timeline.showDeleted")}
                </label>
              ) : null}
              {canWrite && !composing ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  data-testid="compose-project-entry"
                  onClick={() => setComposing(true)}
                >
                  <PenLine />
                  {t("agentLayer:composer.open")}
                </Button>
              ) : null}
            </div>
          </div>
          {canWrite && composing ? (
            <div className="mb-4 space-y-1.5">
              <EntryComposer
                projectId={projectId}
                onClose={() => setComposing(false)}
              />
              <p className="px-1 text-xs text-muted-foreground">
                {t("agentLayer:composer.projectHint")}
              </p>
            </div>
          ) : null}
          <ProjectEntries
            projectId={projectId}
            projectSlug={project?.slug}
            showDeleted={showDeleted}
            onOpenEntry={setSelectedEntryId}
          />
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
              canWrite={canWrite}
              showDeleted={showDeleted}
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
        includeDeleted={showDeleted}
        onClose={() => setSelectedEntryId(null)}
      />
    </ProjectLayout>
  );
}
