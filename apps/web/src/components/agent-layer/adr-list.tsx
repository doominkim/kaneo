import { useNavigate } from "@tanstack/react-router";
import { Plus, Search, Undo2 } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type {
  AgentDecisionStatusFilter,
  AgentDecisionSummary,
} from "@/fetchers/agent-layer/agent-decisions";
import { isAgentLayerStatus } from "@/fetchers/agent-layer/api-error";
import { useRestoreAgentDecision } from "@/hooks/mutations/agent-layer/use-agent-decisions";
import { useAgentDecisions } from "@/hooks/queries/agent-layer/use-agent-decisions";
import { useMemberNames } from "@/hooks/queries/agent-layer/use-member-names";
import { toast } from "@/lib/toast";
import { AdrEditorDialog } from "./adr-editor-dialog";
import { DeletedStamp, UnreviewedBadge } from "./spec-badges";

const adrNumber = (value: number) => `ADR-${String(value).padStart(3, "0")}`;

export function AdrList({
  projectId,
  workspaceId,
  canWrite,
  canManage = false,
  taskId,
  initialStatus = "current",
  initialSearch = "",
  onFiltersChange,
}: {
  projectId: string;
  workspaceId: string;
  /** task:update: create an ADR. */
  canWrite: boolean;
  /** project:update: restore a deleted ADR. */
  canManage?: boolean;
  taskId?: string;
  initialStatus?: AgentDecisionStatusFilter;
  initialSearch?: string;
  onFiltersChange?: (filters: {
    status: AgentDecisionStatusFilter;
    q: string;
  }) => void;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [status, setStatus] =
    useState<AgentDecisionStatusFilter>(initialStatus);
  const [search, setSearch] = useState(initialSearch);
  const [editorOpen, setEditorOpen] = useState(false);
  const memberNames = useMemberNames(workspaceId);
  const restore = useRestoreAgentDecision();
  const query = useAgentDecisions({
    projectId,
    status,
    q: search.trim() || undefined,
    taskId,
  });
  const decisions = query.data?.pages.flatMap((page) => page.decisions) ?? [];
  const open = (decisionId: string) =>
    navigate({
      to: "/dashboard/workspace/$workspaceId/project/$projectId/decisions/$decisionId",
      params: { workspaceId, projectId, decisionId },
      search: taskId
        ? { origin: "task" as const, taskId }
        : {
            origin: "knowledge" as const,
            status,
            ...(search.trim() ? { q: search.trim() } : {}),
          },
    });
  const statusLabel = (value: AgentDecisionSummary["status"]) =>
    value === "accepted"
      ? t("agentLayer:adr.statusAccepted")
      : t("agentLayer:adr.statusSuperseded");
  const statusBadge = (value: AgentDecisionSummary["status"]) => (
    <Badge size="sm" variant={value === "accepted" ? "success" : "secondary"}>
      {statusLabel(value)}
    </Badge>
  );

  // A deleted ADR has no detail to open (the API does not find it), so its
  // row carries the restore itself.
  const handleRestore = async (decision: AgentDecisionSummary) => {
    try {
      await restore.mutateAsync({ projectId, decisionId: decision.id });
      toast.success(
        t("agentLayer:adr.restored", {
          number: String(decision.number).padStart(3, "0"),
        }),
      );
    } catch (cause) {
      toast.error(
        isAgentLayerStatus(cause, 409)
          ? t("agentLayer:adr.restoreConflict")
          : t("agentLayer:common.restoreFailed"),
        { description: cause instanceof Error ? cause.message : undefined },
      );
    }
  };

  return (
    <div className="space-y-3" data-testid="adr-list">
      <div className="flex flex-wrap gap-2">
        <div className="relative min-w-48 flex-1">
          <Search className="absolute left-2 top-2 size-4 text-muted-foreground" />
          <Input
            value={search}
            onChange={(event) => {
              const q = event.target.value;
              setSearch(q);
              onFiltersChange?.({ status, q });
            }}
            className="pl-8"
            placeholder={t("agentLayer:adr.search")}
            aria-label={t("agentLayer:adr.search")}
            data-testid="adr-search"
          />
        </div>
        <select
          className="rounded-md border bg-background px-2 text-sm"
          value={status}
          onChange={(event) => {
            const next = event.target.value as AgentDecisionStatusFilter;
            setStatus(next);
            onFiltersChange?.({ status: next, q: search });
          }}
          data-testid="adr-status-filter"
          aria-label={t("agentLayer:adr.filterStatus")}
        >
          <option value="current">{t("agentLayer:adr.filterCurrent")}</option>
          <option value="accepted">{t("agentLayer:adr.statusAccepted")}</option>
          <option value="superseded">
            {t("agentLayer:adr.statusSuperseded")}
          </option>
          <option value="all">{t("agentLayer:adr.filterAll")}</option>
          <option value="deleted">{t("agentLayer:adr.statusDeleted")}</option>
        </select>
        {canWrite ? (
          <Button
            size="sm"
            onClick={() => setEditorOpen(true)}
            data-testid="create-adr"
          >
            <Plus />
            {t("agentLayer:adr.create")}
          </Button>
        ) : null}
      </div>
      {query.isPending ? (
        <p className="text-sm text-muted-foreground">
          {t("agentLayer:adr.loading")}
        </p>
      ) : query.isError ? (
        <div className="space-y-2">
          <p className="text-sm text-destructive">
            {t("agentLayer:adr.loadFailed")}
          </p>
          <Button size="sm" variant="outline" onClick={() => query.refetch()}>
            {t("agentLayer:adr.retry")}
          </Button>
        </div>
      ) : decisions.length === 0 ? (
        <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
          {t("agentLayer:adr.empty")}
        </p>
      ) : (
        <ol className="divide-y rounded-lg border">
          {decisions.map((decision) =>
            decision.deletedAt ? (
              <li
                key={decision.id}
                className="space-y-1 p-3"
                data-testid={`adr-deleted-row-${decision.id}`}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-xs text-muted-foreground">
                    {adrNumber(decision.number)}
                  </span>
                  <span className="font-medium">{decision.title}</span>
                  {statusBadge(decision.status)}
                  {canManage ? (
                    <Button
                      size="xs"
                      variant="outline"
                      className="ml-auto"
                      disabled={
                        restore.isPending &&
                        restore.variables?.decisionId === decision.id
                      }
                      onClick={() => handleRestore(decision)}
                      data-testid="restore-adr"
                    >
                      <Undo2 />
                      {t("agentLayer:common.restore")}
                    </Button>
                  ) : null}
                </div>
                <DeletedStamp
                  deletedAt={decision.deletedAt}
                  deletedByName={
                    decision.deletedBy
                      ? memberNames.get(decision.deletedBy)
                      : null
                  }
                />
              </li>
            ) : (
              <li key={decision.id}>
                <button
                  type="button"
                  className="w-full space-y-1 p-3 text-left hover:bg-muted/40"
                  onClick={() => open(decision.id)}
                  data-testid={`adr-row-${decision.id}`}
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-xs text-muted-foreground">
                      {adrNumber(decision.number)}
                    </span>
                    <span className="font-medium">{decision.title}</span>
                    {statusBadge(decision.status)}
                    {decision.reviewed ? null : <UnreviewedBadge />}
                  </div>
                  <p className="line-clamp-2 text-sm text-muted-foreground">
                    {decision.contextPreview}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {new Date(decision.createdAt).toLocaleDateString()} ·{" "}
                    {t("agentLayer:adr.relatedTasksCount", {
                      count: decision.tasks.length,
                    })}
                  </p>
                </button>
              </li>
            ),
          )}
        </ol>
      )}
      {query.hasNextPage ? (
        <div className="text-center">
          <Button
            size="sm"
            variant="outline"
            onClick={() => query.fetchNextPage()}
            disabled={query.isFetchingNextPage}
          >
            {t("agentLayer:adr.loadMore")}
          </Button>
        </div>
      ) : null}
      <AdrEditorDialog
        open={editorOpen}
        onOpenChange={setEditorOpen}
        projectId={projectId}
        preselectedTaskId={taskId}
        onSaved={(decision) => open(decision.id)}
      />
    </div>
  );
}
