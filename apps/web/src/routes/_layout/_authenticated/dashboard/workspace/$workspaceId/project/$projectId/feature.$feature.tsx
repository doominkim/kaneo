import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import { useTranslation } from "react-i18next";
import { z } from "zod";
import {
  AgentLayerErrorState,
  AgentLayerSkeleton,
} from "@/components/agent-layer/agent-layer-state";
import { DesignPage } from "@/components/agent-layer/design-page";
import { FeatureTasks } from "@/components/agent-layer/feature-tasks";
import { RequirementSetPage } from "@/components/agent-layer/requirement-set-page";
import ProjectLayout from "@/components/common/project-layout";
import PageTitle from "@/components/page-title";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { isAgentLayerStatus } from "@/fetchers/agent-layer/api-error";
import {
  usePutAgentDesign,
  usePutAgentRequirementSet,
} from "@/hooks/mutations/agent-layer/use-agent-spec";
import { useAgentDesign } from "@/hooks/queries/agent-layer/use-agent-designs";
import { useAgentRequirementSet } from "@/hooks/queries/agent-layer/use-agent-requirements";
import { useMemberNames } from "@/hooks/queries/agent-layer/use-member-names";
import useGetProject from "@/hooks/queries/project/use-get-project";
import { useWorkspacePermission } from "@/hooks/use-workspace-permission";
import { toast } from "@/lib/toast";

export const FEATURE_TABS = ["requirements", "design", "tasks"] as const;
export type FeatureTab = (typeof FEATURE_TABS)[number];

export const Route = createFileRoute(
  "/_layout/_authenticated/dashboard/workspace/$workspaceId/project/$projectId/feature/$feature",
)({
  validateSearch: z.object({
    tab: z.enum(FEATURE_TABS).catch("requirements").default("requirements"),
    edit: z.boolean().optional(),
  }),
  component: RouteComponent,
});

/**
 * One feature, three sub tabs (REQ-FEATURE-HUB-4). The requirements and
 * design tabs mount the existing pages unchanged (REQ-FEATURE-HUB-5); the
 * tasks tab lists what derives from this feature (REQ-FEATURE-HUB-6, 7).
 */
function RouteComponent() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { projectId, workspaceId, feature } = Route.useParams();
  const { tab, edit } = Route.useSearch();
  const { data: project } = useGetProject({ id: projectId, workspaceId });
  const set = useAgentRequirementSet(projectId, feature);
  const design = useAgentDesign(projectId, feature);
  const memberNameById = useMemberNames(workspaceId);
  const { canUpdateTasks } = useWorkspacePermission();
  const putSet = usePutAgentRequirementSet();
  const putDesign = usePutAgentDesign();
  const canEdit = canUpdateTasks();

  const setMissing = set.isError && isAgentLayerStatus(set.error, 404);
  const designMissing = design.isError && isAgentLayerStatus(design.error, 404);
  const title = set.data?.title ?? design.data?.title ?? feature;

  const selectTab = (next: FeatureTab) =>
    navigate({ to: ".", search: { tab: next }, replace: true });

  const createDesign = async () => {
    try {
      await putDesign.mutateAsync({
        projectId,
        feature,
        body: { title, body: `# ${title}\n`, requirementKeys: [] },
      });
      navigate({
        to: ".",
        search: { tab: "design", edit: true },
        replace: true,
      });
    } catch (cause) {
      toast.error(t("agentLayer:spec.saveFailed"), {
        description: cause instanceof Error ? cause.message : undefined,
      });
    }
  };
  const createRequirements = async () => {
    try {
      await putSet.mutateAsync({
        projectId,
        feature,
        body: { title, body: "", items: [] },
      });
      navigate({
        to: ".",
        search: { tab: "requirements", edit: true },
        replace: true,
      });
    } catch (cause) {
      toast.error(t("agentLayer:spec.saveFailed"), {
        description: cause instanceof Error ? cause.message : undefined,
      });
    }
  };

  const failed =
    set.isError && !setMissing
      ? set
      : design.isError && !designMissing
        ? design
        : null;
  const loading =
    (!set.data && !set.isError) || (!design.data && !design.isError);

  return (
    <ProjectLayout
      projectId={projectId}
      workspaceId={workspaceId}
      activeView="feature"
    >
      <PageTitle
        title={t("agentLayer:spec.featurePageTitle", { name: title })}
        hideAppName
      />
      <div className="flex h-full min-h-0 flex-col bg-background">
        <div className="flex flex-wrap items-center gap-2 border-b border-border/80 px-3 py-2 sm:px-4">
          <Link
            to="/dashboard/workspace/$workspaceId/project/$projectId/feature"
            params={{ workspaceId, projectId }}
            className="flex items-center gap-1 text-xs text-muted-foreground underline-offset-2 hover:underline"
          >
            <ArrowLeft className="size-3.5" />
            {t("agentLayer:spec.backToFeatures")}
          </Link>
          <span
            className="font-mono text-xs text-muted-foreground"
            data-testid="feature-slug"
          >
            {feature}
          </span>
          <Tabs
            value={tab}
            onValueChange={(value) => selectTab(value as FeatureTab)}
            className="ml-auto"
          >
            <TabsList aria-label={t("agentLayer:spec.featureTitle")}>
              <TabsTrigger value="requirements" data-testid="tab-requirements">
                {t("agentLayer:spec.tabRequirements")}
              </TabsTrigger>
              <TabsTrigger value="design" data-testid="tab-design">
                {t("agentLayer:spec.tabDesign")}
              </TabsTrigger>
              <TabsTrigger value="tasks" data-testid="tab-tasks">
                {t("agentLayer:spec.tabTasks")}
              </TabsTrigger>
            </TabsList>
          </Tabs>
        </div>

        <div className="min-h-0 flex-1">
          {failed ? (
            <AgentLayerErrorState
              error={failed.error}
              onRetry={() => failed.refetch()}
            />
          ) : loading ? (
            <div className="px-3 py-3 sm:px-4">
              <AgentLayerSkeleton rows={6} />
            </div>
          ) : tab === "requirements" ? (
            set.data ? (
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
                canEdit={canEdit}
                startInEdit={edit === true}
                embedded
              />
            ) : (
              <EmptyPane
                text={t("agentLayer:spec.createRequirementsHere")}
                action={
                  canEdit ? t("agentLayer:spec.createRequirements") : null
                }
                onAction={createRequirements}
                pending={putSet.isPending}
                testId="create-requirements"
              />
            )
          ) : tab === "design" ? (
            design.data ? (
              <DesignPage
                key={design.data.id}
                design={design.data}
                requirementSet={set.data ?? null}
                workspaceId={workspaceId}
                projectId={projectId}
                projectSlug={project?.slug}
                canEdit={canEdit}
                startInEdit={edit === true}
                embedded
              />
            ) : (
              <EmptyPane
                text={t("agentLayer:spec.createDesignHere")}
                action={canEdit ? t("agentLayer:spec.createDesign") : null}
                onAction={createDesign}
                pending={putDesign.isPending}
                testId="create-design"
              />
            )
          ) : (
            <FeatureTasks
              workspaceId={workspaceId}
              projectId={projectId}
              feature={feature}
              projectSlug={project?.slug}
              requirementSet={set.data ?? null}
              hasDesign={Boolean(design.data)}
              canEdit={canEdit}
            />
          )}
        </div>
      </div>
    </ProjectLayout>
  );
}

function EmptyPane({
  text,
  action,
  onAction,
  pending,
  testId,
}: {
  text: string;
  action: string | null;
  onAction: () => void;
  pending: boolean;
  testId: string;
}) {
  return (
    <div className="mx-auto max-w-3xl space-y-3 px-3 py-8 text-center sm:px-4">
      <p className="text-sm text-muted-foreground">{text}</p>
      {action ? (
        <Button
          size="sm"
          variant="outline"
          disabled={pending}
          onClick={onAction}
          data-testid={testId}
        >
          {action}
        </Button>
      ) : null}
    </div>
  );
}
