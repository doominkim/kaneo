import type { AgentEntryKind } from "@/fetchers/agent-layer/get-agent-entries";
import type {
  AgentTermConfidence,
  AgentTermState,
} from "@/fetchers/agent-layer/get-agent-terms";

/**
 * One place for the agent-layer cache keys so the mutation hooks and the
 * query hooks cannot drift apart on what a document write must invalidate.
 */
export const agentLayerKeys = {
  tree: (projectId: string) => ["agent-tree", projectId] as const,
  entries: (projectId: string, kind?: AgentEntryKind, taskId?: string) =>
    ["agent-entries", projectId, kind ?? "all", taskId ?? "all"] as const,
  latestEntry: (projectId: string) =>
    ["agent-entries", projectId, "latest"] as const,
  entry: (projectId: string, entryId: string) =>
    ["agent-entry", projectId, entryId] as const,
  leases: (projectId: string) => ["agent-leases", projectId] as const,
  documents: (projectId: string) => ["agent-documents", projectId] as const,
  document: (projectId: string, slug: string) =>
    ["agent-document", projectId, slug] as const,
  artifacts: (projectId: string) => ["agent-artifacts", projectId] as const,
  artifactUrl: (projectId: string, artifactId: string, disposition: string) =>
    ["agent-artifact-url", projectId, artifactId, disposition] as const,
  settings: (projectId: string) =>
    ["agent-project-settings", projectId] as const,
  terms: (
    workspaceId: string,
    confidence?: AgentTermConfidence,
    state?: AgentTermState,
  ) =>
    ["agent-terms", workspaceId, confidence ?? "all", state ?? "all"] as const,
  termResolve: (workspaceId: string, term: string) =>
    ["agent-term-resolve", workspaceId, term] as const,
};
