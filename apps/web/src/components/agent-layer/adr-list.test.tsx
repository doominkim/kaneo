import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AdrList } from "./adr-list";

const mocks = vi.hoisted(() => ({ decisions: vi.fn(), navigate: vi.fn() }));
vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => mocks.navigate,
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("@/hooks/queries/agent-layer/use-agent-decisions", () => ({
  useAgentDecisions: mocks.decisions,
}));
vi.mock("./adr-editor-dialog", () => ({ AdrEditorDialog: () => null }));

const result = {
  id: "d1",
  number: 2,
  title: "Redis stays optional",
  status: "accepted" as const,
  contextPreview: "Single-node installs remain simple.",
  tasks: [{ id: "t1", number: 4, title: "Deploy" }],
  createdAt: "2026-09-11T00:00:00.000Z",
};
beforeEach(() =>
  mocks.decisions.mockReset().mockReturnValue({
    isPending: false,
    isError: false,
    data: { pages: [{ decisions: [result] }] },
    hasNextPage: false,
  }),
);
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
  it("빈 목록과 권한 없는 작성 버튼을 구분한다", () => {
    mocks.decisions.mockReturnValue({
      isPending: false,
      isError: false,
      data: { pages: [{ decisions: [] }] },
      hasNextPage: false,
    });
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
