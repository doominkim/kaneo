import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DecisionList } from "./decision-list";

const mocks = vi.hoisted(() => ({ entries: vi.fn() }));

vi.mock("@/hooks/use-workspace-permission", () => ({
  useWorkspacePermission: () => ({ canUpdateProjects: () => false }),
}));
vi.mock("@/components/providers/auth-provider/hooks/use-auth", () => ({
  useAuth: () => ({ user: { id: "viewer" } }),
}));
vi.mock("@/hooks/mutations/agent-layer/use-delete-agent-entry", () => ({
  useDeleteAgentEntry: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock("@/lib/toast", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: { value?: unknown }) =>
      options?.value !== undefined ? `${key}:${String(options.value)}` : key,
  }),
}));
vi.mock("@/lib/format", () => ({
  formatRelativeTime: () => "2 hours ago",
  formatDateTime: () => "Sep 3, 2026",
}));
vi.mock("@/hooks/queries/agent-layer/use-agent-entries", () => ({
  useAgentEntries: mocks.entries,
}));

beforeEach(() => {
  mocks.entries.mockReset().mockReturnValue({
    isPending: false,
    isError: false,
    data: {
      pages: [
        {
          entries: [
            {
              id: "e1",
              taskId: "t1",
              kind: "decision",
              summary: "Keep docs.index and docs.$slug as siblings",
              hasDecision: true,
              coreChanged: [],
              repo: "doominkim/kaneo",
              branch: "agent-layer",
              effort: "high",
              agentLabel: "3setter",
              usage: null,
              createdAt: "2026-09-03T00:00:00.000Z",
              actor: { id: "a", provider: "anthropic", model: "claude-opus-5" },
            },
            {
              id: "e2",
              taskId: null,
              kind: "decision",
              summary: "Project-level decision",
              hasDecision: true,
              coreChanged: null,
              repo: null,
              branch: null,
              effort: null,
              agentLabel: null,
              usage: null,
              createdAt: "2026-09-02T00:00:00.000Z",
              actor: null,
            },
          ],
          nextBefore: "e2",
        },
      ],
    },
    hasNextPage: true,
    isFetchingNextPage: false,
    fetchNextPage: vi.fn(),
    refetch: vi.fn(),
  });
});

afterEach(() => cleanup());

describe("DecisionList", () => {
  it("asks for decision entries only and renders branch chips from the summary fields", () => {
    const onOpenEntry = vi.fn();
    render(
      <DecisionList
        projectId="p"
        projectSlug="KAN"
        taskNumberById={new Map([["t1", 7]])}
        onOpenEntry={onOpenEntry}
      />,
    );
    expect(mocks.entries).toHaveBeenCalledWith("p", "decision");

    const rows = screen.getAllByTestId("entry-row");
    expect(rows).toHaveLength(2);
    // KAN-11/12: the model is a badge, the harness label and effort follow it.
    expect(within(rows[0]).getByTestId("agent-author")).toHaveTextContent(
      "claude-opus-5",
    );
    expect(rows[0]).toHaveTextContent("3setter · high");
    expect(rows[0]).toHaveTextContent("KAN-7");
    expect(within(rows[0]).getByTestId("branch-chip")).toHaveTextContent(
      "doominkim/kaneo:agent-layer",
    );
    expect(
      within(rows[1]).queryByTestId("branch-chip"),
    ).not.toBeInTheDocument();

    fireEvent.click(rows[0]);
    expect(onOpenEntry).toHaveBeenCalledWith("e1");
    expect(screen.getByText("agentLayer:common.loadMore")).toBeInTheDocument();
  });
});
