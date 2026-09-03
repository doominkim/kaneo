import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentTreeNode } from "@/fetchers/agent-layer/get-agent-tree";
import { TaskTimelineTree } from "./task-timeline-tree";

vi.mock("@tanstack/react-router", () => ({
  Link: ({
    children,
    params,
    to,
  }: {
    children: React.ReactNode;
    params: Record<string, string>;
    to: string;
  }) => (
    <a href={to} data-params={JSON.stringify(params)}>
      {children}
    </a>
  ),
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: { value?: number }) =>
      options?.value !== undefined ? `${key}:${options.value}` : key,
  }),
}));
const mocks = vi.hoisted(() => ({
  download: vi.fn(),
  entries: vi.fn(),
}));
vi.mock("@/lib/download-agent-artifact", () => ({
  downloadAgentArtifact: mocks.download,
}));
vi.mock("@/hooks/queries/agent-layer/use-agent-entries", () => ({
  useAgentEntries: mocks.entries,
}));
vi.mock("@/lib/format", () => ({
  formatRelativeTime: () => "2 hours ago",
  formatDateTime: () => "Sep 3, 2026",
}));
vi.mock("@/lib/toast", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));
vi.mock("@/lib/i18n/domain", () => ({
  getStatusLabel: (status: string) => status,
}));

function node(
  overrides: Partial<AgentTreeNode> & { id: string; title: string },
): AgentTreeNode {
  return {
    number: 1,
    status: "to-do",
    done: false,
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-01T00:00:00.000Z",
    branches: [],
    documents: [],
    attachments: [],
    usage: {
      entryCount: 0,
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      byModel: {},
    },
    children: [],
    ...overrides,
  };
}

const nodes: AgentTreeNode[] = [
  node({
    id: "t1",
    number: 1,
    title: "Task one",
    branches: [
      { repo: "doominkim/kaneo", branch: "feat/kpa-v2" },
      { branch: "hotfix/kpa-login" },
    ],
    usage: {
      entryCount: 3,
      inputTokens: 1000,
      outputTokens: 500,
      totalTokens: 12300,
      byModel: { "claude-opus-5": 12000, "gpt-5.6": 300 },
    },
    children: [
      node({
        id: "t1-1",
        number: 4,
        title: "Child open",
        documents: [
          {
            id: "d1",
            slug: "report",
            title: "Session report",
            actorId: "actor",
            actor: {
              id: "actor",
              provider: "anthropic",
              model: "claude-fable-5-1",
              onBehalfOf: "user-1",
            },
            updatedBy: null,
            updatedAt: "2026-09-01T00:00:00.000Z",
          },
        ],
        attachments: [
          {
            id: "a1",
            name: "report.html",
            contentType: "text/html",
            size: 2048,
            actorId: "actor-gpt",
            actor: {
              id: "actor-gpt",
              provider: "openai",
              model: "gpt-5.6-luna",
              onBehalfOf: "user-1",
            },
            uploadedBy: null,
            createdAt: "2026-09-01T00:00:00.000Z",
          },
          {
            id: "a2",
            name: "bundle.zip",
            contentType: "application/zip",
            size: 1048576,
            actorId: null,
            actor: null,
            uploadedBy: "user-1",
            createdAt: "2026-09-01T00:00:00.000Z",
          },
        ],
      }),
      node({ id: "t1-2", number: 5, title: "Child done", done: true }),
    ],
  }),
  node({ id: "t2", number: 2, title: "Task two" }),
  node({ id: "t3", number: 3, title: "Task three done", done: true }),
];

function renderTree() {
  const onOpenEntry = vi.fn();
  render(
    <TaskTimelineTree
      nodes={nodes}
      workspaceId="ws"
      projectId="p"
      projectSlug="KAN"
      onOpenEntry={onOpenEntry}
    />,
  );
  return { onOpenEntry };
}

beforeEach(() => {
  mocks.download.mockReset().mockResolvedValue(undefined);
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
              kind: "work",
              summary: "Wired the upload flow",
              createdAt: "2026-09-03T00:00:00.000Z",
              usage: { totalTokens: 1200 },
              hasDecision: false,
              coreChanged: [],
              repo: "doominkim/kaneo",
              branch: "feat/kpa-v2",
              effort: null,
              agentLabel: null,
              actor: null,
            },
          ],
          nextBefore: null,
        },
      ],
    },
    hasNextPage: false,
    isFetchingNextPage: false,
    fetchNextPage: vi.fn(),
    refetch: vi.fn(),
  });
});

afterEach(() => {
  cleanup();
});

describe("TaskTimelineTree", () => {
  it("stacks open roots newest first and hides done roots behind a toggle", () => {
    renderTree();

    expect(screen.getByTestId("task-timeline-tree").tagName).toBe("OL");
    const roots = screen.getAllByTestId("tree-root");
    expect(roots).toHaveLength(2);
    expect(within(roots[0]).getByText("Task two")).toBeInTheDocument();
    expect(within(roots[1]).getByText("Task one")).toBeInTheDocument();
    expect(screen.queryByText("Task three done")).not.toBeInTheDocument();

    // The child-level toggle inside "Task one" also reads "Done (1)"; the
    // root-level one is the only toggle outside any root column.
    const rootToggle = screen
      .getAllByTestId("done-toggle")
      .find((toggle) => !toggle.closest('[data-testid="tree-root"]'));
    if (!rootToggle) throw new Error("root done toggle missing");
    expect(rootToggle).toHaveTextContent("agentLayer:timeline.doneCollapsed:1");
    expect(rootToggle).toHaveAttribute("aria-expanded", "false");

    fireEvent.click(rootToggle);

    expect(screen.getAllByTestId("tree-root")).toHaveLength(3);
    expect(screen.getByText("Task three done")).toBeInTheDocument();
    expect(rootToggle).toHaveAttribute("aria-expanded", "true");
  });

  it("nests children under their root and folds done children", () => {
    renderTree();

    const firstRoot = screen.getAllByTestId("tree-root")[1];
    const children = within(firstRoot).getAllByTestId("tree-child");
    expect(children).toHaveLength(1);
    expect(within(children[0]).getByText("Child open")).toBeInTheDocument();
    expect(screen.queryByText("Child done")).not.toBeInTheDocument();

    const childToggle = within(firstRoot).getByTestId("done-toggle");
    fireEvent.click(childToggle);

    expect(within(firstRoot).getAllByTestId("tree-child")).toHaveLength(2);
    expect(screen.getByText("Child done")).toBeInTheDocument();
  });

  it("renders task links, branch chips, the top-model usage chip and document leaves", () => {
    renderTree();

    const firstRoot = screen.getAllByTestId("tree-root")[1];
    const taskLink = within(firstRoot).getAllByRole("link")[0];
    expect(taskLink).toHaveAttribute(
      "href",
      "/dashboard/workspace/$workspaceId/project/$projectId/task/$taskId",
    );
    expect(taskLink).toHaveAttribute(
      "data-params",
      JSON.stringify({ workspaceId: "ws", projectId: "p", taskId: "t1" }),
    );
    expect(within(taskLink).getByText("KAN-1")).toBeInTheDocument();

    const branches = within(firstRoot).getAllByTestId("branch-chip");
    expect(branches.map((chip) => chip.textContent)).toEqual([
      "doominkim/kaneo:feat/kpa-v2",
      "hotfix/kpa-login",
    ]);

    expect(within(firstRoot).getByTestId("usage-chip")).toHaveTextContent(
      "claude-opus-5 · 12.3K",
    );

    const document = within(firstRoot).getByTestId("tree-document");
    const documentLink = within(document).getByRole("link");
    expect(documentLink).toHaveAttribute(
      "href",
      "/dashboard/workspace/$workspaceId/project/$projectId/docs/$slug",
    );
    expect(documentLink).toHaveTextContent("Session report");
    expect(within(document).getByTestId("agent-author")).toHaveTextContent(
      "claude-fable-5-1",
    );

    const attachments = screen.getAllByTestId("tree-attachment");
    expect(attachments).toHaveLength(2);

    const [htmlLeaf, zipLeaf] = attachments;
    expect(htmlLeaf.dataset.kind).toBe("html");
    const viewerLink = within(htmlLeaf).getByRole("link");
    expect(viewerLink).toHaveAttribute(
      "href",
      "/dashboard/workspace/$workspaceId/project/$projectId/docs/artifact/$artifactId",
    );
    expect(viewerLink).toHaveAttribute(
      "data-params",
      JSON.stringify({ workspaceId: "ws", projectId: "p", artifactId: "a1" }),
    );
    expect(within(htmlLeaf).getByTestId("agent-author")).toHaveTextContent(
      "gpt-5.6-luna",
    );
    // Human upload: no model to name, and no misleading "Agent" badge either.
    expect(within(zipLeaf).queryByTestId("agent-author")).toBeNull();
    expect(htmlLeaf).toHaveTextContent("report.html");
    expect(htmlLeaf).toHaveTextContent("2.0 KB");

    expect(zipLeaf.dataset.kind).toBe("zip");
    expect(within(zipLeaf).queryByRole("link")).not.toBeInTheDocument();
    fireEvent.click(within(zipLeaf).getByRole("button"));
    expect(mocks.download).toHaveBeenCalledWith("p", "a2");
    expect(zipLeaf).toHaveTextContent("1.0 MB");
  });

  it("unfolds a task's own ledger entries and opens the detail drawer", () => {
    const { onOpenEntry } = renderTree();

    expect(mocks.entries).not.toHaveBeenCalled();
    const taskOne = screen.getAllByTestId("tree-root")[1];
    const toggle = within(taskOne).getAllByTestId("entries-toggle")[0];
    expect(toggle).toHaveTextContent("agentLayer:timeline.entriesToggle:3");
    expect(toggle).toHaveAttribute("aria-expanded", "false");

    fireEvent.click(toggle);

    expect(mocks.entries).toHaveBeenCalledWith("p", undefined, "t1");
    const entries = within(taskOne).getByTestId("task-entries");
    const row = within(entries).getByTestId("entry-row");
    expect(row).toHaveTextContent("Wired the upload flow");
    // Inside the task's own card the task key would be noise.
    expect(row).not.toHaveTextContent("KAN-");
    // The listing lifts refs.repo/refs.branch so a row can show them.
    expect(within(row).getByTestId("branch-chip")).toHaveTextContent(
      "doominkim/kaneo:feat/kpa-v2",
    );

    fireEvent.click(row);
    expect(onOpenEntry).toHaveBeenCalledWith("e1");

    fireEvent.click(toggle);
    expect(
      within(taskOne).queryByTestId("task-entries"),
    ).not.toBeInTheDocument();
  });

  it("shows the empty ledger state for a task without entries", () => {
    mocks.entries.mockReturnValue({
      isPending: false,
      isError: false,
      data: { pages: [{ entries: [], nextBefore: null }] },
      hasNextPage: false,
      isFetchingNextPage: false,
      fetchNextPage: vi.fn(),
      refetch: vi.fn(),
    });
    renderTree();
    const taskTwo = screen.getAllByTestId("tree-root")[0];
    fireEvent.click(within(taskTwo).getByTestId("entries-toggle"));
    expect(
      within(taskTwo).getByText("agentLayer:timeline.entriesEmpty"),
    ).toBeInTheDocument();
  });
});
