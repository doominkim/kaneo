import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AdrList } from "./adr-list";

const mocks = vi.hoisted(() => ({
  decisions: vi.fn(),
  navigate: vi.fn(),
  restore: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));
vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => mocks.navigate,
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      options ? `${key}:${JSON.stringify(options)}` : key,
  }),
}));
vi.mock("@/lib/format", () => ({
  formatRelativeTime: () => "2 hours ago",
  formatDateTime: () => "Sep 14, 2026",
}));
vi.mock("@/lib/toast", () => ({
  toast: { success: mocks.toastSuccess, error: mocks.toastError },
}));
vi.mock("@/hooks/queries/agent-layer/use-agent-decisions", () => ({
  useAgentDecisions: mocks.decisions,
}));
vi.mock("@/hooks/mutations/agent-layer/use-agent-decisions", () => ({
  useRestoreAgentDecision: () => ({
    mutateAsync: mocks.restore,
    isPending: false,
    variables: undefined,
  }),
}));
vi.mock("@/hooks/queries/agent-layer/use-member-names", () => ({
  useMemberNames: () => new Map([["u2", "Mina"]]),
}));
vi.mock("./adr-editor-dialog", () => ({ AdrEditorDialog: () => null }));

const result = {
  id: "d1",
  number: 2,
  title: "Redis stays optional",
  status: "accepted" as const,
  contextPreview: "Single-node installs remain simple.",
  tasks: [{ id: "t1", number: 4, title: "Deploy" }],
  reviewed: true,
  deletedAt: null as string | null,
  deletedBy: null as string | null,
  createdAt: "2026-09-11T00:00:00.000Z",
};
const deleted = {
  ...result,
  id: "d9",
  number: 9,
  title: "Dropped idea",
  status: "superseded" as const,
  deletedAt: "2026-09-14T01:00:00.000Z",
  deletedBy: "u2",
};

function page(decisions: unknown[]) {
  return {
    isPending: false,
    isError: false,
    data: { pages: [{ decisions }] },
    hasNextPage: false,
  };
}

beforeEach(() => {
  mocks.navigate.mockReset();
  mocks.restore.mockReset().mockResolvedValue({});
  mocks.toastSuccess.mockReset();
  mocks.toastError.mockReset();
  mocks.decisions
    .mockReset()
    .mockImplementation(({ status }: { status: string }) =>
      page(status === "deleted" ? [deleted] : [result]),
    );
});
afterEach(cleanup);

describe("ADR 목록", () => {
  it("상태와 검색 조건을 서버 쿼리에 전달하고 상세로 이동한다", () => {
    render(<AdrList projectId="p" workspaceId="w" canWrite />);
    expect(mocks.decisions).toHaveBeenLastCalledWith(
      expect.objectContaining({ projectId: "p", status: "current" }),
    );
    fireEvent.change(screen.getByTestId("adr-search"), {
      target: { value: "Redis" },
    });
    fireEvent.change(screen.getByTestId("adr-status-filter"), {
      target: { value: "accepted" },
    });
    expect(mocks.decisions).toHaveBeenLastCalledWith(
      expect.objectContaining({ status: "accepted", q: "Redis" }),
    );
    fireEvent.click(screen.getByTestId("adr-row-d1"));
    expect(mocks.navigate).toHaveBeenCalledWith(
      expect.objectContaining({
        params: { workspaceId: "w", projectId: "p", decisionId: "d1" },
        search: { origin: "knowledge", status: "accepted", q: "Redis" },
      }),
    );
  });

  it("초안 필터가 없고 삭제됨 필터가 있다", () => {
    render(<AdrList projectId="p" workspaceId="w" canWrite />);
    const options = Array.from(
      screen.getByTestId("adr-status-filter").querySelectorAll("option"),
    ).map((option) => option.getAttribute("value"));
    expect(options).toEqual([
      "current",
      "accepted",
      "superseded",
      "all",
      "deleted",
    ]);
  });

  it("미확인 ADR 행에 미확인 표시를 붙인다", () => {
    mocks.decisions.mockReturnValue(page([{ ...result, reviewed: false }]));
    render(<AdrList projectId="p" workspaceId="w" canWrite />);
    expect(
      within(screen.getByTestId("adr-row-d1")).getByTestId("unreviewed-badge"),
    ).toBeInTheDocument();
  });

  it("[REQ-AGENT-AUTOAPPLY-18] 삭제됨 필터는 삭제된 ADR을 삭제자·시각·복구 버튼과 함께 보여준다", async () => {
    render(<AdrList projectId="p" workspaceId="w" canWrite canManage />);
    fireEvent.change(screen.getByTestId("adr-status-filter"), {
      target: { value: "deleted" },
    });
    expect(mocks.decisions).toHaveBeenLastCalledWith(
      expect.objectContaining({ status: "deleted" }),
    );

    const row = screen.getByTestId("adr-deleted-row-d9");
    const stamp = within(row).getByTestId("deleted-stamp");
    expect(stamp).toHaveTextContent(
      'agentLayer:common.deletedBy:{"name":"Mina","when":"2 hours ago"}',
    );
    expect(stamp).toHaveAttribute("title", "Sep 14, 2026");
    // The API does not find a deleted ADR, so there is no detail to open.
    expect(screen.queryByTestId("adr-row-d9")).toBeNull();

    fireEvent.click(within(row).getByTestId("restore-adr"));
    await waitFor(() =>
      expect(mocks.restore).toHaveBeenCalledWith({
        projectId: "p",
        decisionId: "d9",
      }),
    );
    expect(mocks.toastSuccess).toHaveBeenCalledWith(
      'agentLayer:adr.restored:{"number":"009"}',
    );
  });

  it("[REQ-AGENT-AUTOAPPLY-18] project:update 없이는 삭제된 ADR을 복구할 수 없다", () => {
    render(
      <AdrList
        projectId="p"
        workspaceId="w"
        canWrite
        initialStatus="deleted"
      />,
    );
    expect(screen.getByTestId("adr-deleted-row-d9")).toBeInTheDocument();
    expect(screen.queryByTestId("restore-adr")).toBeNull();
  });

  it("빈 목록과 권한 없는 작성 버튼을 구분한다", () => {
    mocks.decisions.mockReturnValue(page([]));
    render(<AdrList projectId="p" workspaceId="w" canWrite={false} />);
    expect(screen.getByText("agentLayer:adr.empty")).toBeInTheDocument();
    expect(screen.queryByTestId("create-adr")).not.toBeInTheDocument();
  });

  it("조회 실패에서 다시 시도한다", () => {
    const refetch = vi.fn();
    mocks.decisions.mockReturnValue({
      isPending: false,
      isError: true,
      refetch,
      data: undefined,
      hasNextPage: false,
    });
    render(<AdrList projectId="p" workspaceId="w" canWrite />);
    fireEvent.click(screen.getByText("agentLayer:adr.retry"));
    expect(refetch).toHaveBeenCalledOnce();
  });
});
