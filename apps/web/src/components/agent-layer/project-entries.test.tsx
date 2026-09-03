import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
}));
vi.mock("@/hooks/queries/agent-layer/use-agent-entries", () => ({
  useAgentEntries: mocks.entries,
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
    actor: null,
    author: { userId: "u1", name: "Dominic" },
    ...overrides,
  } as AgentEntrySummary;
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

    expect(mocks.entries).toHaveBeenCalledWith("p1", undefined, "none");
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
