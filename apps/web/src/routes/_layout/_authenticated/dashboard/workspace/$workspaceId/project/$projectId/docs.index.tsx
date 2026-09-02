import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  AgentLayerErrorState,
  AgentLayerSkeleton,
} from "@/components/agent-layer/agent-layer-state";
import { CreateDocumentDialog } from "@/components/agent-layer/create-document-dialog";
import { DocumentList } from "@/components/agent-layer/document-list";
import ProjectLayout from "@/components/common/project-layout";
import PageTitle from "@/components/page-title";
import { useAgentDocuments } from "@/hooks/queries/agent-layer/use-agent-documents";
import { useAgentTaskIndex } from "@/hooks/queries/agent-layer/use-agent-task-index";
import { useMemberNames } from "@/hooks/queries/agent-layer/use-member-names";
import useGetProject from "@/hooks/queries/project/use-get-project";
import { useWorkspacePermission } from "@/hooks/use-workspace-permission";

export const Route = createFileRoute(
  "/_layout/_authenticated/dashboard/workspace/$workspaceId/project/$projectId/docs/",
)({
  component: RouteComponent,
});

function RouteComponent() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { projectId, workspaceId } = Route.useParams();
  const { data: project } = useGetProject({ id: projectId, workspaceId });
  const documents = useAgentDocuments(projectId);
  const { taskNumberById } = useAgentTaskIndex(projectId);
  const memberNameById = useMemberNames(workspaceId);
  const { canUpdateTasks } = useWorkspacePermission();
  const [isCreateOpen, setIsCreateOpen] = useState(false);

  const existingSlugs = useMemo(
    () => new Set(documents.data?.documents.map((doc) => doc.slug) ?? []),
    [documents.data],
  );

  return (
    <ProjectLayout
      projectId={projectId}
      workspaceId={workspaceId}
      activeView="docs"
    >
      <PageTitle
        title={t("agentLayer:docs.pageTitle", { name: project?.name })}
        hideAppName
      />
      <div className="h-full min-h-0 bg-background">
        {documents.isPending ? (
          <div className="px-3 py-3 sm:px-4">
            <AgentLayerSkeleton rows={5} />
          </div>
        ) : documents.isError ? (
          <AgentLayerErrorState
            error={documents.error}
            onRetry={() => documents.refetch()}
          />
        ) : (
          <DocumentList
            documents={documents.data.documents}
            workspaceId={workspaceId}
            projectId={projectId}
            projectSlug={project?.slug}
            taskNumberById={taskNumberById}
            memberNameById={memberNameById}
            canCreate={canUpdateTasks()}
            onCreate={() => setIsCreateOpen(true)}
          />
        )}
      </div>

      <CreateDocumentDialog
        open={isCreateOpen}
        onOpenChange={setIsCreateOpen}
        projectId={projectId}
        existingSlugs={existingSlugs}
        onCreated={(slug) => {
          setIsCreateOpen(false);
          navigate({
            to: "/dashboard/workspace/$workspaceId/project/$projectId/docs/$slug",
            params: { workspaceId, projectId, slug },
            search: { edit: true },
          });
        }}
      />
    </ProjectLayout>
  );
}
