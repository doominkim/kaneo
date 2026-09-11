import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type { ComponentType, ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Route } from "./$decisionId";

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  accept: vi.fn(),
  decision: vi.fn(),
  decisions: vi.fn(),
  search: {
    origin: "knowledge",
    status: "current",
    supersedes: "old",
  } as Record<string, unknown>,
}));
vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (options: Record<string, unknown>) => ({
    ...options,
    useParams: () => ({ workspaceId: "w", projectId: "p", decisionId: "d1" }),
    useSearch: () => mocks.search,
  }),
  useNavigate: () => mocks.navigate,
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("@/components/common/project-layout", () => ({
  default: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/page-title", () => ({ default: () => null }));
vi.mock("@/components/agent-layer/adr-editor-dialog", () => ({
  AdrEditorDialog: () => null,
}));
vi.mock("@/components/agent-layer/agent-author-badge", () => ({
  AgentAuthorBadge: ({
    humanName,
    actor,
  }: {
    humanName?: string;
    actor?: { model: string };
  }) => <span>{humanName ?? actor?.model}</span>,
}));
vi.mock("@/hooks/use-workspace-permission", () => ({
  useWorkspacePermission: () => ({
    canUpdateTasks: () => true,
    canUpdateProjects: () => true,
  }),
}));
vi.mock("@/hooks/mutations/agent-layer/use-agent-decisions", () => ({
  useAcceptAgentDecision: () => ({
    mutateAsync: mocks.accept,
    isPending: false,
  }),
}));
vi.mock("@/hooks/queries/agent-layer/use-agent-decisions", () => ({
  useAgentDecision: mocks.decision,
  useAgentDecisions: mocks.decisions,
}));

const current = {
  id: "d1",
  workspaceId: "w",
  projectId: "p",
  number: 3,
  title: "Current",
  status: "draft",
  context: "Context",
  decision: "Decision",
  alternatives: null,
  consequences: null,
  sourceNote: "Source note",
  reversible: null,
  sourceEntryId: null,
  supersedesDecisionId: null,
  supersedes: null,
  supersededBy: null,
  refs: {
    repo: "kaneo",
    branch: "main",
    commits: ["abc"],
    prs: ["https://example.com/pr/1"],
    files: ["src/a.ts"],
  },
  tasks: [],
  createdBy: "u",
  createdAuthor: { userId: "u", name: "Dominic" },
  createdActor: null,
  updatedBy: "u",
  updatedAuthor: { userId: "u", name: "Dominic" },
  updatedActor: null,
  acceptedBy: null,
  acceptor: null,
  acceptedAt: null,
  createdAt: "2026-09-11T00:00:00.000Z",
  updatedAt: "2026-09-11T00:00:00.000Z",
};
const old = {
  ...current,
  id: "old",
  number: 1,
  title: "Old",
  status: "accepted",
};
const Detail = (Route as unknown as { component: ComponentType }).component;

beforeEach(() => {
  mocks.navigate.mockReset();
  mocks.accept.mockReset().mockResolvedValue(current);
  mocks.search = { origin: "knowledge", status: "current", supersedes: "old" };
  mocks.decision
    .mockReset()
    .mockImplementation((_projectId: string, id?: string) => ({
      data: id === "old" ? old : id === "d1" ? current : undefined,
      isPending: false,
      isError: false,
    }));
  mocks.decisions.mockReset().mockReturnValue({
    data: { pages: [{ decisions: [old] }] },
    isError: false,
    hasNextPage: false,
  });
  vi.spyOn(window, "confirm").mockReturnValue(true);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("ADR 상세", () => {
  it("URL의 대체 대상을 명시적으로 비운 뒤 대체 없이 채택한다", async () => {
    render(<Detail />);
    fireEvent.change(screen.getByTestId("adr-supersedes-select"), {
      target: { value: "" },
    });
    fireEvent.click(screen.getByTestId("accept-adr"));
    await waitFor(() => expect(mocks.accept).toHaveBeenCalled());
    expect(mocks.accept.mock.calls[0]?.[0]).toEqual({
      projectId: "p",
      decisionId: "d1",
      expectedUpdatedAt: current.updatedAt,
    });
    expect(window.confirm).not.toHaveBeenCalled();
  });

  it("채택 목록 오류를 다시 시도하고 다음 페이지를 불러오며 참조를 모두 표시한다", () => {
    const refetch = vi.fn();
    const fetchNextPage = vi.fn();
    mocks.decisions.mockReturnValue({
      data: { pages: [{ decisions: [old] }] },
      isError: true,
      refetch,
      hasNextPage: true,
      fetchNextPage,
      isFetchingNextPage: false,
    });
    render(<Detail />);
    fireEvent.click(screen.getByText("agentLayer:adr.retry"));
    fireEvent.click(screen.getByText("agentLayer:adr.loadMoreAccepted"));
    expect(refetch).toHaveBeenCalledOnce();
    expect(fetchNextPage).toHaveBeenCalledOnce();
    for (const value of [
      "kaneo",
      "main",
      "abc",
      "https://example.com/pr/1",
      "src/a.ts",
      "Dominic",
    ]) {
      expect(screen.getByText(value)).toBeInTheDocument();
    }
  });

  it("태스크에서 연 상세는 원래 태스크로 돌아간다", () => {
    mocks.search = { origin: "task", taskId: "task-7", status: "current" };
    render(<Detail />);
    fireEvent.click(screen.getByText("agentLayer:adr.back"));
    expect(mocks.navigate).toHaveBeenCalledWith(
      expect.objectContaining({
        params: { workspaceId: "w", projectId: "p", taskId: "task-7" },
      }),
    );
  });
});
