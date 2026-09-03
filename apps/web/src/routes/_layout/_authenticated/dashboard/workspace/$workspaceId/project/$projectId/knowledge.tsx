import { createFileRoute } from "@tanstack/react-router";
import { Plus } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { DecisionList } from "@/components/agent-layer/decision-list";
import { EntryDetailSheet } from "@/components/agent-layer/entry-detail-sheet";
import { ProposeTermDialog } from "@/components/agent-layer/propose-term-dialog";
import { TermList } from "@/components/agent-layer/term-list";
import { TermResolve } from "@/components/agent-layer/term-resolve";
import ProjectLayout from "@/components/common/project-layout";
import PageTitle from "@/components/page-title";
import { Button } from "@/components/ui/button";
import { useAgentTaskIndex } from "@/hooks/queries/agent-layer/use-agent-task-index";
import useGetProject from "@/hooks/queries/project/use-get-project";
import { useWorkspacePermission } from "@/hooks/use-workspace-permission";

export const Route = createFileRoute(
  "/_layout/_authenticated/dashboard/workspace/$workspaceId/project/$projectId/knowledge",
)({
  component: RouteComponent,
});

/** 지식: workspace glossary (DESIGN.md §4.4) and the project's decisions. */
function RouteComponent() {
  const { t } = useTranslation();
  const { projectId, workspaceId } = Route.useParams();
  const { data: project } = useGetProject({ id: projectId, workspaceId });
  const { taskNumberById } = useAgentTaskIndex(projectId);
  const { canUpdateWorkspace, canUpdateTasks } = useWorkspacePermission();
  const [proposeOpen, setProposeOpen] = useState(false);
  const [selectedEntryId, setSelectedEntryId] = useState<string | null>(null);

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
        <div className="mx-auto max-w-4xl space-y-8 px-3 py-4 sm:px-4">
          <section className="space-y-3" data-testid="glossary-section">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h1 className="text-sm font-semibold text-foreground">
                  {t("agentLayer:knowledge.glossaryTitle")}
                </h1>
                <p className="text-xs text-muted-foreground">
                  {t("agentLayer:knowledge.glossaryHint")}
                </p>
              </div>
              {canUpdateTasks() ? (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setProposeOpen(true)}
                  data-testid="propose-term"
                >
                  <Plus />
                  {t("agentLayer:knowledge.propose")}
                </Button>
              ) : null}
            </div>
            <TermResolve workspaceId={workspaceId} />
            <TermList
              workspaceId={workspaceId}
              canReview={canUpdateWorkspace()}
            />
          </section>

          <section className="space-y-3" data-testid="decisions-section">
            <div>
              <h2 className="text-sm font-semibold text-foreground">
                {t("agentLayer:knowledge.decisionsTitle")}
              </h2>
              <p className="text-xs text-muted-foreground">
                {t("agentLayer:knowledge.decisionsHint")}
              </p>
            </div>
            <DecisionList
              projectId={projectId}
              projectSlug={project?.slug}
              taskNumberById={taskNumberById}
              onOpenEntry={setSelectedEntryId}
            />
          </section>
        </div>
      </div>

      <ProposeTermDialog
        open={proposeOpen}
        onOpenChange={setProposeOpen}
        workspaceId={workspaceId}
      />
      <EntryDetailSheet
        projectId={projectId}
        workspaceId={workspaceId}
        projectSlug={project?.slug}
        entryId={selectedEntryId}
        taskNumberById={taskNumberById}
        onClose={() => setSelectedEntryId(null)}
      />
    </ProjectLayout>
  );
}
