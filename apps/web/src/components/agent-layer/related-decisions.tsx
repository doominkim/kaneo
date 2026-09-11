import { Link } from "@tanstack/react-router";
import { Plus } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useAgentDecisions } from "@/hooks/queries/agent-layer/use-agent-decisions";
import { AdrEditorDialog } from "./adr-editor-dialog";

export function RelatedDecisions({
  projectId,
  workspaceId,
  taskId,
  canWrite,
}: {
  projectId: string;
  workspaceId: string;
  taskId: string;
  canWrite: boolean;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const query = useAgentDecisions({ projectId, status: "all", taskId });
  const decisions = query.data?.pages.flatMap((page) => page.decisions) ?? [];
  const labels = {
    draft: t("agentLayer:adr.statusDraft"),
    accepted: t("agentLayer:adr.statusAccepted"),
    superseded: t("agentLayer:adr.statusSuperseded"),
  };
  return (
    <section className="space-y-2" data-testid="related-decisions">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">
          {t("agentLayer:adr.relatedTitle")}
        </h2>
        {canWrite ? (
          <Button
            size="xs"
            variant="outline"
            onClick={() => setOpen(true)}
            data-testid="create-task-adr"
          >
            <Plus />
            {t("agentLayer:adr.create")}
          </Button>
        ) : null}
      </div>
      {query.isPending ? (
        <p className="text-xs text-muted-foreground">
          {t("agentLayer:adr.loading")}
        </p>
      ) : query.isError ? (
        <div className="flex items-center gap-2">
          <p className="text-xs text-destructive">
            {t("agentLayer:adr.relatedLoadFailed")}
          </p>
          <Button size="xs" variant="outline" onClick={() => query.refetch()}>
            {t("agentLayer:adr.retry")}
          </Button>
        </div>
      ) : decisions.length ? (
        <ul className="space-y-1">
          {decisions.map((decision) => (
            <li key={decision.id}>
              <Link
                to="/dashboard/workspace/$workspaceId/project/$projectId/decisions/$decisionId"
                params={{ workspaceId, projectId, decisionId: decision.id }}
                search={{ origin: "task", taskId }}
                className="flex items-center gap-2 text-sm hover:underline"
              >
                <span className="min-w-0 flex-1 truncate">
                  {decision.title}
                </span>
                <Badge
                  size="sm"
                  variant={
                    decision.status === "accepted"
                      ? "success"
                      : decision.status === "superseded"
                        ? "secondary"
                        : "outline"
                  }
                >
                  {labels[decision.status]}
                </Badge>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-xs text-muted-foreground">
          {t("agentLayer:adr.relatedEmpty")}
        </p>
      )}
      {query.hasNextPage ? (
        <Button
          size="xs"
          variant="outline"
          onClick={() => query.fetchNextPage()}
          disabled={query.isFetchingNextPage}
        >
          {t("agentLayer:adr.loadMore")}
        </Button>
      ) : null}
      <AdrEditorDialog
        open={open}
        onOpenChange={setOpen}
        projectId={projectId}
        preselectedTaskId={taskId}
        onSaved={() => setOpen(false)}
      />
    </section>
  );
}
