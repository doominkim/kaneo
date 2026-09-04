import type { AgentDomainNode } from "@/fetchers/agent-layer/get-agent-domains";

// Mirrors apps/api/src/agent-domain/schema.ts; the server stays the authority.
export const DOMAIN_SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;
export const MAX_DOMAIN_BODY_BYTES = 200 * 1024;
export const MAX_DOMAIN_TITLE_LENGTH = 200;
/** Mirrors MAX_PROJECT_DOMAINS in apps/api/src/agent-project/schema.ts. */
export const MAX_PROJECT_DOMAINS = 20;

export type DomainTreeNode = AgentDomainNode & {
  depth: number;
  children: DomainTreeNode[];
  /**
   * `proposedCount` plus every descendant's. The API counts what is filed
   * directly on a page, which is the right contract; a collapsed row still has
   * to say what is waiting underneath it, so the rollup is computed here.
   */
  subtreeProposedCount: number;
};

/**
 * Builds the tree from the flat listing. The API orders rows by
 * (parentId, position, title) already, so children keep their order. A row
 * whose parent is missing (a stale cache between a move and a refetch) is
 * shown at the root rather than dropped.
 */
export function buildDomainTree(
  nodes: AgentDomainNode[] | undefined,
): DomainTreeNode[] {
  const byId = new Map<string, DomainTreeNode>();
  for (const node of nodes ?? []) {
    byId.set(node.id, {
      ...node,
      depth: 0,
      children: [],
      subtreeProposedCount: node.proposedCount,
    });
  }
  const roots: DomainTreeNode[] = [];
  for (const node of byId.values()) {
    const parent = node.parentId ? byId.get(node.parentId) : undefined;
    if (parent) parent.children.push(node);
    else roots.push(node);
  }
  const setDepth = (list: DomainTreeNode[], depth: number) => {
    for (const node of list) {
      node.depth = depth;
      setDepth(node.children, depth + 1);
    }
  };
  setDepth(roots, 0);
  const rollUp = (node: DomainTreeNode): number => {
    let total = node.proposedCount;
    for (const child of node.children) total += rollUp(child);
    node.subtreeProposedCount = total;
    return total;
  };
  for (const root of roots) rollUp(root);
  return roots;
}

/** Depth-first order with depth, for indented selects. */
export function flattenDomainTree(roots: DomainTreeNode[]): DomainTreeNode[] {
  const out: DomainTreeNode[] = [];
  const visit = (node: DomainTreeNode) => {
    out.push(node);
    for (const child of node.children) visit(child);
  };
  for (const root of roots) visit(root);
  return out;
}

/** The page itself and everything under it — the targets a move must refuse. */
export function descendantIds(
  nodes: AgentDomainNode[] | undefined,
  domainId: string,
): Set<string> {
  const childrenOf = new Map<string, string[]>();
  for (const node of nodes ?? []) {
    if (!node.parentId) continue;
    const list = childrenOf.get(node.parentId) ?? [];
    list.push(node.id);
    childrenOf.set(node.parentId, list);
  }
  const out = new Set<string>([domainId]);
  const stack = [domainId];
  while (stack.length > 0) {
    const current = stack.pop() as string;
    for (const child of childrenOf.get(current) ?? []) {
      if (out.has(child)) continue;
      out.add(child);
      stack.push(child);
    }
  }
  return out;
}

/**
 * A slug suggestion from the title: ASCII letters and digits kept, everything
 * else collapsed to a hyphen. A title with no ASCII (a Korean one, say)
 * yields "" and the user types the slug by hand — inventing a romanisation
 * would produce identifiers nobody would search for.
 */
export function slugFromTitle(title: string) {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64)
    .replace(/-+$/g, "");
}

/**
 * `domain-xxxxxx`: the slug a page gets when its title gives none (KAN-14
 * titles are Korean). Random rather than a counter so two people creating
 * siblings at once do not collide; the user can still overwrite it.
 */
export function randomSlugFallback() {
  let suffix = "";
  while (suffix.length < 6) {
    suffix += Math.floor(Math.random() * 36).toString(36);
  }
  return `domain-${suffix}`;
}

/**
 * "root / parent / page" — the label a select shows for a nested page, or
 * `null` when the id names nothing in `nodes` (the listing has not loaded, or
 * the item points at another workspace's page). An empty string would render
 * as a blank trigger and read as a bug; `null` makes the caller choose what to
 * say instead.
 */
export function domainPathLabel(
  nodes: AgentDomainNode[] | undefined,
  domainId: string,
): string | null {
  const byId = new Map((nodes ?? []).map((node) => [node.id, node]));
  const parts: string[] = [];
  let current = byId.get(domainId);
  const seen = new Set<string>();
  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    parts.unshift(current.title);
    current = current.parentId ? byId.get(current.parentId) : undefined;
  }
  return parts.length > 0 ? parts.join(" / ") : null;
}
