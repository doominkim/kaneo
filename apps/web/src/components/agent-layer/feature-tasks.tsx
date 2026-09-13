import { Link } from "@tanstack/react-router";
import { Plus } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPopup,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { AgentRequirementSet } from "@/fetchers/agent-layer/agent-requirements";
import { usePutAgentTaskLinks } from "@/hooks/mutations/agent-layer/use-agent-spec";
import useCreateTask from "@/hooks/mutations/task/use-create-task";
import { useAgentFeatureTasks } from "@/hooks/queries/agent-layer/use-agent-features";
import { getStatusDisplayLabel } from "@/lib/i18n/domain";
import { toast } from "@/lib/toast";
import { AgentLayerErrorState, AgentLayerSkeleton } from "./agent-layer-state";
import { RequirementKeyChip, StaleBadge, StaleCauses } from "./spec-badges";

type FeatureTasksProps = {
  workspaceId: string;
  projectId: string;
  feature: string;
  projectSlug?: string;
  requirementSet: AgentRequirementSet | null;
  hasDesign: boolean;
  canEdit: boolean;
};

/**
 * The tasks sub tab: only tasks derived from this feature (REQ-FEATURE-HUB-6),
 * and a creator that links the new task to the design and chosen criteria in
 * the same breath (REQ-FEATURE-HUB-7).
 */
export function FeatureTasks({
  workspaceId,
  projectId,
  feature,
  projectSlug,
  requirementSet,
  hasDesign,
  canEdit,
}: FeatureTasksProps) {
  const { t } = useTranslation();
  const tasks = useAgentFeatureTasks(projectId, feature);
  const [isCreateOpen, setIsCreateOpen] = useState(false);

  return (
    <div
      className="mx-auto max-w-4xl space-y-3 px-3 py-4 sm:px-4"
      data-testid="feature-tasks"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">
          {t("agentLayer:spec.featureTasksHint")}
        </p>
        {canEdit ? (
          <Button
            size="sm"
            variant="outline"
            onClick={() => setIsCreateOpen(true)}
            data-testid="new-feature-task"
          >
            <Plus />
            {t("agentLayer:spec.newTask")}
          </Button>
        ) : null}
      </div>
      {tasks.isError ? (
        <AgentLayerErrorState
          error={tasks.error}
          onRetry={() => tasks.refetch()}
        />
      ) : !tasks.data ? (
        <AgentLayerSkeleton rows={3} />
      ) : tasks.data.tasks.length === 0 ? (
        <p
          className="text-xs text-muted-foreground"
          data-testid="no-feature-tasks"
        >
          {t("agentLayer:spec.noFeatureTasks")}
        </p>
      ) : (
        <ul className="divide-y divide-border/70 rounded-md border border-border/80">
          {tasks.data.tasks.map((task) => (
            <li
              key={task.id}
              className="space-y-1.5 px-3 py-2"
              data-testid="feature-task"
            >
              <div className="flex flex-wrap items-center gap-2">
                <Link
                  to="/dashboard/workspace/$workspaceId/project/$projectId/task/$taskId"
                  params={{ workspaceId, projectId, taskId: task.id }}
                  className="text-sm font-medium underline-offset-2 hover:underline"
                >
                  {projectSlug && task.number
                    ? `${projectSlug}-${task.number} `
                    : ""}
                  {task.title}
                </Link>
                {task.status ? (
                  <span className="text-xs text-muted-foreground">
                    {getStatusDisplayLabel(task.status)}
                  </span>
                ) : null}
                <StaleBadge stale={task.stale} />
              </div>
              <div className="flex flex-wrap items-center gap-1">
                {task.requirementKeys.map((key) => (
                  <RequirementKeyChip
                    key={key}
                    requirementKey={key}
                    className="text-[10px]"
                  />
                ))}
                {task.viaDesign ? (
                  <span className="text-[10px] text-muted-foreground">
                    {t("agentLayer:spec.viaDesign")}
                  </span>
                ) : null}
              </div>
              {task.stale.stale ? <StaleCauses stale={task.stale} /> : null}
            </li>
          ))}
        </ul>
      )}
      {canEdit && isCreateOpen ? (
        <CreateFeatureTaskDialog
          open={isCreateOpen}
          onOpenChange={setIsCreateOpen}
          projectId={projectId}
          feature={feature}
          requirementSet={requirementSet}
          hasDesign={hasDesign}
        />
      ) : null}
    </div>
  );
}

function CreateFeatureTaskDialog({
  open,
  onOpenChange,
  projectId,
  feature,
  requirementSet,
  hasDesign,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  feature: string;
  requirementSet: AgentRequirementSet | null;
  hasDesign: boolean;
}) {
  const { t } = useTranslation();
  const createTask = useCreateTask();
  const link = usePutAgentTaskLinks();
  const [title, setTitle] = useState("");
  const [keys, setKeys] = useState<Set<string>>(() => new Set());
  const criteria = (requirementSet?.items ?? []).filter(
    (item) => item.status === "active",
  );
  const pending = createTask.isPending || link.isPending;
  const canCreate = !pending && title.trim().length > 0;

  const handleCreate = async () => {
    if (!canCreate) return;
    try {
      const created = (await createTask.mutateAsync({
        title: title.trim(),
        description: "",
        projectId,
        status: "to-do",
        priority: "medium",
      })) as { id: string };
      await link.mutateAsync({
        projectId,
        taskId: created.id,
        body: {
          requirementKeys: [...keys].sort(),
          designFeatures: hasDesign ? [feature] : [],
        },
      });
      toast.success(t("agentLayer:spec.taskCreated"));
      onOpenChange(false);
    } catch (cause) {
      toast.error(t("agentLayer:spec.taskCreateFailed"), {
        description: cause instanceof Error ? cause.message : undefined,
      });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPopup className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("agentLayer:spec.newTask")}</DialogTitle>
          <DialogDescription>
            {t("agentLayer:spec.featureTasksHint")}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="feature-task-title">
              {t("agentLayer:spec.taskTitle")}
            </Label>
            <Input
              id="feature-task-title"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              autoFocus
              data-testid="feature-task-title"
            />
          </div>
          {criteria.length > 0 ? (
            <div className="space-y-1">
              <p className="text-xs font-medium text-foreground/70">
                {t("agentLayer:spec.taskCriteria")}
              </p>
              <div
                className="max-h-64 space-y-1 overflow-y-auto"
                data-testid="feature-task-criteria"
              >
                {criteria.map((item) => (
                  <div
                    key={item.id}
                    className="flex items-start gap-2 rounded-md px-1 py-0.5 text-xs hover:bg-accent/50"
                  >
                    <Checkbox
                      aria-label={item.key}
                      checked={keys.has(item.key)}
                      onCheckedChange={(checked) =>
                        setKeys((current) => {
                          const next = new Set(current);
                          if (checked) next.add(item.key);
                          else next.delete(item.key);
                          return next;
                        })
                      }
                    />
                    <span className="font-mono">{item.key}</span>
                    <span className="text-muted-foreground">{item.text}</span>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {t("agentLayer:spec.cancel")}
          </Button>
          <Button
            onClick={handleCreate}
            disabled={!canCreate}
            data-testid="create-feature-task"
          >
            {t("agentLayer:spec.save")}
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
