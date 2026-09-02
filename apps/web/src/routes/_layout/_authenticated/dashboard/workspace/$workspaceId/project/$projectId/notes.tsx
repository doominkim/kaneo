import { createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { EntryTimeline } from "@/components/agent-layer/entry-timeline";
import ProjectLayout from "@/components/common/project-layout";
import PageTitle from "@/components/page-title";
import { useAgentTaskIndex } from "@/hooks/queries/agent-layer/use-agent-task-index";
import useGetProject from "@/hooks/queries/project/use-get-project";

export const Route = createFileRoute(
  "/_layout/_authenticated/dashboard/workspace/$workspaceId/project/$projectId/notes",
)({
  component: RouteComponent,
});

function RouteComponent() {
  const { t } = useTranslation();
  const { projectId, workspaceId } = Route.useParams();
  const { data: project } = useGetProject({ id: projectId, workspaceId });
  const { taskNumberById } = useAgentTaskIndex(projectId);

  return (
    <ProjectLayout
      projectId={projectId}
      workspaceId={workspaceId}
      activeView="notes"
    >
      <PageTitle
        title={t("agentLayer:notes.pageTitle", { name: project?.name })}
        hideAppName
      />
      <div className="h-full min-h-0 bg-background">
        <EntryTimeline
          projectId={projectId}
          workspaceId={workspaceId}
          projectSlug={project?.slug}
          taskNumberById={taskNumberById}
        />
      </div>
    </ProjectLayout>
  );
}
