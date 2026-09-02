import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
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
            updatedBy: null,
            updatedAt: "2026-09-01T00:00:00.000Z",
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
  return render(
    <TaskTimelineTree
      nodes={nodes}
      workspaceId="ws"
      projectId="p"
      projectSlug="KAN"
    />,
  );
}

afterEach(() => {
  cleanup();
});

describe("TaskTimelineTree", () => {
  it("lays out open roots in order and hides done roots behind a toggle", () => {
    renderTree();

    const roots = screen.getAllByTestId("tree-root");
    expect(roots).toHaveLength(2);
    expect(within(roots[0]).getByText("Task one")).toBeInTheDocument();
    expect(within(roots[1]).getByText("Task two")).toBeInTheDocument();
    expect(screen.queryByText("Task three done")).not.toBeInTheDocument();

    // The child-level toggle inside "Task one" also reads "Done (1)"; the
    // root-level one is the only toggle outside any root column.
    const rootToggle = screen
      .getAllByTestId("done-toggle")
      .find((toggle) => !toggle.closest('[data-testid="tree-root"]'));
    if (!rootToggle) throw new Error("root done toggle missing");
    expect(rootToggle).toHaveTextContent("agentLayer:overview.doneCollapsed:1");
    expect(rootToggle).toHaveAttribute("aria-expanded", "false");

    fireEvent.click(rootToggle);

    expect(screen.getAllByTestId("tree-root")).toHaveLength(3);
    expect(screen.getByText("Task three done")).toBeInTheDocument();
    expect(rootToggle).toHaveAttribute("aria-expanded", "true");
  });

  it("nests children under their root and folds done children", () => {
    renderTree();

    const [firstRoot] = screen.getAllByTestId("tree-root");
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

    const [firstRoot] = screen.getAllByTestId("tree-root");
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

    expect(screen.queryByTestId("tree-attachment")).not.toBeInTheDocument();
  });
});
