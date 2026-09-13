import { Link } from "@tanstack/react-router";
import { Check, Link2 } from "lucide-react";
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
import { featureOfKey } from "@/fetchers/agent-layer/agent-requirements";
import {
  useAcknowledgeAgentTaskLinks,
  usePutAgentTaskLinks,
} from "@/hooks/mutations/agent-layer/use-agent-spec";
import { useAgentDesigns } from "@/hooks/queries/agent-layer/use-agent-designs";
import {
  useAgentRequirementSet,
  useAgentRequirementSets,
} from "@/hooks/queries/agent-layer/use-agent-requirements";
import {
  useAgentTaskLinkBadges,
  useAgentTaskLinks,
} from "@/hooks/queries/agent-layer/use-agent-task-links";
import { featuresOfBadge } from "@/lib/feature-filter";
import { toast } from "@/lib/toast";
import { RequirementKeyChip, StaleBadge, StaleCauses } from "./spec-badges";

/** Board card: the keys a task implements and a stale mark (REQ-SPEC-TABS-13). One query per project. */
export function TaskSpecBadges({
  projectId,
  taskId,
}: {
  projectId: string;
  taskId: string;
}) {
  const badges = useAgentTaskLinkBadges(projectId);
  const badge = badges.data?.get(taskId);
  if (!badge) return null;
  // Feature name and count instead of every key (REQ-FEATURE-HUB-11): the
  // card answers "which feature, how much, is it stale" and nothing more.
  return (
    <div
      className="mb-2 flex flex-wrap items-center gap-1"
      data-testid="task-spec-badges"
    >
      {[...featuresOfBadge(badge)].map(([feature, count]) => (
        <span
          key={feature}
          className="rounded border border-border/70 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground"
          data-testid="feature-badge"
        >
          {feature}
          {count > 0 ? ` · REQ ${count}` : ""}
        </span>
      ))}
      <StaleBadge stale={badge.stale} />
    </div>
  );
}

type TaskSpecLinksProps = {
  workspaceId: string;
  projectId: string;
  taskId: string;
  canEdit: boolean;
};

/**
 * Task detail sidebar: the requirements and design this task derives from,
 * why it is stale, and the human-only acknowledge (REQ-SPEC-TABS-10, 13).
 */
export function TaskSpecLinks({
  workspaceId,
  projectId,
  taskId,
  canEdit,
}: TaskSpecLinksProps) {
  const { t } = useTranslation();
  const links = useAgentTaskLinks(projectId, taskId);
  const acknowledge = useAcknowledgeAgentTaskLinks();
  const [isEditOpen, setIsEditOpen] = useState(false);

  const handleAcknowledge = async () => {
    try {
      await acknowledge.mutateAsync({ projectId, taskId });
      toast.success(t("agentLayer:spec.acknowledged"));
    } catch (cause) {
      toast.error(t("agentLayer:spec.acknowledgeFailed"), {
        description: cause instanceof Error ? cause.message : undefined,
      });
    }
  };

  const data = links.data;
  const isEmpty =
    !data || (data.requirements.length === 0 && data.designs.length === 0);

  return (
    <div className="flex flex-col gap-1" data-testid="task-spec-links">
      <div className="flex items-center justify-between px-2">
        <span className="text-xs font-medium text-foreground/70">
          {t("agentLayer:spec.taskLinksTitle")}
        </span>
        {canEdit ? (
          <Button
            variant="ghost"
            size="sm"
            className="h-5 gap-1 px-1 text-[10px]"
            onClick={() => setIsEditOpen(true)}
            data-testid="edit-task-links"
          >
            <Link2 className="size-3" />
            {t("agentLayer:spec.taskLinksEdit")}
          </Button>
        ) : null}
      </div>
      <div className="space-y-1.5 px-2">
        {isEmpty ? (
          <p className="text-xs text-muted-foreground">
            {t("agentLayer:spec.taskLinksEmpty")}
          </p>
        ) : (
          <>
            <div
              className="flex flex-wrap gap-1"
              data-testid="task-feature-links"
            >
              {[
                ...new Set([
                  ...data.requirements.map((r) => r.feature),
                  ...data.designs.map((d) => d.feature),
                ]),
              ].map((feature) => (
                <span key={feature} data-testid="task-feature-link">
                  <Link
                    to="/dashboard/workspace/$workspaceId/project/$projectId/feature/$feature"
                    params={{ workspaceId, projectId, feature }}
                    search={{ tab: "tasks" }}
                    className="rounded border border-border/70 px-1.5 py-0.5 font-mono text-[10px] underline-offset-2 hover:underline"
                  >
                    {feature}
                  </Link>
                </span>
              ))}
            </div>
            <div className="flex flex-wrap gap-1">
              {data.requirements.map((requirement) => (
                <Link
                  key={requirement.key}
                  to="/dashboard/workspace/$workspaceId/project/$projectId/feature/$feature"
                  params={{
                    workspaceId,
                    projectId,
                    feature: requirement.feature,
                  }}
                  search={{ tab: "requirements" }}
                  title={requirement.text}
                >
                  <RequirementKeyChip
                    requirementKey={requirement.key}
                    className="text-[10px]"
                  />
                </Link>
              ))}
              {data.designs.map((design) => (
                <Link
                  key={design.designId}
                  to="/dashboard/workspace/$workspaceId/project/$projectId/feature/$feature"
                  params={{ workspaceId, projectId, feature: design.feature }}
                  search={{ tab: "design" }}
                  className="rounded border border-border/70 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground"
                  title={design.title}
                >
                  design:{design.feature}
                </Link>
              ))}
            </div>
            {data.stale.stale ? (
              <>
                <StaleCauses stale={data.stale} />
                {canEdit ? (
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-6 text-xs"
                    disabled={acknowledge.isPending}
                    onClick={handleAcknowledge}
                    title={t("agentLayer:spec.acknowledgeHint")}
                    data-testid="acknowledge-task"
                  >
                    <Check className="size-3" />
                    {t("agentLayer:spec.acknowledge")}
                  </Button>
                ) : null}
              </>
            ) : null}
          </>
        )}
      </div>
      {canEdit && isEditOpen ? (
        <TaskLinksDialog
          open={isEditOpen}
          onOpenChange={setIsEditOpen}
          projectId={projectId}
          taskId={taskId}
          initialKeys={data?.requirements.map((r) => r.key) ?? []}
          initialFeatures={data?.designs.map((d) => d.feature) ?? []}
        />
      ) : null}
    </div>
  );
}

type TaskLinksDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  taskId: string;
  initialKeys: string[];
  initialFeatures: string[];
};

/** Pick the feature, then the items and whether the design is implemented. */
function TaskLinksDialog({
  open,
  onOpenChange,
  projectId,
  taskId,
  initialKeys,
  initialFeatures,
}: TaskLinksDialogProps) {
  const { t } = useTranslation();
  const sets = useAgentRequirementSets(projectId);
  const designs = useAgentDesigns(projectId);
  const put = usePutAgentTaskLinks();
  const [feature, setFeature] = useState<string>(
    initialKeys[0] ? featureOfKey(initialKeys[0]) : (initialFeatures[0] ?? ""),
  );
  const [keys, setKeys] = useState<Set<string>>(() => new Set(initialKeys));
  const [features, setFeatures] = useState<Set<string>>(
    () => new Set(initialFeatures),
  );
  const set = useAgentRequirementSet(projectId, feature);

  const featureOptions = [
    ...new Set([
      ...(sets.data?.sets.map((s) => s.feature) ?? []),
      ...(designs.data?.designs.map((d) => d.feature) ?? []),
    ]),
  ].sort();
  const hasDesign =
    designs.data?.designs.some((d) => d.feature === feature) ?? false;

  const handleSave = async () => {
    try {
      await put.mutateAsync({
        projectId,
        taskId,
        body: {
          requirementKeys: [...keys].sort(),
          designFeatures: [...features].sort(),
        },
      });
      toast.success(t("agentLayer:spec.saved"));
      onOpenChange(false);
    } catch (cause) {
      toast.error(t("agentLayer:spec.saveFailed"), {
        description: cause instanceof Error ? cause.message : undefined,
      });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPopup className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("agentLayer:spec.taskLinksDialogTitle")}</DialogTitle>
          <DialogDescription>
            {t("agentLayer:spec.taskLinksDialogHint")}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <select
            value={feature}
            onChange={(event) => setFeature(event.target.value)}
            className="h-8 w-full rounded-md border border-input bg-background px-2 text-xs"
            data-testid="feature-select"
          >
            <option value="">{t("agentLayer:spec.feature")}</option>
            {featureOptions.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
          {feature && hasDesign ? (
            <div className="flex items-center gap-2 text-xs">
              <Checkbox
                aria-label={t("agentLayer:spec.taskLinksDesign", { feature })}
                checked={features.has(feature)}
                onCheckedChange={(checked) =>
                  setFeatures((current) => {
                    const next = new Set(current);
                    if (checked) next.add(feature);
                    else next.delete(feature);
                    return next;
                  })
                }
              />
              {t("agentLayer:spec.taskLinksDesign", { feature })}
            </div>
          ) : null}
          <div
            className="max-h-72 space-y-1 overflow-y-auto"
            data-testid="task-requirement-picker"
          >
            {set.data?.items
              .filter((item) => item.status !== "dropped")
              .map((item) => (
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
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {t("agentLayer:spec.cancel")}
          </Button>
          <Button
            onClick={handleSave}
            disabled={put.isPending}
            data-testid="save-task-links"
          >
            {t("agentLayer:spec.save")}
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
