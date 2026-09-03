import { Link } from "@tanstack/react-router";
import {
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  FileText,
  NotebookPen,
  PenLine,
} from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { AgentTreeNode } from "@/fetchers/agent-layer/get-agent-tree";
import { useAgentEntries } from "@/hooks/queries/agent-layer/use-agent-entries";
import { cn } from "@/lib/cn";
import { downloadAgentArtifact } from "@/lib/download-agent-artifact";
import { getStatusLabel } from "@/lib/i18n/domain";
import { toast } from "@/lib/toast";
import { AgentAuthorBadge } from "./agent-author-badge";
import {
  AgentLayerEmpty,
  AgentLayerErrorState,
  AgentLayerSkeleton,
} from "./agent-layer-state";
import {
  ARTIFACT_KIND_ICONS,
  artifactKindOf,
  formatBytes,
  isInlineViewable,
} from "./artifact-kind";
import { BranchChip, topModel, UsageChip } from "./chips";
import { EntryComposer } from "./entry-composer";
import { EntryRow } from "./entry-row";

type TreeContext = {
  workspaceId: string;
  projectId: string;
  projectSlug?: string;
  /** task:update, decided by the route: it gates the inline note composer. */
  canWrite: boolean;
  onOpenEntry: (entryId: string) => void;
};

type TaskTimelineTreeProps = Omit<TreeContext, "onOpenEntry" | "canWrite"> & {
  nodes: AgentTreeNode[];
  canWrite?: boolean;
  onOpenEntry?: (entryId: string) => void;
};

/**
 * Timeline tab: roots stacked vertically, newest first, children indented
 * under their parent on a left rail. Documents and attachments hang as leaves;
 * each node can unfold its own ledger entries. Done nodes fold into one
 * "Done (N)" toggle per sibling group (§6.1).
 */
export function TaskTimelineTree({
  nodes,
  workspaceId,
  projectId,
  projectSlug,
  canWrite = false,
  onOpenEntry,
}: TaskTimelineTreeProps) {
  const context: TreeContext = {
    workspaceId,
    projectId,
    projectSlug,
    canWrite,
    onOpenEntry: onOpenEntry ?? (() => {}),
  };
  const [showDone, setShowDone] = useState(false);
  // The API returns roots oldest first; the timeline reads top-down from now.
  const ordered = useMemo(() => [...nodes].reverse(), [nodes]);
  const doneCount = ordered.filter((node) => node.done).length;
  const visible = showDone ? ordered : ordered.filter((node) => !node.done);

  return (
    <ol
      data-testid="task-timeline-tree"
      className="relative ml-1.5 space-y-4 border-l-2 border-border pl-5"
    >
      {visible.map((node) => (
        <li key={node.id} data-testid="tree-root" className="relative">
          <span
            aria-hidden="true"
            className={cn(
              "absolute -left-[calc(1.25rem+5px)] top-3.5 size-2 rounded-full border-2 border-background",
              node.done ? "bg-muted-foreground/60" : "bg-primary",
            )}
          />
          <NodeCard node={node} context={context} />
          <ChildList nodes={node.children} context={context} />
        </li>
      ))}
      {doneCount > 0 ? (
        <li className="relative">
          <DoneToggle
            count={doneCount}
            expanded={showDone}
            onToggle={() => setShowDone((current) => !current)}
          />
        </li>
      ) : null}
    </ol>
  );
}

function ChildList({
  nodes,
  context,
}: {
  nodes: AgentTreeNode[];
  context: TreeContext;
}) {
  const [showDone, setShowDone] = useState(false);
  if (nodes.length === 0) return null;

  const doneCount = nodes.filter((node) => node.done).length;
  const visible = showDone ? nodes : nodes.filter((node) => !node.done);

  return (
    <ul
      data-testid="tree-children"
      className="ml-3 mt-2 space-y-2 border-l border-border pl-3 sm:ml-4"
    >
      {visible.map((node) => (
        <li
          key={node.id}
          data-testid="tree-child"
          className="relative before:absolute before:-left-3 before:top-4 before:h-px before:w-3 before:bg-border"
        >
          <NodeCard node={node} context={context} />
          <ChildList nodes={node.children} context={context} />
        </li>
      ))}
      {doneCount > 0 ? (
        <li className="relative before:absolute before:-left-3 before:top-3 before:h-px before:w-3 before:bg-border">
          <DoneToggle
            count={doneCount}
            expanded={showDone}
            onToggle={() => setShowDone((current) => !current)}
          />
        </li>
      ) : null}
    </ul>
  );
}

function DoneToggle({
  count,
  expanded,
  onToggle,
  className,
}: {
  count: number;
  expanded: boolean;
  onToggle: () => void;
  className?: string;
}) {
  const { t } = useTranslation();
  return (
    <button
      type="button"
      data-testid="done-toggle"
      aria-expanded={expanded}
      onClick={onToggle}
      className={cn(
        "flex items-center gap-1.5 rounded-md border border-dashed border-border px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground",
        className,
      )}
    >
      {expanded ? (
        <ChevronDown className="size-3.5" />
      ) : (
        <ChevronRight className="size-3.5" />
      )}
      <CheckCircle2 className="size-3.5" />
      {t("agentLayer:timeline.doneCollapsed", { value: count })}
      <span className="sr-only">
        {expanded
          ? t("agentLayer:timeline.hideDone")
          : t("agentLayer:timeline.showDone")}
      </span>
    </button>
  );
}

function NodeCard({
  node,
  context,
}: {
  node: AgentTreeNode;
  context: TreeContext;
}) {
  const { t } = useTranslation();
  const { workspaceId, projectId, projectSlug } = context;
  const [showEntries, setShowEntries] = useState(false);
  const usage = topModel(node.usage.byModel);
  const key = `${projectSlug ? `${projectSlug}-` : "#"}${node.number ?? "?"}`;

  return (
    <div
      data-testid="tree-node"
      data-done={node.done ? "true" : "false"}
      className={cn(
        "max-w-3xl rounded-lg border border-border/80 bg-background p-2.5 shadow-xs/5",
        node.done && "opacity-70",
      )}
    >
      <div className="flex items-start gap-2">
        <Link
          to="/dashboard/workspace/$workspaceId/project/$projectId/task/$taskId"
          params={{ workspaceId, projectId, taskId: node.id }}
          className="min-w-0 flex-1 text-sm font-medium leading-snug text-foreground underline-offset-2 hover:underline"
        >
          <span className="mr-1.5 font-mono text-xs text-muted-foreground">
            {key}
          </span>
          {node.title}
        </Link>
        <Badge variant={node.done ? "success" : "secondary"} size="sm">
          {getStatusLabel(node.status)}
        </Badge>
      </div>

      {(node.branches.length > 0 || node.usage.entryCount > 0) && (
        <div className="mt-2 flex flex-wrap gap-1">
          {node.branches.map((branch) => (
            <BranchChip
              key={`${branch.repo ?? ""}:${branch.branch}`}
              repo={branch.repo}
              branch={branch.branch}
            />
          ))}
          {node.usage.entryCount > 0 ? (
            <UsageChip
              model={usage?.model}
              totalTokens={node.usage.totalTokens}
            />
          ) : null}
        </div>
      )}

      {node.documents.length > 0 ? (
        <ul
          className="mt-2 space-y-0.5"
          aria-label={t("agentLayer:timeline.documents")}
        >
          {node.documents.map((document) => (
            <li
              key={document.id}
              data-testid="tree-document"
              className="flex min-w-0 items-center gap-1.5"
            >
              <Link
                to="/dashboard/workspace/$workspaceId/project/$projectId/docs/$slug"
                params={{ workspaceId, projectId, slug: document.slug }}
                className="flex min-w-0 items-center gap-1.5 truncate text-xs text-foreground/80 underline-offset-2 hover:underline"
              >
                <FileText className="size-3 shrink-0 text-muted-foreground" />
                <span className="truncate">{document.title}</span>
              </Link>
              {/* Only for agent leaves: the tree has no member directory, so a
                  human author would render as a raw user id. */}
              {document.actor ? (
                <AgentAuthorBadge actor={document.actor} />
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}

      {node.attachments.length > 0 ? (
        <ul
          className="mt-1 space-y-0.5"
          aria-label={t("agentLayer:timeline.attachments")}
        >
          {node.attachments.map((attachment) => (
            <AttachmentLeaf
              key={attachment.id}
              attachment={attachment}
              context={context}
            />
          ))}
        </ul>
      ) : null}

      <button
        type="button"
        data-testid="entries-toggle"
        aria-expanded={showEntries}
        onClick={() => setShowEntries((current) => !current)}
        className="mt-2 flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
      >
        {showEntries ? (
          <ChevronDown className="size-3.5" />
        ) : (
          <ChevronRight className="size-3.5" />
        )}
        <NotebookPen className="size-3.5" />
        {t("agentLayer:timeline.entriesToggle", {
          value: node.usage.entryCount,
        })}
      </button>

      {showEntries ? (
        <TaskEntries
          taskId={node.id}
          projectId={projectId}
          projectSlug={projectSlug}
          canWrite={context.canWrite}
          // Branches arrive newest first, so the head is the latest one.
          latestBranch={node.branches[0] ?? null}
          onOpenEntry={context.onOpenEntry}
        />
      ) : null}
    </div>
  );
}

/**
 * One task's ledger, newest first, 20 per page (§6: replaces the notes tab).
 * People write into the same list through the inline composer (KAN-12).
 */
function TaskEntries({
  taskId,
  projectId,
  projectSlug,
  canWrite,
  latestBranch,
  onOpenEntry,
}: {
  taskId: string;
  projectId: string;
  projectSlug?: string;
  canWrite: boolean;
  latestBranch: AgentTreeNode["branches"][number] | null;
  onOpenEntry: (entryId: string) => void;
}) {
  const { t } = useTranslation();
  const [composing, setComposing] = useState(false);
  const query = useAgentEntries(projectId, undefined, taskId);
  const entries = query.data?.pages.flatMap((page) => page.entries) ?? [];

  return (
    <div className="mt-2 space-y-2" data-testid="task-entries">
      {canWrite && !composing ? (
        <Button
          type="button"
          variant="outline"
          size="xs"
          data-testid="compose-entry"
          onClick={() => setComposing(true)}
        >
          <PenLine />
          {t("agentLayer:composer.open")}
        </Button>
      ) : null}
      {canWrite && composing ? (
        <EntryComposer
          projectId={projectId}
          taskId={taskId}
          defaultBranch={latestBranch}
          onClose={() => setComposing(false)}
        />
      ) : null}
      {query.isPending ? (
        <AgentLayerSkeleton rows={2} />
      ) : query.isError ? (
        <AgentLayerErrorState
          error={query.error}
          onRetry={() => query.refetch()}
        />
      ) : entries.length === 0 ? (
        <AgentLayerEmpty title={t("agentLayer:timeline.entriesEmpty")} />
      ) : (
        <ol className="divide-y divide-border/70 rounded-md border border-border/80 bg-muted/20">
          {entries.map((entry) => (
            <EntryRow
              key={entry.id}
              entry={entry}
              projectSlug={projectSlug}
              showTask={false}
              onOpen={() => onOpenEntry(entry.id)}
            />
          ))}
        </ol>
      )}
      {query.hasNextPage ? (
        <div className="mt-2 flex justify-center">
          <Button
            variant="outline"
            size="xs"
            disabled={query.isFetchingNextPage}
            onClick={() => query.fetchNextPage()}
          >
            {t("agentLayer:common.loadMore")}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

/**
 * §6 click behaviour: html/pdf/md/txt/json open in the sandboxed viewer,
 * zip downloads. Either way the bytes come straight from storage.
 */
function AttachmentLeaf({
  attachment,
  context,
}: {
  attachment: AgentTreeNode["attachments"][number];
  context: TreeContext;
}) {
  const { t } = useTranslation();
  const { workspaceId, projectId } = context;
  const Icon = ARTIFACT_KIND_ICONS[artifactKindOf(attachment.contentType)];
  const className =
    "flex min-w-0 items-center gap-1.5 text-xs text-foreground/80 underline-offset-2 hover:underline";
  const label = (
    <>
      <Icon className="size-3 shrink-0 text-muted-foreground" />
      <span className="truncate">{attachment.name}</span>
      <span className="shrink-0 tabular-nums text-muted-foreground">
        {formatBytes(attachment.size)}
      </span>
    </>
  );

  const handleDownload = async () => {
    try {
      await downloadAgentArtifact(projectId, attachment.id);
    } catch (cause) {
      toast.error(t("agentLayer:docs.downloadFailed"), {
        description: cause instanceof Error ? cause.message : undefined,
      });
    }
  };

  return (
    <li
      data-testid="tree-attachment"
      data-kind={artifactKindOf(attachment.contentType)}
      title={attachment.contentType}
      className="flex min-w-0 items-center gap-1.5"
    >
      {isInlineViewable(attachment.contentType) ? (
        <Link
          to="/dashboard/workspace/$workspaceId/project/$projectId/docs/artifact/$artifactId"
          params={{ workspaceId, projectId, artifactId: attachment.id }}
          className={className}
        >
          {label}
        </Link>
      ) : (
        <button
          type="button"
          onClick={handleDownload}
          className={cn(className, "w-full text-left")}
          aria-label={`${t("agentLayer:docs.download")}: ${attachment.name}`}
        >
          {label}
        </button>
      )}
      {/* See the document leaf: agent uploads only. */}
      {attachment.actor ? <AgentAuthorBadge actor={attachment.actor} /> : null}
    </li>
  );
}
