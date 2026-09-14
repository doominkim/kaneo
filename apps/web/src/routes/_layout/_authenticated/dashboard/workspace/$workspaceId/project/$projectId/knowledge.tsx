import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Plus } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { z } from "zod";
import { AdrList } from "@/components/agent-layer/adr-list";
import { DecisionList } from "@/components/agent-layer/decision-list";
import { EntryDetailSheet } from "@/components/agent-layer/entry-detail-sheet";
import { ProposeTermDialog } from "@/components/agent-layer/propose-term-dialog";
import { UnreviewedCount } from "@/components/agent-layer/spec-badges";
import { TermList } from "@/components/agent-layer/term-list";
import { TermResolve } from "@/components/agent-layer/term-resolve";
import ProjectLayout from "@/components/common/project-layout";
import PageTitle from "@/components/page-title";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAgentTaskIndex } from "@/hooks/queries/agent-layer/use-agent-task-index";
import { useAgentUnreviewedCounts } from "@/hooks/queries/agent-layer/use-agent-unreviewed-counts";
import useGetProject from "@/hooks/queries/project/use-get-project";
import { useWorkspacePermission } from "@/hooks/use-workspace-permission";

export const Route = createFileRoute(
  "/_layout/_authenticated/dashboard/workspace/$workspaceId/project/$projectId/knowledge",
)({
  validateSearch: z.object({
    tab: z
      .enum(["knowledge", "decisions"])
      .catch("knowledge")
      .default("knowledge"),
    status: z
      .enum(["current", "all", "accepted", "superseded", "deleted"])
      .catch("current")
      .default("current"),
    q: z.string().max(200).optional(),
  }),
  component: RouteComponent,
});

/** 지식: workspace glossary (DESIGN.md §4.4) and the project's decisions. */
function RouteComponent() {
  const { t } = useTranslation();
  const { projectId, workspaceId } = Route.useParams();
  const search = Route.useSearch();
  const navigate = useNavigate();
  const { data: project } = useGetProject({ id: projectId, workspaceId });
  const { taskNumberById } = useAgentTaskIndex(projectId);
  const { canUpdateTasks, canUpdateWorkspace, canUpdateProjects } =
    useWorkspacePermission();
  const unreviewed = useAgentUnreviewedCounts(projectId, workspaceId);
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
        <div className="mx-auto max-w-4xl space-y-5 px-3 py-4 sm:px-4">
          <Tabs
            value={search.tab}
            onValueChange={(tab) =>
              navigate({
                to: ".",
                search: { ...search, tab: tab as "knowledge" | "decisions" },
                replace: true,
              })
            }
          >
            <TabsList aria-label={t("agentLayer:knowledge.title")}>
              <TabsTrigger value="knowledge" data-testid="knowledge-items-tab">
                {t("agentLayer:adr.tabKnowledge")}
                <UnreviewedCount count={unreviewed.terms} />
              </TabsTrigger>
              <TabsTrigger value="decisions" data-testid="adr-tab">
                {t("agentLayer:adr.tabDecisions")}
                <UnreviewedCount count={unreviewed.decisions} />
              </TabsTrigger>
            </TabsList>
            <TabsContent value="knowledge" className="space-y-8 pt-3">
              <section className="space-y-3" data-testid="glossary-section">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h1 className="text-sm font-semibold text-foreground">
                      {t("agentLayer:knowledge.glossaryLiveTitle")}
                    </h1>
                    <p className="text-xs text-muted-foreground">
                      {t("agentLayer:knowledge.glossaryLiveHint")}
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
                {/*
              Confirm, dispute and filing stay on the domain page each item is
              filed under (KAN-16), where the reviewer has the context. This
              tab shows what agents read; delete, restore and the review mark
              on opening a definition work here too (agent-autoapply).
            */}
                <p
                  className="text-xs text-muted-foreground"
                  data-testid="review-elsewhere"
                >
                  {t("agentLayer:knowledge.reviewElsewhere")}
                </p>
                <TermList
                  workspaceId={workspaceId}
                  canReview={canUpdateWorkspace()}
                  confirmedOnly
                />
              </section>
            </TabsContent>

            <TabsContent value="decisions" className="space-y-6 pt-3">
              <section className="space-y-3" data-testid="adr-section">
                <div>
                  <h2 className="text-sm font-semibold text-foreground">
                    {t("agentLayer:adr.tabDecisions")}
                  </h2>
                  <p className="text-xs text-muted-foreground">
                    {t("agentLayer:adr.immutableHint")}
                  </p>
                </div>
                <AdrList
                  projectId={projectId}
                  workspaceId={workspaceId}
                  canWrite={canUpdateTasks()}
                  canManage={canUpdateProjects()}
                  initialStatus={search.status}
                  initialSearch={search.q ?? ""}
                  onFiltersChange={({ status, q }) =>
                    navigate({
                      to: ".",
                      search: {
                        tab: "decisions",
                        status,
                        ...(q.trim() ? { q: q.trim() } : {}),
                      },
                      replace: true,
                    })
                  }
                />
              </section>
              <section className="space-y-3" data-testid="decisions-section">
                <h3 className="text-sm font-semibold text-foreground">
                  {t("agentLayer:knowledge.decisionsTitle")}
                </h3>
                <DecisionList
                  projectId={projectId}
                  projectSlug={project?.slug}
                  taskNumberById={taskNumberById}
                  onOpenEntry={setSelectedEntryId}
                />
              </section>
            </TabsContent>
          </Tabs>
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
