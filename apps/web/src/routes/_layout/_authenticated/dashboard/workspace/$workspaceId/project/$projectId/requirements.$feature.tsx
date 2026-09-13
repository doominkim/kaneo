import { createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { z } from "zod";
import {
  AgentLayerErrorState,
  AgentLayerSkeleton,
} from "@/components/agent-layer/agent-layer-state";
import { RequirementSetPage } from "@/components/agent-layer/requirement-set-page";
import ProjectLayout from "@/components/common/project-layout";
import PageTitle from "@/components/page-title";
import { useAgentRequirementSet } from "@/hooks/queries/agent-layer/use-agent-requirements";
import { useMemberNames } from "@/hooks/queries/agent-layer/use-member-names";
import useGetProject from "@/hooks/queries/project/use-get-project";
import { useWorkspacePermission } from "@/hooks/use-workspace-permission";

export const Route = createFileRoute(
  "/_layout/_authenticated/dashboard/workspace/$workspaceId/project/$projectId/requirements/$feature",
)({
  validateSearch: z.object({ edit: z.boolean().optional() }),
  component: RouteComponent,
});

function RouteComponent() {
  const { t } = useTranslation();
  const { projectId, workspaceId, feature } = Route.useParams();
  const { edit } = Route.useSearch();
  const { data: project } = useGetProject({ id: projectId, workspaceId });
  const set = useAgentRequirementSet(projectId, feature);
  const memberNameById = useMemberNames(workspaceId);
  const { canUpdateTasks } = useWorkspacePermission();

  return (
    <ProjectLayout
      projectId={projectId}
      workspaceId={workspaceId}
      activeView="requirements"
    >
      <PageTitle
        title={t("agentLayer:spec.requirementsPageTitle", {
          name: set.data?.title ?? project?.name,
        })}
        hideAppName
      />
      <div className="h-full min-h-0 bg-background">
        {set.isError ? (
          <AgentLayerErrorState
            error={set.error}
            onRetry={() => set.refetch()}
          />
        ) : !set.data ? (
          <div className="px-3 py-3 sm:px-4">
            <AgentLayerSkeleton rows={6} />
          </div>
        ) : (
          <RequirementSetPage
            key={set.data.id}
            set={set.data}
            workspaceId={workspaceId}
            projectId={projectId}
            projectSlug={project?.slug}
            authorName={
              set.data.updatedBy
                ? (memberNameById.get(set.data.updatedBy) ?? null)
                : null
            }
            canEdit={canUpdateTasks()}
            startInEdit={edit === true}
          />
        )}
      </div>
    </ProjectLayout>
  );
}
