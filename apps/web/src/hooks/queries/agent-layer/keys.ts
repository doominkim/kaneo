import type { AgentEntryKind } from "@/fetchers/agent-layer/get-agent-entries";
import type {
  AgentTermConfidence,
  AgentTermState,
} from "@/fetchers/agent-layer/get-agent-terms";

export type AgentTermFilters = {
  confidence?: AgentTermConfidence;
  state?: AgentTermState;
  /** A domain page id, or `"none"` for the unfiled bucket. */
  domainId?: string;
};

/**
 * One place for the agent-layer cache keys so the mutation hooks and the
 * query hooks cannot drift apart on what a document write must invalidate.
 */
export const agentLayerKeys = {
  decisions: (
    projectId: string,
    status: "current" | "all" | "draft" | "accepted" | "superseded" = "current",
    query = "",
    taskId?: string,
  ) => ["agent-decisions", projectId, status, query, taskId ?? "all"] as const,
  decision: (projectId: string, decisionId: string) =>
    ["agent-decision", projectId, decisionId] as const,
  tree: (projectId: string) => ["agent-tree", projectId] as const,
  // The trailing segment keeps the maintainer's "with deleted" view apart
  // from the default one; both sit under the same prefix, so the mutations'
  // `["agent-entries", projectId]` invalidation reaches either.
  entries: (
    projectId: string,
    kind?: AgentEntryKind,
    taskId?: string,
    includeDeleted = false,
  ) =>
    [
      "agent-entries",
      projectId,
      kind ?? "all",
      taskId ?? "all",
      includeDeleted ? "with-deleted" : "live",
    ] as const,
  latestEntry: (projectId: string) =>
    ["agent-entries", projectId, "latest"] as const,
  entry: (projectId: string, entryId: string, includeDeleted = false) =>
    [
      "agent-entry",
      projectId,
      entryId,
      includeDeleted ? "with-deleted" : "live",
    ] as const,
  leases: (projectId: string) => ["agent-leases", projectId] as const,
  documents: (projectId: string) => ["agent-documents", projectId] as const,
  document: (projectId: string, slug: string) =>
    ["agent-document", projectId, slug] as const,
  artifacts: (projectId: string) => ["agent-artifacts", projectId] as const,
  artifactUrl: (projectId: string, artifactId: string, disposition: string) =>
    ["agent-artifact-url", projectId, artifactId, disposition] as const,
  settings: (projectId: string) =>
    ["agent-project-settings", projectId] as const,
  // `domainId` is part of the key, not just the request: the domain page and
  // the knowledge tab read the same endpoint with different scopes, so a term
  // refiled from one domain to another must not be served from the other's
  // cache entry.
  terms: (workspaceId: string, filters: AgentTermFilters = {}) =>
    [
      "agent-terms",
      workspaceId,
      filters.confidence ?? "all",
      filters.state ?? "all",
      filters.domainId ?? "all",
    ] as const,
  termResolve: (workspaceId: string, term: string) =>
    ["agent-term-resolve", workspaceId, term] as const,
  // Domain pages are workspace-scoped. Both keys share the workspace prefix
  // so one `["agent-domain", workspaceId]` invalidation reaches the tree and
  // every open page after a write.
  domains: (workspaceId: string) =>
    ["agent-domain", workspaceId, "tree"] as const,
  domain: (workspaceId: string, domainId: string) =>
    ["agent-domain", workspaceId, "page", domainId] as const,
  // Spec tabs (KAN-19). Sets, designs and task links all share the project
  // prefix of their own family; a requirement edit invalidates designs and
  // task links too, because stale is computed from the items' clocks.
  requirementSets: (projectId: string) =>
    ["agent-requirements", projectId, "list"] as const,
  requirementSet: (projectId: string, feature: string) =>
    ["agent-requirements", projectId, "set", feature] as const,
  designs: (projectId: string) => ["agent-designs", projectId, "list"] as const,
  design: (projectId: string, feature: string) =>
    ["agent-designs", projectId, "set", feature] as const,
  taskLinkBadges: (projectId: string) =>
    ["agent-task-links", projectId, "badges"] as const,
  taskLinks: (projectId: string, taskId: string) =>
    ["agent-task-links", projectId, "task", taskId] as const,
  features: (projectId: string) =>
    ["agent-features", projectId, "list"] as const,
  featureTasks: (projectId: string, feature: string) =>
    ["agent-features", projectId, "tasks", feature] as const,
};
