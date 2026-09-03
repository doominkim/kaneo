import { useNavigate, useParams } from "@tanstack/react-router";
import { ChevronRight, Plus } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Collapsible,
  CollapsiblePanel,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  SidebarGroup,
  SidebarGroupAction,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import type { AgentDomain } from "@/fetchers/agent-layer/create-agent-domain";
import { useAgentDomains } from "@/hooks/queries/agent-layer/use-agent-domains";
import useActiveWorkspace from "@/hooks/queries/workspace/use-active-workspace";
import { useWorkspacePermission } from "@/hooks/use-workspace-permission";
import { cn } from "@/lib/cn";
import { CreateDomainDialog } from "./create-domain-dialog";
import { buildDomainTree, type DomainTreeNode } from "./domain-tree";

type CreateTarget = { id: string; title: string } | null;

/**
 * Sidebar "Domains" section (KAN-14): the workspace's domain page tree next
 * to the project list. Reads the same flat listing the pages use, so a
 * create anywhere shows up here without a second fetch.
 */
export function NavDomains() {
  const { t } = useTranslation();
  const { data: workspace } = useActiveWorkspace();
  const workspaceId = workspace?.id ?? "";
  const domains = useAgentDomains(workspaceId);
  const { canUpdateTasks } = useWorkspacePermission();
  const canCreate = canUpdateTasks();
  const navigate = useNavigate();
  const { workspaceId: routeWorkspaceId, domainId: currentDomainId } =
    useParams({ strict: false });
  // `undefined` is closed; `null` creates a root page.
  const [createParent, setCreateParent] = useState<CreateTarget | undefined>(
    undefined,
  );

  const tree = useMemo(
    () => buildDomainTree(domains.data?.domains),
    [domains.data],
  );
  // Every ancestor of the current page starts expanded so the active row is
  // visible on arrival; the rest start collapsed.
  const activeAncestors = useMemo(() => {
    const out = new Set<string>();
    const byId = new Map(
      (domains.data?.domains ?? []).map((node) => [node.id, node]),
    );
    let current = currentDomainId ? byId.get(currentDomainId) : undefined;
    while (current?.parentId && !out.has(current.parentId)) {
      out.add(current.parentId);
      current = byId.get(current.parentId);
    }
    return out;
  }, [domains.data, currentDomainId]);

  if (!workspace) return null;

  const activeId =
    routeWorkspaceId === workspace.id ? (currentDomainId ?? null) : null;

  const open = (domainId: string) =>
    navigate({
      to: "/dashboard/workspace/$workspaceId/domain/$domainId",
      params: { workspaceId: workspace.id, domainId },
    });

  return (
    <>
      <Collapsible defaultOpen className="group/collapsible">
        <SidebarGroup
          className="group-data-[collapsible=icon]:hidden gap-1 p-2 pt-1"
          data-testid="nav-domains"
        >
          <CollapsibleTrigger
            className="data-panel-open:[&_svg]:rotate-90"
            render={
              <SidebarGroupLabel className="h-7 cursor-pointer justify-between px-0 pe-6 text-sidebar-accent-foreground" />
            }
          >
            <span>{t("agentLayer:nav.domains")}</span>
            <ChevronRight className="h-3.5 w-3.5 text-sidebar-foreground/60 transition-transform duration-200" />
          </CollapsibleTrigger>
          {canCreate ? (
            <SidebarGroupAction
              className="top-1.5 right-1"
              title={t("agentLayer:domain.addRoot")}
              aria-label={t("agentLayer:domain.addRoot")}
              onClick={() => setCreateParent(null)}
              data-testid="add-root-domain"
            >
              <Plus />
            </SidebarGroupAction>
          ) : null}
          <CollapsiblePanel>
            <SidebarGroupContent>
              <SidebarMenu className="gap-0.5" data-testid="domain-tree">
                {tree.length === 0 && !domains.isPending ? (
                  <li
                    className="px-3.5 py-1 text-xs text-sidebar-foreground/60"
                    data-testid="domain-tree-empty"
                  >
                    {t("agentLayer:domain.noneYet")}
                  </li>
                ) : null}
                {tree.map((node) => (
                  <DomainNodeRows
                    key={node.id}
                    node={node}
                    activeId={activeId}
                    activeAncestors={activeAncestors}
                    canCreate={canCreate}
                    onOpen={open}
                    onAddChild={(parent) => setCreateParent(parent)}
                    addChildLabel={t("agentLayer:domain.addChild")}
                  />
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </CollapsiblePanel>
        </SidebarGroup>
      </Collapsible>

      <CreateDomainDialog
        open={createParent !== undefined}
        onOpenChange={(next) => {
          if (!next) setCreateParent(undefined);
        }}
        workspaceId={workspace.id}
        parent={createParent ?? null}
        onCreated={(created: AgentDomain) => {
          setCreateParent(undefined);
          open(created.id);
        }}
      />
    </>
  );
}

type DomainNodeRowsProps = {
  node: DomainTreeNode;
  activeId: string | null;
  activeAncestors: Set<string>;
  canCreate: boolean;
  onOpen: (domainId: string) => void;
  onAddChild: (parent: { id: string; title: string }) => void;
  addChildLabel: string;
};

function DomainNodeRows({
  node,
  activeId,
  activeAncestors,
  canCreate,
  onOpen,
  onAddChild,
  addChildLabel,
}: DomainNodeRowsProps) {
  const [expanded, setExpanded] = useState(activeAncestors.has(node.id));
  // The rows outlive a navigation, so a page opened later (or a child just
  // created under a collapsed branch) still has to unfold its ancestors.
  useEffect(() => {
    if (activeAncestors.has(node.id)) setExpanded(true);
  }, [activeAncestors, node.id]);
  const hasChildren = node.children.length > 0;
  const isActive = node.id === activeId;

  return (
    <>
      <SidebarMenuItem
        data-testid="domain-node"
        data-domain-id={node.id}
        data-depth={node.depth}
      >
        <SidebarMenuButton
          isActive={isActive}
          size="default"
          className="h-8 pe-7 text-sm hover:bg-transparent hover:text-sidebar-accent-foreground active:bg-transparent"
          style={{ paddingLeft: `${1.625 + node.depth * 0.875}rem` }}
          onClick={() => onOpen(node.id)}
        >
          <span className="truncate">{node.title}</span>
        </SidebarMenuButton>
        {/* A sibling, not a child, of the row button: nested buttons are
            invalid DOM and React warns on every row. */}
        {hasChildren ? (
          <button
            type="button"
            aria-label={node.title}
            aria-expanded={expanded}
            className="absolute top-1.5 flex size-5 items-center justify-center rounded-sm text-sidebar-foreground/60 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
            style={{ left: `${0.25 + node.depth * 0.875}rem` }}
            onClick={() => setExpanded((current) => !current)}
            data-testid="domain-toggle"
          >
            <ChevronRight
              className={cn(
                "size-3.5 transition-transform duration-200",
                expanded && "rotate-90",
              )}
            />
          </button>
        ) : null}
        {canCreate ? (
          <SidebarMenuAction
            showOnHover
            title={addChildLabel}
            aria-label={`${addChildLabel}: ${node.title}`}
            onClick={() => onAddChild({ id: node.id, title: node.title })}
            data-testid="add-child-domain"
          >
            <Plus />
          </SidebarMenuAction>
        ) : null}
      </SidebarMenuItem>
      {hasChildren && expanded
        ? node.children.map((child) => (
            <DomainNodeRows
              key={child.id}
              node={child}
              activeId={activeId}
              activeAncestors={activeAncestors}
              canCreate={canCreate}
              onOpen={onOpen}
              onAddChild={onAddChild}
              addChildLabel={addChildLabel}
            />
          ))
        : null}
    </>
  );
}
