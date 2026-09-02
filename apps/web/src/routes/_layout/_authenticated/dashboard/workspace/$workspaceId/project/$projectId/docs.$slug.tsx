import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import {
  AgentLayerErrorState,
  AgentLayerSkeleton,
} from "@/components/agent-layer/agent-layer-state";
import { DocumentPage } from "@/components/agent-layer/document-page";
import ProjectLayout from "@/components/common/project-layout";
import PageTitle from "@/components/page-title";
import { useAgentDocument } from "@/hooks/queries/agent-layer/use-agent-document";
import { useAgentTaskIndex } from "@/hooks/queries/agent-layer/use-agent-task-index";
import { useMemberNames } from "@/hooks/queries/agent-layer/use-member-names";
import useGetProject from "@/hooks/queries/project/use-get-project";
import { useWorkspacePermission } from "@/hooks/use-workspace-permission";

type DocumentSearchParams = {
  edit?: boolean;
};

export const Route = createFileRoute(
  "/_layout/_authenticated/dashboard/workspace/$workspaceId/project/$projectId/docs/$slug",
)({
  component: RouteComponent,
  validateSearch: (search: Record<string, unknown>): DocumentSearchParams => ({
    edit: search.edit === true || search.edit === "true" ? true : undefined,
  }),
});

function RouteComponent() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { projectId, workspaceId, slug } = Route.useParams();
  const { edit } = Route.useSearch();
  const { data: project } = useGetProject({ id: projectId, workspaceId });
  const document = useAgentDocument(projectId, slug);
  const { taskNumberById } = useAgentTaskIndex(projectId);
  const memberNameById = useMemberNames(workspaceId);
  const { canUpdateTasks, canUpdateProjects } = useWorkspacePermission();

  return (
    <ProjectLayout
      projectId={projectId}
      workspaceId={workspaceId}
      activeView="docs"
    >
      <PageTitle
        title={
          document.data?.title ??
          t("agentLayer:docs.pageTitle", { name: project?.name })
        }
        hideAppName
      />
      <div className="h-full min-h-0 bg-background">
        {document.isPending ? (
          <div className="px-3 py-3 sm:px-4">
            <AgentLayerSkeleton rows={6} />
          </div>
        ) : document.isError ? (
          <AgentLayerErrorState
            error={document.error}
            onRetry={() => document.refetch()}
          />
        ) : (
          <DocumentPage
            key={document.data.id}
            document={document.data}
            workspaceId={workspaceId}
            projectId={projectId}
            projectSlug={project?.slug}
            taskNumber={
              document.data.taskId
                ? taskNumberById.get(document.data.taskId)
                : undefined
            }
            authorName={
              document.data.updatedBy
                ? memberNameById.get(document.data.updatedBy)
                : null
            }
            canEdit={canUpdateTasks()}
            canDelete={canUpdateProjects()}
            startInEdit={edit === true}
            onDeleted={() =>
              navigate({
                to: "/dashboard/workspace/$workspaceId/project/$projectId/docs",
                params: { workspaceId, projectId },
              })
            }
          />
        )}
      </div>
    </ProjectLayout>
  );
}
