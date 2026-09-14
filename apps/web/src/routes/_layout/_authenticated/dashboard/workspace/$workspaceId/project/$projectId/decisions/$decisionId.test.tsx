import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import type { ComponentType, ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AgentLayerApiError } from "@/fetchers/agent-layer/api-error";
import { Route } from "./$decisionId";

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  decision: vi.fn(),
  review: vi.fn(),
  remove: vi.fn(),
  restore: vi.fn(),
  canUpdateProjects: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
  search: {
    origin: "knowledge",
    status: "current",
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
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      options ? `${key}:${JSON.stringify(options)}` : key,
  }),
}));
vi.mock("@/lib/format", () => ({
  formatRelativeTime: () => "just now",
  formatDateTime: () => "Sep 14, 2026",
}));
vi.mock("@/lib/toast", () => ({
  toast: { success: mocks.toastSuccess, error: mocks.toastError },
}));
vi.mock("@/components/common/project-layout", () => ({
  default: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/page-title", () => ({ default: () => null }));
vi.mock("@/components/agent-layer/adr-editor-dialog", () => ({
  AdrEditorDialog: ({
    open,
    supersedes,
  }: {
    open: boolean;
    supersedes?: { id: string };
  }) =>
    open ? (
      <div data-testid="adr-editor" data-supersedes={supersedes?.id} />
    ) : null,
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
    canUpdateProjects: mocks.canUpdateProjects,
  }),
}));
vi.mock("@/hooks/mutations/agent-layer/use-agent-decisions", () => ({
  useReviewAgentDecision: () => ({
    mutateAsync: mocks.review,
    isPending: false,
  }),
  useDeleteAgentDecision: () => ({
    mutateAsync: mocks.remove,
    isPending: false,
  }),
  useRestoreAgentDecision: () => ({
    mutateAsync: mocks.restore,
    isPending: false,
  }),
}));
vi.mock("@/hooks/queries/agent-layer/use-agent-decisions", () => ({
  useAgentDecision: mocks.decision,
}));
vi.mock("@/hooks/queries/agent-layer/use-member-names", () => ({
  useMemberNames: () =>
    new Map([
      ["u", "Dominic"],
      ["u2", "Mina"],
    ]),
}));

const current = {
  id: "d1",
  workspaceId: "w",
  projectId: "p",
  number: 3,
  title: "Current",
  status: "accepted",
  context: "Context",
  decision: "Decision",
  alternatives: null,
  consequences: null,
  sourceNote: "Source note",
  reversible: null,
  sourceEntryId: null,
  supersedesDecisionId: "old",
  supersedes: { id: "old", number: 1, title: "Old", status: "superseded" },
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
  acceptedAt: "2026-09-11T00:00:00.000Z",
  reviewed: true,
  reviewedAt: "2026-09-12T00:00:00.000Z",
  reviewedBy: "u2",
  deletedAt: null,
  deletedBy: null,
  createdAt: "2026-09-11T00:00:00.000Z",
  updatedAt: "2026-09-11T00:00:00.000Z",
};
const loaded = (data: unknown) => ({
  data,
  isPending: false,
  isError: false,
  error: null,
});
const Detail = (Route as unknown as { component: ComponentType }).component;

beforeEach(() => {
  mocks.navigate.mockReset();
  mocks.review.mockReset().mockResolvedValue(current);
  mocks.remove.mockReset();
  mocks.restore.mockReset().mockResolvedValue(current);
  mocks.canUpdateProjects.mockReset().mockReturnValue(true);
  mocks.toastSuccess.mockReset();
  mocks.toastError.mockReset();
  mocks.search = { origin: "knowledge", status: "current" };
  mocks.decision.mockReset().mockReturnValue(loaded(current));
});
afterEach(() => cleanup());

describe("ADR 상세", () => {
  it("[REQ-AGENT-AUTOAPPLY-8] 미확인 ADR 상세를 열면 한 번만 확인 처리하고 이번 방문 동안 표시를 남긴다", () => {
    mocks.decision.mockReturnValue(
      loaded({
        ...current,
        reviewed: false,
        reviewedAt: null,
        reviewedBy: null,
      }),
    );
    const { rerender } = render(<Detail />);
    expect(mocks.review).toHaveBeenCalledTimes(1);
    expect(mocks.review).toHaveBeenCalledWith({
      projectId: "p",
      decisionId: "d1",
    });
    expect(screen.getByTestId("unreviewed-badge")).toBeInTheDocument();

    mocks.decision.mockReturnValue(loaded(current));
    rerender(<Detail />);
    expect(mocks.review).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("unreviewed-badge")).toBeInTheDocument();
    expect(screen.getByTestId("adr-reviewer")).toHaveTextContent("Mina");
  });

  it("확인된 ADR은 다시 확인하지 않고, 채택·편집·초안 흐름 대신 대체만 준다", () => {
    render(<Detail />);
    expect(mocks.review).not.toHaveBeenCalled();
    expect(screen.queryByTestId("unreviewed-badge")).toBeNull();
    expect(screen.queryByTestId("accept-adr")).toBeNull();
    expect(screen.queryByTestId("adr-supersedes-select")).toBeNull();
    expect(screen.getByTestId("adr-status")).toHaveTextContent(
      "agentLayer:adr.statusAccepted",
    );

    fireEvent.click(screen.getByTestId("supersede-adr"));
    expect(screen.getByTestId("adr-editor")).toHaveAttribute(
      "data-supersedes",
      "d1",
    );
  });

  it("[REQ-AGENT-AUTOAPPLY-18] 삭제는 확인 대화상자를 거치고, 삭제 뒤 삭제자·시각과 복구 버튼을 보여준다", async () => {
    mocks.remove.mockResolvedValue({
      id: "d1",
      deletedAt: "2026-09-14T02:00:00.000Z",
      deletedBy: "u2",
      restoredDecisionId: "old",
    });
    render(<Detail />);
    fireEvent.click(screen.getByTestId("delete-adr"));
    const dialog = await screen.findByTestId("delete-adr-dialog");
    expect(dialog).toHaveTextContent(
      'agentLayer:adr.deleteTitle:{"number":"003"}',
    );
    expect(dialog).toHaveTextContent(
      'agentLayer:adr.deleteRestoresPrevious:{"number":"001"}',
    );
    expect(mocks.remove).not.toHaveBeenCalled();

    // The refetch after the delete no longer finds the ADR.
    mocks.decision.mockReturnValue({
      data: undefined,
      isPending: false,
      isError: true,
      error: new AgentLayerApiError(404, "ADR not found"),
    });
    fireEvent.click(within(dialog).getByTestId("delete-adr-submit"));
    await waitFor(() =>
      expect(mocks.remove).toHaveBeenCalledWith({
        projectId: "p",
        decisionId: "d1",
      }),
    );

    const banner = await screen.findByTestId("adr-deleted-banner");
    expect(within(banner).getByTestId("deleted-stamp")).toHaveTextContent(
      'agentLayer:common.deletedBy:{"name":"Mina","when":"just now"}',
    );
    expect(banner).toHaveTextContent(
      'agentLayer:adr.restoredPrevious:{"number":"001"}',
    );
    expect(screen.getByTestId("adr-deleted")).toBeInTheDocument();
    expect(screen.queryByTestId("delete-adr")).toBeNull();
    expect(screen.queryByTestId("supersede-adr")).toBeNull();

    fireEvent.click(within(banner).getByTestId("restore-adr"));
    await waitFor(() =>
      expect(mocks.restore).toHaveBeenCalledWith({
        projectId: "p",
        decisionId: "d1",
      }),
    );
  });

  it("[REQ-AGENT-AUTOAPPLY-18] project:update가 없으면 삭제 버튼이 없다", () => {
    mocks.canUpdateProjects.mockReturnValue(false);
    render(<Detail />);
    expect(screen.queryByTestId("delete-adr")).toBeNull();
  });

  it("대체된 ADR은 대체한 ADR로 가는 안내를 먼저 보여주고 다시 대체하게 하지 않는다", () => {
    mocks.decision.mockReturnValue(
      loaded({
        ...current,
        status: "superseded",
        supersededBy: {
          id: "new",
          number: 4,
          title: "Newer",
          status: "accepted",
        },
      }),
    );
    render(<Detail />);
    const banner = screen.getByTestId("adr-superseded-banner");
    expect(banner).toHaveTextContent(
      'agentLayer:adr.supersededByRecord:{"number":"004","title":"Newer"}',
    );
    expect(screen.getByTestId("adr-status")).toHaveTextContent(
      "agentLayer:adr.statusSuperseded",
    );
    expect(screen.queryByTestId("supersede-adr")).toBeNull();

    fireEvent.click(within(banner).getByText("agentLayer:adr.openRecord"));
    expect(mocks.navigate).toHaveBeenCalledWith(
      expect.objectContaining({
        params: { workspaceId: "w", projectId: "p", decisionId: "new" },
      }),
    );
  });

  it("없거나 삭제된 ADR은 삭제됨 필터를 안내한다", () => {
    mocks.decision.mockReturnValue({
      data: undefined,
      isPending: false,
      isError: true,
      error: new AgentLayerApiError(404, "ADR not found"),
    });
    render(<Detail />);
    expect(screen.getByText("agentLayer:adr.notFound")).toBeInTheDocument();
  });

  it("참조를 모두 표시하고, 태스크에서 연 상세는 원래 태스크로 돌아간다", () => {
    mocks.search = { origin: "task", taskId: "task-7", status: "current" };
    render(<Detail />);
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
    fireEvent.click(screen.getByText("agentLayer:adr.back"));
    expect(mocks.navigate).toHaveBeenCalledWith(
      expect.objectContaining({
        params: { workspaceId: "w", projectId: "p", taskId: "task-7" },
      }),
    );
  });
});
