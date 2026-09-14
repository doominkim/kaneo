import { Link } from "@tanstack/react-router";
import { ArrowLeft, Pencil } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { MarkdownRenderer } from "@/components/public-project/markdown-renderer";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { AgentDesign } from "@/fetchers/agent-layer/agent-designs";
import type { AgentRequirementSet } from "@/fetchers/agent-layer/agent-requirements";
import {
  usePutAgentDesign,
  useReviewAgentSpec,
} from "@/hooks/mutations/agent-layer/use-agent-spec";
import { useReviewOnOpen } from "@/hooks/use-review-on-open";
import { toast } from "@/lib/toast";
import { criterionNumbers } from "./requirement-doc";
import {
  RequirementKeyChip,
  StaleBadge,
  StaleCauses,
  UnreviewedBadge,
} from "./spec-badges";
import { SpecLifecycleActions } from "./spec-lifecycle";

type DesignPageProps = {
  design: AgentDesign;
  /** The requirement set with the same feature, for the coverage checklist; null while loading or absent. */
  requirementSet: AgentRequirementSet | null;
  workspaceId: string;
  projectId: string;
  projectSlug?: string;
  canEdit: boolean;
  /** project:update: soft delete. */
  canDelete?: boolean;
  startInEdit?: boolean;
  /** Mounted inside the feature page: the feature header already has the back link. */
  embedded?: boolean;
};

/**
 * The 설계 tab's detail (REQ-SPEC-TABS-12): body, the requirements it covers
 * with a per-key "changed since the design's last revision" mark, the stale verdict with its
 * causes, and the tasks derived from it. Editing replaces the covered keys.
 */
export function DesignPage({
  design,
  requirementSet,
  workspaceId,
  projectId,
  projectSlug,
  canEdit,
  canDelete = false,
  startInEdit = false,
  embedded = false,
}: DesignPageProps) {
  const { t } = useTranslation();
  const [isEditing, setIsEditing] = useState(startInEdit && canEdit);
  const [title, setTitle] = useState(design.title);
  const [body, setBody] = useState(design.body);
  const [keys, setKeys] = useState<Set<string>>(
    () => new Set(design.requirements.map((r) => r.key)),
  );
  const put = usePutAgentDesign();
  const review = useReviewAgentSpec();
  const showUnreviewed = useReviewOnOpen({
    itemId: design.id,
    reviewed: design.reviewed,
    onReview: () =>
      review.mutateAsync({
        kind: "design",
        projectId,
        feature: design.feature,
      }),
  });

  useEffect(() => {
    if (!isEditing) {
      setTitle(design.title);
      setBody(design.body);
      setKeys(new Set(design.requirements.map((r) => r.key)));
    }
  }, [design.title, design.body, design.requirements, isEditing]);

  const trimmedTitle = title.trim();
  const canSave =
    !put.isPending && trimmedTitle.length > 0 && body.trim().length > 0;

  // Criterion references in the body (REQ-FEATURE-HUB-25): `[1.2]` by story
  // number or `[REQ-…-n]` by key. The count of covered-but-unmentioned keys is
  // the useful part: a design that forgot a criterion says so at the top.
  const numbers = requirementSet
    ? criterionNumbers(requirementSet.body)
    : new Map<string, string>();
  const keyByNumber = new Map(
    [...numbers].map(([key, number]) => [number, key]),
  );
  const referenced = new Set<string>();
  const renderedBody = design.body.replace(
    /\[(REQ-[A-Z0-9]+(?:-[A-Z0-9]+)*-\d+|\d+\.\d+)\]/g,
    (_match, token: string) => {
      const key = token.startsWith("REQ-") ? token : keyByNumber.get(token);
      if (key) referenced.add(key);
      return `\`${numbers.get(key ?? "") ?? token}\``;
    },
  );
  const unmentioned = design.requirements
    .map((r) => r.key)
    .filter((key) => !referenced.has(key));

  const handleSave = async () => {
    if (!canSave) return;
    try {
      await put.mutateAsync({
        projectId,
        feature: design.feature,
        body: {
          title: trimmedTitle,
          body,
          sourceSlug: design.sourceSlug,
          requirementKeys: [...keys].sort(),
        },
      });
      toast.success(t("agentLayer:spec.saved"));
      setIsEditing(false);
    } catch (cause) {
      toast.error(t("agentLayer:spec.saveFailed"), {
        description: cause instanceof Error ? cause.message : undefined,
      });
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b border-border/80 px-3 py-2.5 sm:px-4">
        {embedded ? null : (
          <Link
            to="/dashboard/workspace/$workspaceId/project/$projectId/feature"
            params={{ workspaceId, projectId }}
            className="flex items-center gap-1 text-xs text-muted-foreground underline-offset-2 hover:underline"
          >
            <ArrowLeft className="size-3.5" />
            {t("agentLayer:spec.backToFeatures")}
          </Link>
        )}
        <span className="font-mono text-xs text-muted-foreground">
          {design.feature}
        </span>
        {showUnreviewed ? <UnreviewedBadge /> : null}
        <StaleBadge stale={design.stale} />
        <div className="ml-auto flex items-center gap-1.5">
          {isEditing ? (
            <>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setIsEditing(false)}
              >
                {t("agentLayer:spec.cancel")}
              </Button>
              <Button
                size="sm"
                disabled={!canSave}
                onClick={handleSave}
                data-testid="save-design"
              >
                {t("agentLayer:spec.save")}
              </Button>
            </>
          ) : (
            <>
              <SpecLifecycleActions
                target={{ kind: "design", projectId, feature: design.feature }}
                canRevert={canEdit}
                canDelete={canDelete}
              />
              {canEdit ? (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setIsEditing(true)}
                  data-testid="edit-design"
                >
                  <Pencil />
                  {t("agentLayer:spec.edit")}
                </Button>
              ) : null}
            </>
          )}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-5xl space-y-5 px-3 py-4 sm:px-4">
          {isEditing ? (
            <Input
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              className="text-base font-semibold"
              data-testid="design-title"
            />
          ) : (
            <h1 className="text-base font-semibold text-foreground">
              {design.title}
            </h1>
          )}

          <StaleCauses stale={design.stale} />

          {design.requirements.length > 0 ? (
            <div
              className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground"
              data-testid="design-mentions"
            >
              <span>
                {t("agentLayer:spec.docMentioned", {
                  mentioned: design.requirements.length - unmentioned.length,
                  total: design.requirements.length,
                })}
              </span>
              {unmentioned.length > 0 ? (
                <>
                  <span>{t("agentLayer:spec.docUnmentioned")}</span>
                  {unmentioned.map((key) => (
                    <RequirementKeyChip
                      key={key}
                      requirementKey={numbers.get(key) ?? key}
                      muted
                      className="text-[10px]"
                    />
                  ))}
                </>
              ) : null}
            </div>
          ) : null}

          <section className="space-y-1.5">
            <h2 className="text-xs font-medium text-foreground/70">
              {t("agentLayer:spec.requirementsCovered")}
            </h2>
            {isEditing ? (
              requirementSet ? (
                <div className="space-y-1" data-testid="requirement-picker">
                  <p className="text-xs text-muted-foreground">
                    {t("agentLayer:spec.requirementsCoveredHint", {
                      feature: design.feature,
                    })}
                  </p>
                  {requirementSet.items.map((item) => (
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
              ) : (
                <p className="text-xs text-muted-foreground">
                  {t("agentLayer:spec.noRequirementSet")}
                </p>
              )
            ) : (
              <div
                className="flex flex-wrap gap-1.5"
                data-testid="design-requirements"
              >
                {design.requirements.map((requirement) => (
                  <span
                    key={requirement.key}
                    className="inline-flex items-center gap-1"
                  >
                    <Link
                      to="/dashboard/workspace/$workspaceId/project/$projectId/feature/$feature"
                      params={{
                        workspaceId,
                        projectId,
                        feature: design.feature,
                      }}
                      search={{ tab: "requirements" }}
                      title={requirement.text}
                    >
                      <RequirementKeyChip
                        requirementKey={requirement.key}
                        className={
                          requirement.changedSinceRevision
                            ? "border-warning text-warning-foreground"
                            : undefined
                        }
                      />
                    </Link>
                    {requirement.changedSinceRevision ? (
                      <span
                        className="text-[10px] text-warning-foreground"
                        data-testid="changed-since-revision"
                      >
                        {t("agentLayer:spec.changedSinceRevision")}
                      </span>
                    ) : null}
                  </span>
                ))}
              </div>
            )}
          </section>

          <section className="space-y-1.5">
            <h2 className="text-xs font-medium text-foreground/70">
              {t("agentLayer:spec.body")}
            </h2>
            {isEditing ? (
              <Textarea
                value={body}
                onChange={(event) => setBody(event.target.value)}
                rows={16}
                className="font-mono text-xs"
                data-testid="design-body"
              />
            ) : (
              <div className="prose prose-sm max-w-none dark:prose-invert">
                <MarkdownRenderer content={renderedBody} />
              </div>
            )}
          </section>

          <section className="space-y-1.5">
            <h2 className="text-xs font-medium text-foreground/70">
              {t("agentLayer:spec.derivedTasks")}
            </h2>
            {design.tasks.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                {t("agentLayer:spec.noDerivedTasks")}
              </p>
            ) : (
              <ul className="space-y-0.5 text-xs" data-testid="derived-tasks">
                {design.tasks.map((task) => (
                  <li key={task.id}>
                    <Link
                      to="/dashboard/workspace/$workspaceId/project/$projectId/task/$taskId"
                      params={{ workspaceId, projectId, taskId: task.id }}
                      className="underline-offset-2 hover:underline"
                    >
                      {projectSlug && task.number
                        ? `${projectSlug}-${task.number} `
                        : ""}
                      {task.title}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
