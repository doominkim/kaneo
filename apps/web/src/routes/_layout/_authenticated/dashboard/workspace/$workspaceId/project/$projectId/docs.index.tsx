import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  AgentLayerErrorState,
  AgentLayerSkeleton,
} from "@/components/agent-layer/agent-layer-state";
import { CreateDocumentDialog } from "@/components/agent-layer/create-document-dialog";
import { FileLibrary } from "@/components/agent-layer/file-library";
import { OVERVIEW_DOCUMENT_SLUG } from "@/components/agent-layer/project-description";
import ProjectLayout from "@/components/common/project-layout";
import PageTitle from "@/components/page-title";
import { useAgentArtifacts } from "@/hooks/queries/agent-layer/use-agent-artifacts";
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
  const artifacts = useAgentArtifacts(projectId);
  const { byId } = useAgentTaskIndex(projectId);
  const memberNameById = useMemberNames(workspaceId);
  const { canUpdateTasks, canUpdateProjects } = useWorkspacePermission();
  const [isCreateOpen, setIsCreateOpen] = useState(false);

  // The overview description lives under a reserved slug: it is edited from
  // the overview tab, never listed or re-created here.
  const existingSlugs = useMemo(
    () =>
      new Set([
        OVERVIEW_DOCUMENT_SLUG,
        ...(documents.data?.documents.map((doc) => doc.slug) ?? []),
      ]),
    [documents.data],
  );
  const tasks = useMemo(
    () =>
      [...byId.values()]
        .map((node) => ({
          id: node.id,
          number: node.number,
          title: node.title,
        }))
        .sort((a, b) => (b.number ?? 0) - (a.number ?? 0)),
    [byId],
  );

  const failed = documents.isError
    ? documents
    : artifacts.isError
      ? artifacts
      : null;
  const loaded =
    artifacts.data && documents.data
      ? {
          artifacts: artifacts.data.artifacts,
          documents: documents.data.documents.filter(
            (document) => document.slug !== OVERVIEW_DOCUMENT_SLUG,
          ),
        }
      : null;

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
        {failed ? (
          <AgentLayerErrorState
            error={failed.error}
            onRetry={() => {
              documents.refetch();
              artifacts.refetch();
            }}
          />
        ) : !loaded ? (
          <div className="px-3 py-3 sm:px-4">
            <AgentLayerSkeleton rows={5} />
          </div>
        ) : (
          <FileLibrary
            artifacts={loaded.artifacts}
            documents={loaded.documents}
            workspaceId={workspaceId}
            projectId={projectId}
            projectSlug={project?.slug}
            tasks={tasks}
            memberNameById={memberNameById}
            canUpload={canUpdateTasks()}
            canDelete={canUpdateProjects()}
            onCreateDocument={() => setIsCreateOpen(true)}
          />
        )}
      </div>

      <CreateDocumentDialog
        open={isCreateOpen}
        onOpenChange={setIsCreateOpen}
        projectId={projectId}
        workspaceId={workspaceId}
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
