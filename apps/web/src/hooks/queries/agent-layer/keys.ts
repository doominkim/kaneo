import type { AgentEntryKind } from "@/fetchers/agent-layer/get-agent-entries";

/**
 * One place for the agent-layer cache keys so the mutation hooks and the
 * query hooks cannot drift apart on what a document write must invalidate.
 */
export const agentLayerKeys = {
  tree: (projectId: string) => ["agent-tree", projectId] as const,
  entries: (projectId: string, kind?: AgentEntryKind) =>
    ["agent-entries", projectId, kind ?? "all"] as const,
  latestEntry: (projectId: string) =>
    ["agent-entries", projectId, "latest"] as const,
  entry: (projectId: string, entryId: string) =>
    ["agent-entry", projectId, entryId] as const,
  leases: (projectId: string) => ["agent-leases", projectId] as const,
  documents: (projectId: string) => ["agent-documents", projectId] as const,
  document: (projectId: string, slug: string) =>
    ["agent-document", projectId, slug] as const,
};
