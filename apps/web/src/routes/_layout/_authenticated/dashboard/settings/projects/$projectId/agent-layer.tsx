import { createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import {
  AgentLayerErrorState,
  AgentLayerSkeleton,
} from "@/components/agent-layer/agent-layer-state";
import { ProjectSettingsForm } from "@/components/agent-layer/project-settings-form";
import PageTitle from "@/components/page-title";
import { isAgentLayerStatus } from "@/fetchers/agent-layer/api-error";
import { usePutAgentProjectSettings } from "@/hooks/mutations/agent-layer/use-put-agent-project-settings";
import { useAgentProjectSettings } from "@/hooks/queries/agent-layer/use-agent-project-settings";
import { useMemberNames } from "@/hooks/queries/agent-layer/use-member-names";
import { useWorkspacePermission } from "@/hooks/use-workspace-permission";
import { toast } from "@/lib/toast";

export const Route = createFileRoute(
  "/_layout/_authenticated/dashboard/settings/projects/$projectId/agent-layer",
)({
  component: RouteComponent,
});

/** Agent Layer project settings: core paths, thresholds (DESIGN.md §6.1, §6.2). */
function RouteComponent() {
  const { t } = useTranslation();
  const { projectId } = Route.useParams();
  const { canUpdateProjects, workspace } = useWorkspacePermission();
  const settings = useAgentProjectSettings(projectId);
  const memberNameById = useMemberNames(workspace?.id ?? "");
  const { mutateAsync, isPending } = usePutAgentProjectSettings();

  return (
    <>
      <PageTitle title={t("agentLayer:settings.pageTitle")} />
      <div className="mx-auto max-w-4xl space-y-8">
        <div className="space-y-2">
          <h1 className="text-2xl font-semibold">
            {t("agentLayer:settings.title")}
          </h1>
          <p className="text-muted-foreground">
            {t("agentLayer:settings.subtitle")}
          </p>
        </div>

        {settings.isPending ? (
          <AgentLayerSkeleton rows={4} />
        ) : settings.isError ? (
          <AgentLayerErrorState
            error={settings.error}
            onRetry={() => settings.refetch()}
          />
        ) : (
          <ProjectSettingsForm
            settings={settings.data}
            canEdit={canUpdateProjects()}
            isSaving={isPending}
            memberNameById={memberNameById}
            onSave={async (body) => {
              try {
                await mutateAsync({ projectId, body });
                toast.success(t("agentLayer:settings.saved"));
              } catch (cause) {
                toast.error(t("agentLayer:settings.saveFailed"), {
                  description:
                    cause instanceof Error &&
                    (isAgentLayerStatus(cause, 400) ||
                      isAgentLayerStatus(cause, 403))
                      ? cause.message
                      : undefined,
                });
              }
            }}
          />
        )}
      </div>
    </>
  );
}
