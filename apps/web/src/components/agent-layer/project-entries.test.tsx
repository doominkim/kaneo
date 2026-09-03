import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AgentLayerApiError } from "@/fetchers/agent-layer/api-error";
import type { AgentEntrySummary } from "@/fetchers/agent-layer/get-agent-entries";
import { ProjectEntries } from "./project-entries";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: { value?: number }) =>
      options?.value !== undefined ? `${key}:${options.value}` : key,
  }),
}));
const mocks = vi.hoisted(() => ({
  entries: vi.fn(),
  remove: vi.fn(),
  restore: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
  canUpdateProjects: vi.fn(() => false),
  currentUser: { id: "u1" } as { id: string } | null,
}));
vi.mock("@/hooks/queries/agent-layer/use-agent-entries", () => ({
  useAgentEntries: mocks.entries,
}));
vi.mock("@/hooks/use-workspace-permission", () => ({
  useWorkspacePermission: () => ({
    canUpdateProjects: () => mocks.canUpdateProjects(),
  }),
}));
vi.mock("@/components/providers/auth-provider/hooks/use-auth", () => ({
  useAuth: () => ({ user: mocks.currentUser }),
}));
vi.mock("@/hooks/mutations/agent-layer/use-delete-agent-entry", () => ({
  useDeleteAgentEntry: () => ({ mutateAsync: mocks.remove, isPending: false }),
}));
vi.mock("@/hooks/mutations/agent-layer/use-restore-agent-entry", () => ({
  useRestoreAgentEntry: () => ({
    mutateAsync: mocks.restore,
    isPending: false,
  }),
}));
vi.mock("@/lib/toast", () => ({
  toast: { success: mocks.toastSuccess, error: mocks.toastError },
}));
vi.mock("@/lib/format", () => ({
  formatRelativeTime: () => "2 hours ago",
  formatDateTime: () => "Sep 3, 2026",
}));

function entry(
  overrides: Partial<AgentEntrySummary> & { id: string; summary: string },
): AgentEntrySummary {
  return {
    taskId: null,
    kind: "work",
    hasDecision: false,
    coreChanged: null,
    repo: null,
    branch: null,
    effort: null,
    agentLabel: null,
    usage: null,
    createdAt: "2026-09-01T00:00:00.000Z",
    deletedAt: null,
    actor: null,
    author: { userId: "u1", name: "Dominic" },
    ...overrides,
  } as AgentEntrySummary;
}

function pages(entries: AgentEntrySummary[]) {
  return { pages: [{ entries, nextBefore: null }] };
}

function queryResult(overrides: Record<string, unknown> = {}) {
  return {
    isPending: false,
    isError: false,
    error: null,
    data: { pages: [{ entries: [], nextBefore: null }] },
    hasNextPage: false,
    isFetchingNextPage: false,
    fetchNextPage: vi.fn(),
    refetch: vi.fn(),
    ...overrides,
  };
}

beforeEach(() => {
  mocks.entries.mockReset();
  mocks.remove.mockReset().mockResolvedValue({ id: "e1", deletedAt: "now" });
  mocks.restore.mockReset().mockResolvedValue({ id: "e1", deletedAt: null });
  mocks.toastSuccess.mockReset();
  mocks.toastError.mockReset();
  mocks.canUpdateProjects.mockReset().mockReturnValue(false);
  mocks.currentUser = { id: "u1" };
});

afterEach(() => {
  cleanup();
});

describe("ProjectEntries", () => {
  it("asks for the entries with no task", () => {
    mocks.entries.mockReturnValue(queryResult());
    render(
      <ProjectEntries projectId="p1" projectSlug="KAN" onOpenEntry={vi.fn()} />,
    );

    expect(mocks.entries).toHaveBeenCalledWith("p1", undefined, "none", false);
  });

  it("asks for deleted rows too only when the toggle is on", () => {
    mocks.entries.mockReturnValue(queryResult());
    render(<ProjectEntries projectId="p1" showDeleted onOpenEntry={vi.fn()} />);

    expect(mocks.entries).toHaveBeenCalledWith("p1", undefined, "none", true);
  });

  it("renders the empty state when the project has no task-less entries", () => {
    mocks.entries.mockReturnValue(queryResult());
    render(<ProjectEntries projectId="p1" onOpenEntry={vi.fn()} />);

    expect(screen.getByTestId("project-entries-empty")).toHaveTextContent(
      "agentLayer:timeline.projectEntriesEmpty",
    );
    expect(screen.queryAllByTestId("entry-row")).toHaveLength(0);
  });

  it("lists the entries in the order the API returned and opens one on click", () => {
    const onOpenEntry = vi.fn();
    mocks.entries.mockReturnValue(
      queryResult({
        data: {
          pages: [
            {
              entries: [
                entry({ id: "e2", summary: "newer note" }),
                entry({ id: "e1", summary: "older note" }),
              ],
              nextBefore: null,
            },
          ],
        },
      }),
    );
    render(<ProjectEntries projectId="p1" onOpenEntry={onOpenEntry} />);

    const rows = screen.getAllByTestId("entry-row");
    expect(rows.map((row) => row.textContent)).toEqual([
      expect.stringContaining("newer note"),
      expect.stringContaining("older note"),
    ]);
    expect(screen.queryByTestId("project-entries-empty")).toBeNull();

    fireEvent.click(rows[1]);
    expect(onOpenEntry).toHaveBeenCalledWith("e1");
  });

  it("shows the cursor button only while another page exists and fetches it", () => {
    const fetchNextPage = vi.fn();
    mocks.entries.mockReturnValue(
      queryResult({
        data: {
          pages: [
            { entries: [entry({ id: "e1", summary: "a" })], nextBefore: "e1" },
          ],
        },
        hasNextPage: true,
        fetchNextPage,
      }),
    );
    render(<ProjectEntries projectId="p1" onOpenEntry={vi.fn()} />);

    fireEvent.click(screen.getByTestId("project-entries-more"));
    expect(fetchNextPage).toHaveBeenCalledTimes(1);

    cleanup();
    mocks.entries.mockReturnValue(queryResult());
    render(<ProjectEntries projectId="p1" onOpenEntry={vi.fn()} />);
    expect(screen.queryByTestId("project-entries-more")).toBeNull();
  });

  it("offers delete to the author, and to project:update for every row", () => {
    const rows = [
      entry({ id: "mine", summary: "mine" }),
      entry({
        id: "theirs",
        summary: "theirs",
        author: { userId: "u2", name: "Someone" },
      }),
      entry({
        id: "agent",
        summary: "agent",
        author: null,
        actor: {
          id: "a1",
          provider: "anthropic",
          model: "claude-opus-5",
          onBehalfOf: null,
        },
      }),
    ];
    mocks.entries.mockReturnValue(queryResult({ data: pages(rows) }));
    render(<ProjectEntries projectId="p1" onOpenEntry={vi.fn()} />);

    const lis = screen
      .getAllByTestId("entry-row")
      .map((row) => row.closest("li"));
    expect(
      lis.map((li) =>
        Boolean(li?.querySelector('[data-testid="entry-delete"]')),
      ),
    ).toEqual([true, false, false]);
    expect(screen.queryByTestId("entry-restore")).toBeNull();

    cleanup();
    mocks.canUpdateProjects.mockReturnValue(true);
    render(<ProjectEntries projectId="p1" onOpenEntry={vi.fn()} />);
    expect(screen.getAllByTestId("entry-delete")).toHaveLength(3);

    cleanup();
    mocks.canUpdateProjects.mockReturnValue(false);
    mocks.currentUser = null;
    render(<ProjectEntries projectId="p1" onOpenEntry={vi.fn()} />);
    expect(screen.queryByTestId("entry-delete")).toBeNull();
  });

  it("deletes through the confirm dialog and maps 403/404 to their own message", async () => {
    mocks.entries.mockReturnValue(
      queryResult({ data: pages([entry({ id: "e1", summary: "mine" })]) }),
    );
    render(<ProjectEntries projectId="p1" onOpenEntry={vi.fn()} />);

    fireEvent.click(screen.getByTestId("entry-delete"));
    const dialog = await screen.findByTestId("entry-delete-dialog");
    expect(dialog).toHaveTextContent("agentLayer:timeline.deleteTitle");
    expect(dialog).toHaveTextContent("mine");
    expect(mocks.remove).not.toHaveBeenCalled();

    fireEvent.click(within(dialog).getByTestId("entry-delete-submit"));
    await waitFor(() =>
      expect(mocks.remove).toHaveBeenCalledWith({
        projectId: "p1",
        entryId: "e1",
      }),
    );
    expect(mocks.toastSuccess).toHaveBeenCalledWith(
      "agentLayer:timeline.entryDeleted",
    );
    await waitFor(() =>
      expect(screen.queryByTestId("entry-delete-dialog")).toBeNull(),
    );

    mocks.remove.mockRejectedValueOnce(new AgentLayerApiError(403, "nope"));
    fireEvent.click(screen.getByTestId("entry-delete"));
    fireEvent.click(
      within(await screen.findByTestId("entry-delete-dialog")).getByTestId(
        "entry-delete-submit",
      ),
    );
    await waitFor(() =>
      expect(mocks.toastError).toHaveBeenCalledWith(
        "agentLayer:timeline.deleteFailed",
        { description: "agentLayer:timeline.deleteForbidden" },
      ),
    );

    mocks.remove.mockRejectedValueOnce(new AgentLayerApiError(404, "gone"));
    fireEvent.click(
      within(screen.getByTestId("entry-delete-dialog")).getByTestId(
        "entry-delete-submit",
      ),
    );
    await waitFor(() =>
      expect(mocks.toastError).toHaveBeenLastCalledWith(
        "agentLayer:timeline.deleteFailed",
        { description: "agentLayer:timeline.deleteNotFound" },
      ),
    );
  });

  it("marks deleted rows and restores them only with project:update", async () => {
    const rows = [
      entry({ id: "live", summary: "still here" }),
      entry({
        id: "gone",
        summary: "hidden note",
        deletedAt: "2026-09-02T00:00:00.000Z",
      }),
    ];
    mocks.entries.mockReturnValue(queryResult({ data: pages(rows) }));
    mocks.canUpdateProjects.mockReturnValue(true);
    render(<ProjectEntries projectId="p1" showDeleted onOpenEntry={vi.fn()} />);

    const [live, gone] = screen.getAllByTestId("entry-row");
    expect(live.dataset.deleted).toBe("false");
    expect(gone.dataset.deleted).toBe("true");
    expect(within(gone).getByTestId("entry-deleted-badge")).toHaveTextContent(
      "agentLayer:timeline.deleted",
    );
    // A deleted row is restored, never deleted again.
    const goneLi = gone.closest("li") as HTMLElement;
    expect(within(goneLi).queryByTestId("entry-delete")).toBeNull();
    fireEvent.click(within(goneLi).getByTestId("entry-restore"));
    await waitFor(() =>
      expect(mocks.restore).toHaveBeenCalledWith({
        projectId: "p1",
        entryId: "gone",
      }),
    );
    expect(mocks.toastSuccess).toHaveBeenCalledWith(
      "agentLayer:timeline.entryRestored",
    );

    // Without project:update a deleted row (if it ever reached the client)
    // offers neither action.
    cleanup();
    mocks.canUpdateProjects.mockReturnValue(false);
    render(<ProjectEntries projectId="p1" onOpenEntry={vi.fn()} />);
    const deletedLi = screen
      .getAllByTestId("entry-row")[1]
      .closest("li") as HTMLElement;
    expect(within(deletedLi).queryByTestId("entry-restore")).toBeNull();
    expect(within(deletedLi).queryByTestId("entry-delete")).toBeNull();
  });

  it("surfaces a fetch failure with a retry", () => {
    const refetch = vi.fn();
    mocks.entries.mockReturnValue(
      queryResult({
        isError: true,
        error: new Error("boom"),
        data: undefined,
        refetch,
      }),
    );
    render(<ProjectEntries projectId="p1" onOpenEntry={vi.fn()} />);

    expect(screen.getByTestId("agent-layer-error")).toBeInTheDocument();
    fireEvent.click(screen.getByText("agentLayer:common.retry"));
    expect(refetch).toHaveBeenCalledTimes(1);
  });
});
