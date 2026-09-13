import { createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { z } from "zod";
import {
  AgentLayerErrorState,
  AgentLayerSkeleton,
} from "@/components/agent-layer/agent-layer-state";
import { DesignPage } from "@/components/agent-layer/design-page";
import ProjectLayout from "@/components/common/project-layout";
import PageTitle from "@/components/page-title";
import { useAgentDesign } from "@/hooks/queries/agent-layer/use-agent-designs";
import { useAgentRequirementSet } from "@/hooks/queries/agent-layer/use-agent-requirements";
import useGetProject from "@/hooks/queries/project/use-get-project";
import { useWorkspacePermission } from "@/hooks/use-workspace-permission";

export const Route = createFileRoute(
  "/_layout/_authenticated/dashboard/workspace/$workspaceId/project/$projectId/design/$feature",
)({
  validateSearch: z.object({ edit: z.boolean().optional() }),
  component: RouteComponent,
});

function RouteComponent() {
  const { t } = useTranslation();
  const { projectId, workspaceId, feature } = Route.useParams();
  const { edit } = Route.useSearch();
  const { data: project } = useGetProject({ id: projectId, workspaceId });
  const design = useAgentDesign(projectId, feature);
  // The checklist in edit mode comes from the requirement set with the same feature.
  const requirementSet = useAgentRequirementSet(projectId, feature);
  const { canUpdateTasks } = useWorkspacePermission();

  return (
    <ProjectLayout
      projectId={projectId}
      workspaceId={workspaceId}
      activeView="design"
    >
      <PageTitle
        title={t("agentLayer:spec.designPageTitle", {
          name: design.data?.title ?? project?.name,
        })}
        hideAppName
      />
      <div className="h-full min-h-0 bg-background">
        {design.isError ? (
          <AgentLayerErrorState
            error={design.error}
            onRetry={() => design.refetch()}
          />
        ) : !design.data ? (
          <div className="px-3 py-3 sm:px-4">
            <AgentLayerSkeleton rows={6} />
          </div>
        ) : (
          <DesignPage
            key={design.data.id}
            design={design.data}
            requirementSet={requirementSet.data ?? null}
            workspaceId={workspaceId}
            projectId={projectId}
            projectSlug={project?.slug}
            canEdit={canUpdateTasks()}
            startInEdit={edit === true}
          />
        )}
      </div>
    </ProjectLayout>
  );
}
