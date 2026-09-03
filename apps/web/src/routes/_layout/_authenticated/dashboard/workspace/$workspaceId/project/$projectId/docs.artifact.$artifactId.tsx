import { createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import {
  AgentLayerErrorState,
  AgentLayerSkeleton,
} from "@/components/agent-layer/agent-layer-state";
import { ArtifactViewer } from "@/components/agent-layer/artifact-viewer";
import ProjectLayout from "@/components/common/project-layout";
import PageTitle from "@/components/page-title";
import { AgentLayerApiError } from "@/fetchers/agent-layer/api-error";
import { useAgentArtifacts } from "@/hooks/queries/agent-layer/use-agent-artifacts";
import { useAgentTaskIndex } from "@/hooks/queries/agent-layer/use-agent-task-index";
import { useMemberNames } from "@/hooks/queries/agent-layer/use-member-names";
import useGetProject from "@/hooks/queries/project/use-get-project";

export const Route = createFileRoute(
  "/_layout/_authenticated/dashboard/workspace/$workspaceId/project/$projectId/docs/artifact/$artifactId",
)({
  component: RouteComponent,
});

function RouteComponent() {
  const { t } = useTranslation();
  const { projectId, workspaceId, artifactId } = Route.useParams();
  const { data: project } = useGetProject({ id: projectId, workspaceId });
  const artifacts = useAgentArtifacts(projectId);
  const { taskNumberById } = useAgentTaskIndex(projectId);
  const memberNameById = useMemberNames(workspaceId);
  const artifact = artifacts.data?.artifacts.find(
    (candidate) => candidate.id === artifactId,
  );

  return (
    <ProjectLayout
      projectId={projectId}
      workspaceId={workspaceId}
      activeView="docs"
    >
      <PageTitle
        title={
          artifact?.name ??
          t("agentLayer:docs.pageTitle", { name: project?.name })
        }
        hideAppName
      />
      <div className="h-full min-h-0 bg-background">
        {artifacts.isPending ? (
          <div className="px-3 py-3 sm:px-4">
            <AgentLayerSkeleton rows={6} />
          </div>
        ) : artifacts.isError ? (
          <AgentLayerErrorState
            error={artifacts.error}
            onRetry={() => artifacts.refetch()}
          />
        ) : !artifact ? (
          <AgentLayerErrorState
            error={new AgentLayerApiError(404, "Artifact not found")}
          />
        ) : (
          <ArtifactViewer
            key={artifact.id}
            artifact={artifact}
            workspaceId={workspaceId}
            projectId={projectId}
            projectSlug={project?.slug}
            taskNumber={
              artifact.taskId ? taskNumberById.get(artifact.taskId) : undefined
            }
            authorName={
              artifact.uploadedBy
                ? memberNameById.get(artifact.uploadedBy)
                : null
            }
          />
        )}
      </div>
    </ProjectLayout>
  );
}
