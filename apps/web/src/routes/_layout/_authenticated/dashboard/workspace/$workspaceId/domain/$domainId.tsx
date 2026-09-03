import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import {
  AgentLayerErrorState,
  AgentLayerSkeleton,
} from "@/components/agent-layer/agent-layer-state";
import { DomainPage } from "@/components/agent-layer/domain-page";
import WorkspaceLayout from "@/components/common/workspace-layout";
import PageTitle from "@/components/page-title";
import { useAgentDomain } from "@/hooks/queries/agent-layer/use-agent-domain";
import { useAgentDomains } from "@/hooks/queries/agent-layer/use-agent-domains";
import { useWorkspacePermission } from "@/hooks/use-workspace-permission";

export const Route = createFileRoute(
  "/_layout/_authenticated/dashboard/workspace/$workspaceId/domain/$domainId",
)({
  component: RouteComponent,
});

/** 도메인: one domain page of the workspace (KAN-14). */
function RouteComponent() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { workspaceId, domainId } = Route.useParams();
  const page = useAgentDomain(workspaceId, domainId);
  const tree = useAgentDomains(workspaceId);
  const { canUpdateTasks, canUpdateWorkspace } = useWorkspacePermission();

  const open = (id: string) =>
    navigate({
      to: "/dashboard/workspace/$workspaceId/domain/$domainId",
      params: { workspaceId, domainId: id },
    });

  return (
    <>
      <PageTitle
        title={
          page.data
            ? t("agentLayer:domain.pageTitle", { title: page.data.title })
            : t("agentLayer:domain.title")
        }
      />
      <WorkspaceLayout title={t("agentLayer:domain.title")}>
        <div className="h-full min-h-0 overflow-y-auto bg-background">
          {page.isPending ? (
            <div className="px-3 py-3 sm:px-4">
              <AgentLayerSkeleton rows={6} />
            </div>
          ) : page.isError ? (
            <AgentLayerErrorState
              error={page.error}
              onRetry={() => page.refetch()}
            />
          ) : (
            <DomainPage
              key={page.data.id}
              page={page.data}
              workspaceId={workspaceId}
              nodes={tree.data?.domains}
              canEdit={canUpdateTasks()}
              canManage={canUpdateWorkspace()}
              onOpen={open}
              onDeleted={(parentId) => {
                if (parentId) {
                  open(parentId);
                } else {
                  navigate({
                    to: "/dashboard/workspace/$workspaceId",
                    params: { workspaceId },
                  });
                }
              }}
            />
          )}
        </div>
      </WorkspaceLayout>
    </>
  );
}
