import type { QueryClient } from "@tanstack/react-query";

/**
 * A domain write can change what every linked surface shows: the sidebar
 * tree, any open page (ancestors, children, aggregates), the project settings
 * that echo `domains[].title`, and the term rows that carry a domain chip.
 */
export function invalidateAgentDomain(
  queryClient: QueryClient,
  workspaceId: string,
) {
  queryClient.invalidateQueries({ queryKey: ["agent-domain", workspaceId] });
  queryClient.invalidateQueries({ queryKey: ["agent-project-settings"] });
  queryClient.invalidateQueries({ queryKey: ["agent-terms", workspaceId] });
}
