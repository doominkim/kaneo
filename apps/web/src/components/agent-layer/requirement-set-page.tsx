import { Link } from "@tanstack/react-router";
import { ArrowLeft, Check, Pencil, Plus } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { MarkdownRenderer } from "@/components/public-project/markdown-renderer";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import type {
  AgentRequirementItem,
  AgentRequirementItemInput,
  AgentRequirementSet,
} from "@/fetchers/agent-layer/agent-requirements";
import {
  useApproveAgentRequirementSet,
  usePutAgentRequirementSet,
} from "@/hooks/mutations/agent-layer/use-agent-spec";
import { formatDateTime, formatRelativeTime } from "@/lib/format";
import { toast } from "@/lib/toast";
import { AgentAuthorBadge } from "./agent-author-badge";
import { RequirementKeyChip, SpecStatusBadge } from "./spec-badges";

type ItemDraft = AgentRequirementItemInput & { draftId: string };

type RequirementSetPageProps = {
  set: AgentRequirementSet;
  workspaceId: string;
  projectId: string;
  projectSlug?: string;
  authorName?: string | null;
  canEdit: boolean;
  startInEdit?: boolean;
};

function toDrafts(items: AgentRequirementItem[]): ItemDraft[] {
  return items.map((item) => ({
    draftId: item.id,
    key: item.key,
    text: item.text,
    layer: item.layer,
    status: item.status as ItemDraft["status"],
  }));
}

/**
 * The 요구사항 tab's detail: the set's body, then its items as rows. Each row
 * shows where the requirement went (design, tasks) and which tests cite it
 * (REQ-SPEC-TABS-11), so "is this covered?" is answered without leaving the
 * page. Editing sends the rows back as a partial upsert; nothing is deleted.
 */
export function RequirementSetPage({
  set,
  workspaceId,
  projectId,
  projectSlug,
  authorName,
  canEdit,
  startInEdit = false,
}: RequirementSetPageProps) {
  const { t } = useTranslation();
  const [isEditing, setIsEditing] = useState(startInEdit && canEdit);
  const [title, setTitle] = useState(set.title);
  const [body, setBody] = useState(set.body);
  const [drafts, setDrafts] = useState<ItemDraft[]>(() => toDrafts(set.items));
  const put = usePutAgentRequirementSet();
  const approve = useApproveAgentRequirementSet();

  useEffect(() => {
    if (!isEditing) {
      setTitle(set.title);
      setBody(set.body);
      setDrafts(toDrafts(set.items));
    }
  }, [set.title, set.body, set.items, isEditing]);

  const trimmedTitle = title.trim();
  const canSave =
    !put.isPending &&
    trimmedTitle.length > 0 &&
    drafts.every((draft) => draft.text.trim().length > 0);

  const handleSave = async () => {
    if (!canSave) return;
    try {
      await put.mutateAsync({
        projectId,
        feature: set.feature,
        body: {
          title: trimmedTitle,
          body,
          sourceSlug: set.sourceSlug,
          items: drafts.map(({ draftId: _draftId, ...draft }) => ({
            ...draft,
            text: draft.text.trim(),
            layer: draft.layer?.trim() ? draft.layer.trim() : null,
          })),
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

  const handleApprove = async () => {
    try {
      await approve.mutateAsync({ projectId, feature: set.feature });
      toast.success(t("agentLayer:spec.approved"));
    } catch (cause) {
      toast.error(t("agentLayer:spec.approveFailed"), {
        description: cause instanceof Error ? cause.message : undefined,
      });
    }
  };

  const updateDraft = (draftId: string, patch: Partial<ItemDraft>) =>
    setDrafts((current) =>
      current.map((draft) =>
        draft.draftId === draftId ? { ...draft, ...patch } : draft,
      ),
    );

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b border-border/80 px-3 py-2.5 sm:px-4">
        <Link
          to="/dashboard/workspace/$workspaceId/project/$projectId/requirements"
          params={{ workspaceId, projectId }}
          className="flex items-center gap-1 text-xs text-muted-foreground underline-offset-2 hover:underline"
        >
          <ArrowLeft className="size-3.5" />
          {t("agentLayer:spec.backToRequirements")}
        </Link>
        <span className="font-mono text-xs text-muted-foreground">
          {set.feature}
        </span>
        <SpecStatusBadge status={set.status} />
        {set.approvedAt ? (
          <span
            className="text-xs text-muted-foreground"
            title={formatDateTime(set.approvedAt)}
          >
            {t("agentLayer:spec.approvedAt", {
              when: formatRelativeTime(set.approvedAt),
            })}
          </span>
        ) : null}
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
                data-testid="save-set"
              >
                {t("agentLayer:spec.save")}
              </Button>
            </>
          ) : (
            <>
              {canEdit && set.status !== "approved" ? (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={approve.isPending}
                  onClick={handleApprove}
                  data-testid="approve-set"
                >
                  <Check />
                  {t("agentLayer:spec.approve")}
                </Button>
              ) : null}
              {canEdit ? (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setIsEditing(true)}
                  data-testid="edit-set"
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
          <div className="space-y-1">
            {isEditing ? (
              <Input
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                className="text-base font-semibold"
                data-testid="set-title"
              />
            ) : (
              <h1 className="text-base font-semibold text-foreground">
                {set.title}
              </h1>
            )}
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <AgentAuthorBadge actor={set.actor} humanName={authorName} />
              <span title={formatDateTime(set.updatedAt)}>
                {formatRelativeTime(set.updatedAt)}
              </span>
              {canEdit ? (
                <span>{t("agentLayer:spec.approvedHint")}</span>
              ) : null}
            </div>
          </div>

          <section className="space-y-1.5">
            <h2 className="text-xs font-medium text-foreground/70">
              {t("agentLayer:spec.body")}
            </h2>
            {isEditing ? (
              <>
                <Textarea
                  value={body}
                  onChange={(event) => setBody(event.target.value)}
                  rows={8}
                  className="font-mono text-xs"
                  data-testid="set-body"
                />
                <p className="text-xs text-muted-foreground">
                  {t("agentLayer:spec.bodyHint")}
                </p>
              </>
            ) : set.body.trim() ? (
              <div className="prose prose-sm max-w-none dark:prose-invert">
                <MarkdownRenderer content={set.body} />
              </div>
            ) : null}
          </section>

          <section className="space-y-2">
            <div className="flex items-center justify-between">
              <h2 className="text-xs font-medium text-foreground/70">
                {t("agentLayer:spec.items")} ({set.items.length})
              </h2>
              {isEditing ? (
                <Button
                  size="xs"
                  variant="outline"
                  onClick={() =>
                    setDrafts((current) => [
                      ...current,
                      {
                        draftId: `new-${current.length}-${Date.now()}`,
                        text: "",
                        layer: null,
                        status: "active",
                      },
                    ])
                  }
                  data-testid="add-item"
                >
                  <Plus />
                  {t("agentLayer:spec.addItem")}
                </Button>
              ) : null}
            </div>
            <Table data-testid="requirement-items">
              <TableHeader>
                <TableRow>
                  <TableHead className="w-44">
                    {t("agentLayer:spec.columnKey")}
                  </TableHead>
                  <TableHead>{t("agentLayer:spec.columnText")}</TableHead>
                  <TableHead className="w-20">
                    {t("agentLayer:spec.columnLayer")}
                  </TableHead>
                  <TableHead className="w-24">
                    {t("agentLayer:spec.columnStatus")}
                  </TableHead>
                  {isEditing ? null : (
                    <>
                      <TableHead className="w-24">
                        {t("agentLayer:spec.columnCoverage")}
                      </TableHead>
                      <TableHead className="w-28">
                        {t("agentLayer:spec.columnDesigns")}
                      </TableHead>
                      <TableHead className="w-28">
                        {t("agentLayer:spec.columnTasks")}
                      </TableHead>
                    </>
                  )}
                </TableRow>
              </TableHeader>
              <TableBody>
                {isEditing
                  ? drafts.map((draft) => (
                      <TableRow key={draft.draftId} data-testid="item-row">
                        <TableCell className="font-mono text-xs">
                          {draft.key ?? (
                            <span className="text-muted-foreground">
                              {t("agentLayer:spec.itemNoKey")}
                            </span>
                          )}
                        </TableCell>
                        <TableCell>
                          <Textarea
                            value={draft.text}
                            onChange={(event) =>
                              updateDraft(draft.draftId, {
                                text: event.target.value,
                              })
                            }
                            rows={2}
                            className="text-xs"
                            placeholder={t("agentLayer:spec.itemText")}
                            data-testid="item-text"
                          />
                        </TableCell>
                        <TableCell>
                          <Input
                            value={draft.layer ?? ""}
                            onChange={(event) =>
                              updateDraft(draft.draftId, {
                                layer: event.target.value,
                              })
                            }
                            className="h-7 text-xs"
                            placeholder="api"
                          />
                        </TableCell>
                        <TableCell>
                          <select
                            value={draft.status ?? "active"}
                            onChange={(event) =>
                              updateDraft(draft.draftId, {
                                status: event.target
                                  .value as ItemDraft["status"],
                              })
                            }
                            className="h-7 rounded-md border border-input bg-background px-1 text-xs"
                            data-testid="item-status"
                          >
                            <option value="active">
                              {t("agentLayer:spec.itemActive")}
                            </option>
                            <option value="deferred">
                              {t("agentLayer:spec.itemDeferred")}
                            </option>
                            <option value="dropped">
                              {t("agentLayer:spec.itemDropped")}
                            </option>
                          </select>
                        </TableCell>
                      </TableRow>
                    ))
                  : set.items.map((item) => (
                      <TableRow
                        key={item.id}
                        data-testid="item-row"
                        className={
                          item.status === "dropped"
                            ? "text-muted-foreground line-through"
                            : undefined
                        }
                      >
                        <TableCell>
                          <RequirementKeyChip
                            requirementKey={item.key}
                            muted={item.status !== "active"}
                          />
                        </TableCell>
                        <TableCell className="whitespace-pre-wrap text-xs">
                          {item.text}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {item.layer ?? ""}
                        </TableCell>
                        <TableCell className="text-xs">
                          {t(
                            `agentLayer:spec.item${item.status.charAt(0).toUpperCase()}${item.status.slice(1)}`,
                          )}
                        </TableCell>
                        <TableCell
                          className="text-xs"
                          data-testid="item-coverage"
                        >
                          {item.coverage.length > 0 ? (
                            <span
                              className="text-success-foreground"
                              title={item.coverage
                                .map((c) => `${c.repo}: ${c.testPath}`)
                                .join("\n")}
                            >
                              {t("agentLayer:spec.covered", {
                                count: item.coverage.length,
                              })}
                            </span>
                          ) : (
                            <span className="text-muted-foreground">
                              {t("agentLayer:spec.notCovered")}
                            </span>
                          )}
                        </TableCell>
                        <TableCell className="text-xs">
                          {item.designs.map((design) => (
                            <Link
                              key={design.id}
                              to="/dashboard/workspace/$workspaceId/project/$projectId/design/$feature"
                              params={{
                                workspaceId,
                                projectId,
                                feature: design.feature,
                              }}
                              className="font-mono underline-offset-2 hover:underline"
                            >
                              {design.feature}
                            </Link>
                          ))}
                        </TableCell>
                        <TableCell className="text-xs">
                          <div className="flex flex-wrap gap-1">
                            {item.tasks.map((task) => (
                              <Link
                                key={task.id}
                                to="/dashboard/workspace/$workspaceId/project/$projectId/task/$taskId"
                                params={{
                                  workspaceId,
                                  projectId,
                                  taskId: task.id,
                                }}
                                className="underline-offset-2 hover:underline"
                                title={task.title}
                              >
                                {projectSlug && task.number
                                  ? `${projectSlug}-${task.number}`
                                  : task.title}
                              </Link>
                            ))}
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
              </TableBody>
            </Table>
          </section>
        </div>
      </div>
    </div>
  );
}
