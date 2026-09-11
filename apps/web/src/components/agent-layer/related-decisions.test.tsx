import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RelatedDecisions } from "./related-decisions";

const mocks = vi.hoisted(() => ({ query: vi.fn(), link: vi.fn() }));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, search }: { children: ReactNode; search: unknown }) => {
    mocks.link(search);
    return <a href="/decision">{children}</a>;
  },
}));
vi.mock("@/hooks/queries/agent-layer/use-agent-decisions", () => ({
  useAgentDecisions: mocks.query,
}));
vi.mock("./adr-editor-dialog", () => ({ AdrEditorDialog: () => null }));

beforeEach(() => {
  mocks.link.mockReset();
  mocks.query.mockReset().mockReturnValue({
    isPending: false,
    isError: false,
    hasNextPage: false,
    data: {
      pages: [
        {
          decisions: [
            { id: "d1", number: 9, title: "Old choice", status: "superseded" },
          ],
        },
      ],
    },
  });
});
afterEach(cleanup);

describe("태스크의 관련 결정", () => {
  it("제목과 상태만 간결하게 표시하고 태스크 출처를 상세 링크에 담는다", () => {
    render(
      <RelatedDecisions
        projectId="p"
        workspaceId="w"
        taskId="task-1"
        canWrite={false}
      />,
    );
    expect(screen.getByText("Old choice")).toBeInTheDocument();
    expect(
      screen.getByText("agentLayer:adr.statusSuperseded"),
    ).toBeInTheDocument();
    expect(screen.queryByText("ADR-009")).not.toBeInTheDocument();
    expect(mocks.link).toHaveBeenCalledWith({
      origin: "task",
      taskId: "task-1",
    });
  });

  it("오류에서 다시 시도하고 다음 페이지를 더 불러온다", () => {
    const refetch = vi.fn();
    mocks.query.mockReturnValue({
      isPending: false,
      isError: true,
      refetch,
      hasNextPage: false,
    });
    const { rerender } = render(
      <RelatedDecisions projectId="p" workspaceId="w" taskId="t" canWrite />,
    );
    fireEvent.click(screen.getByText("agentLayer:adr.retry"));
    expect(refetch).toHaveBeenCalledOnce();

    const fetchNextPage = vi.fn();
    mocks.query.mockReturnValue({
      isPending: false,
      isError: false,
      hasNextPage: true,
      isFetchingNextPage: false,
      fetchNextPage,
      data: { pages: [{ decisions: [] }] },
    });
    rerender(
      <RelatedDecisions projectId="p" workspaceId="w" taskId="t" canWrite />,
    );
    fireEvent.click(screen.getByText("agentLayer:adr.loadMore"));
    expect(fetchNextPage).toHaveBeenCalledOnce();
  });
});
