import { Link } from "@tanstack/react-router";
import {
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  FileText,
  Paperclip,
} from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Badge } from "@/components/ui/badge";
import type { AgentTreeNode } from "@/fetchers/agent-layer/get-agent-tree";
import { cn } from "@/lib/cn";
import { getStatusLabel } from "@/lib/i18n/domain";
import { BranchChip, topModel, UsageChip } from "./chips";

type TreeContext = {
  workspaceId: string;
  projectId: string;
  projectSlug?: string;
};

type TaskTimelineTreeProps = TreeContext & {
  nodes: AgentTreeNode[];
};

/**
 * DESIGN.md §6 item 2: roots laid out horizontally in time order, children
 * indented below each root, documents and attachments as leaves. Done nodes
 * fold into one "Done (N)" toggle per sibling group (§6.1).
 */
export function TaskTimelineTree({
  nodes,
  workspaceId,
  projectId,
  projectSlug,
}: TaskTimelineTreeProps) {
  const context = { workspaceId, projectId, projectSlug };
  const [showDone, setShowDone] = useState(false);
  const doneCount = nodes.filter((node) => node.done).length;
  const visible = showDone ? nodes : nodes.filter((node) => !node.done);

  return (
    <div
      data-testid="task-timeline-tree"
      className="overflow-x-auto overscroll-x-contain pb-2"
    >
      <div className="relative flex min-w-max items-start gap-6 border-t-2 border-border pt-4">
        {visible.map((node) => (
          <div
            key={node.id}
            data-testid="tree-root"
            className="relative w-72 shrink-0"
          >
            <span
              aria-hidden="true"
              className={cn(
                "absolute -top-[calc(1rem+5px)] left-3 size-2 rounded-full border-2 border-background",
                node.done ? "bg-muted-foreground/60" : "bg-primary",
              )}
            />
            <NodeCard node={node} context={context} />
            <ChildList nodes={node.children} context={context} depth={1} />
          </div>
        ))}
        {doneCount > 0 ? (
          <DoneToggle
            count={doneCount}
            expanded={showDone}
            onToggle={() => setShowDone((current) => !current)}
            className="mt-1 w-40 shrink-0"
          />
        ) : null}
      </div>
    </div>
  );
}

function ChildList({
  nodes,
  context,
  depth,
}: {
  nodes: AgentTreeNode[];
  context: TreeContext;
  depth: number;
}) {
  const [showDone, setShowDone] = useState(false);
  if (nodes.length === 0) return null;

  const doneCount = nodes.filter((node) => node.done).length;
  const visible = showDone ? nodes : nodes.filter((node) => !node.done);

  return (
    <ul
      data-testid="tree-children"
      className="ml-4 mt-2 space-y-2 border-l border-border pl-3"
    >
      {visible.map((node) => (
        <li
          key={node.id}
          data-testid="tree-child"
          className="relative before:absolute before:-left-3 before:top-4 before:h-px before:w-3 before:bg-border"
        >
          <NodeCard node={node} context={context} />
          <ChildList
            nodes={node.children}
            context={context}
            depth={depth + 1}
          />
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
      {t("agentLayer:overview.doneCollapsed", { value: count })}
      <span className="sr-only">
        {expanded
          ? t("agentLayer:overview.hideDone")
          : t("agentLayer:overview.showDone")}
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
  const usage = topModel(node.usage.byModel);
  const key = `${projectSlug ? `${projectSlug}-` : "#"}${node.number ?? "?"}`;

  return (
    <div
      data-testid="tree-node"
      data-done={node.done ? "true" : "false"}
      className={cn(
        "rounded-lg border border-border/80 bg-background p-2.5 shadow-xs/5",
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
          aria-label={t("agentLayer:overview.documents")}
        >
          {node.documents.map((document) => (
            <li key={document.id} data-testid="tree-document">
              <Link
                to="/dashboard/workspace/$workspaceId/project/$projectId/docs/$slug"
                params={{ workspaceId, projectId, slug: document.slug }}
                className="flex items-center gap-1.5 truncate text-xs text-foreground/80 underline-offset-2 hover:underline"
              >
                <FileText className="size-3 shrink-0 text-muted-foreground" />
                <span className="truncate">{document.title}</span>
              </Link>
            </li>
          ))}
        </ul>
      ) : null}

      {node.attachments.length > 0 ? (
        <ul
          className="mt-1 space-y-0.5"
          aria-label={t("agentLayer:overview.attachments")}
        >
          {/* Click behavior (sandboxed viewer / download) is wired in Phase 1a'. */}
          {node.attachments.map((attachment) => (
            <li
              key={attachment.id}
              data-testid="tree-attachment"
              className="flex items-center gap-1.5 truncate text-xs text-muted-foreground"
              title={attachment.contentType}
            >
              <Paperclip className="size-3 shrink-0" />
              <span className="truncate">{attachment.name}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
