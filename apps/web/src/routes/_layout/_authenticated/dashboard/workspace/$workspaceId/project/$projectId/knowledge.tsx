import { createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { AgentLayerEmpty } from "@/components/agent-layer/agent-layer-state";
import ProjectLayout from "@/components/common/project-layout";
import PageTitle from "@/components/page-title";
import useGetProject from "@/hooks/queries/project/use-get-project";

export const Route = createFileRoute(
  "/_layout/_authenticated/dashboard/workspace/$workspaceId/project/$projectId/knowledge",
)({
  component: RouteComponent,
});

// Phase 1b fills this in (glossary + decisions, DESIGN.md §8).
function RouteComponent() {
  const { t } = useTranslation();
  const { projectId, workspaceId } = Route.useParams();
  const { data: project } = useGetProject({ id: projectId, workspaceId });

  return (
    <ProjectLayout
      projectId={projectId}
      workspaceId={workspaceId}
      activeView="knowledge"
    >
      <PageTitle
        title={t("agentLayer:knowledge.pageTitle", { name: project?.name })}
        hideAppName
      />
      <div className="h-full min-h-0 overflow-y-auto bg-background">
        <AgentLayerEmpty
          title={t("agentLayer:knowledge.title")}
          description={t("agentLayer:knowledge.placeholder")}
        />
      </div>
    </ProjectLayout>
  );
}
