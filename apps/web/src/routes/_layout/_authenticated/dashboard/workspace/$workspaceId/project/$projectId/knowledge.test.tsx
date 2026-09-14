import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import type { ComponentType, ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentTerm } from "@/fetchers/agent-layer/get-agent-terms";
import { Route } from "./knowledge";

const mocks = vi.hoisted(() => ({
  terms: vi.fn(),
  counts: vi.fn(),
  adrList: vi.fn(),
  canUpdateWorkspace: vi.fn(),
  canUpdateTasks: vi.fn(),
  canUpdateProjects: vi.fn(),
  navigate: vi.fn(),
  search: {
    tab: "knowledge",
    status: "current",
    q: undefined as string | undefined,
  },
}));

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (options: Record<string, unknown>) => ({
    ...options,
    useParams: () => ({ workspaceId: "ws", projectId: "p1" }),
    useSearch: () => mocks.search,
  }),
  useNavigate: () => mocks.navigate,
  Link: ({ children }: { children: ReactNode }) => <a href="/">{children}</a>,
}));
vi.mock("react-i18next", () => ({
  initReactI18next: { type: "3rdParty", init: () => {} },
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("@/lib/format", () => ({
  formatRelativeTime: () => "2 hours ago",
  formatDateTime: () => "Sep 3, 2026",
}));
vi.mock("@/lib/toast", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));
vi.mock("@/components/public-project/markdown-renderer", () => ({
  MarkdownRenderer: ({ content }: { content: string }) => <div>{content}</div>,
}));
vi.mock("@/components/common/project-layout", () => ({
  default: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/page-title", () => ({ default: () => null }));
vi.mock("@/components/agent-layer/decision-list", () => ({
  DecisionList: () => <div data-testid="decision-list" />,
}));
vi.mock("@/components/agent-layer/adr-list", () => ({
  AdrList: (props: { canManage?: boolean }) => {
    mocks.adrList(props);
    return <div data-testid="adr-list" />;
  },
}));
vi.mock("@/components/agent-layer/entry-detail-sheet", () => ({
  EntryDetailSheet: () => null,
}));
vi.mock("@/components/agent-layer/propose-term-dialog", () => ({
  ProposeTermDialog: () => null,
}));
vi.mock("@/components/agent-layer/term-resolve", () => ({
  TermResolve: () => <div data-testid="term-resolve" />,
}));
vi.mock("@/components/agent-layer/domain-select", () => ({
  DomainSelect: () => <span data-testid="term-domain-select" />,
}));
vi.mock("@/hooks/queries/agent-layer/use-agent-task-index", () => ({
  useAgentTaskIndex: () => ({ taskNumberById: new Map() }),
}));
vi.mock("@/hooks/queries/project/use-get-project", () => ({
  default: () => ({ data: { name: "Vanpharm", slug: "VAN" } }),
}));
vi.mock("@/hooks/use-workspace-permission", () => ({
  useWorkspacePermission: () => ({
    canUpdateWorkspace: mocks.canUpdateWorkspace,
    canUpdateTasks: mocks.canUpdateTasks,
    canUpdateProjects: mocks.canUpdateProjects,
  }),
}));
vi.mock("@/hooks/queries/agent-layer/use-agent-terms", () => ({
  useAgentTerms: mocks.terms,
}));
vi.mock("@/hooks/queries/agent-layer/use-agent-unreviewed-counts", () => ({
  useAgentUnreviewedCounts: mocks.counts,
}));
vi.mock("@/hooks/queries/agent-layer/use-member-names", () => ({
  useMemberNames: () => new Map(),
}));
vi.mock("@/hooks/mutations/agent-layer/use-confirm-agent-term", () => ({
  useConfirmAgentTerm: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock("@/hooks/mutations/agent-layer/use-delete-agent-term", () => ({
  useDeleteAgentTerm: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock("@/hooks/mutations/agent-layer/use-restore-agent-term", () => ({
  useRestoreAgentTerm: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock("@/hooks/mutations/agent-layer/use-set-agent-term-domain", () => ({
  useSetAgentTermDomain: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock("@/hooks/queries/agent-layer/use-agent-domains", () => ({
  useAgentDomains: () => ({ data: { domains: [] }, isPending: false }),
}));

const KnowledgeTab = (Route as unknown as { component: ComponentType })
  .component;

const term: AgentTerm = {
  id: "t1",
  canonical: "급여코드",
  definition: null,
  aliases: [],
  notToConfuseWith: [],
  anchors: [],
  confidence: "confirmed",
  state: "active",
  supersededBy: null,
  domainId: null,
  actorId: null,
  actor: null,
  reviewerId: null,
  reviewer: null,
  reviewedAt: null,
  reviewed: true,
  rejectReason: null,
  lastVerifiedAt: null,
  deletedAt: null,
  deletedBy: null,
  createdAt: "2026-09-03T00:00:00.000Z",
};

const countOn = (tab: HTMLElement) =>
  within(tab)
    .queryByTestId("unreviewed-count")
    ?.querySelector('[aria-hidden="true"]')?.textContent ?? null;

beforeEach(() => {
  mocks.search = { tab: "knowledge", status: "current", q: undefined };
  mocks.navigate.mockReset();
  mocks.adrList.mockReset();
  mocks.canUpdateWorkspace.mockReturnValue(true);
  mocks.canUpdateTasks.mockReturnValue(true);
  mocks.canUpdateProjects.mockReturnValue(true);
  mocks.counts
    .mockReset()
    .mockReturnValue({ feature: 0, terms: 0, decisions: 0, knowledge: 0 });
  mocks.terms.mockReset().mockReturnValue({
    isPending: false,
    isError: false,
    data: { terms: [term] },
    refetch: vi.fn(),
  });
});

afterEach(() => cleanup());

describe("지식 탭", () => {
  it("에이전트가 읽는 확정 항목을 보여주고, 확정·이의는 도메인 페이지에 두되 삭제는 여기서도 준다", () => {
    render(<KnowledgeTab />);

    // Confirmed only, and still the whole workspace: narrowing this tab to the
    // project's domains is a separate decision (KAN-16 keeps the scope).
    expect(mocks.terms).toHaveBeenLastCalledWith("ws", {
      confidence: "confirmed",
      state: undefined,
      domainId: undefined,
    });

    // Confirm and dispute still live on the domain page.
    expect(screen.queryByTestId("confirm-term")).not.toBeInTheDocument();
    expect(screen.queryByTestId("dispute-term")).not.toBeInTheDocument();
    expect(screen.queryByTestId("confidence-filter")).not.toBeInTheDocument();
    // A soft delete is reversible, so workspace:update gets it here too.
    expect(screen.getByTestId("delete-term")).toBeInTheDocument();

    expect(screen.getByTestId("review-elsewhere")).toHaveTextContent(
      "agentLayer:knowledge.reviewElsewhere",
    );
  });

  it("[REQ-AGENT-AUTOAPPLY-18] 지식 항목 목록의 삭제됨 필터는 삭제된 항목을 조회한다", () => {
    render(<KnowledgeTab />);
    fireEvent.click(
      within(screen.getByTestId("deleted-filter")).getByText(
        "agentLayer:common.filterDeleted",
      ),
    );
    expect(mocks.terms).toHaveBeenLastCalledWith("ws", {
      domainId: undefined,
      deleted: true,
    });
  });

  it("[REQ-AGENT-AUTOAPPLY-10] 지식 항목·결정 기록 탭에 삭제되지 않은 미확인 수를 보여주고 0이면 숨긴다", () => {
    mocks.counts.mockReturnValue({
      feature: 1,
      terms: 2,
      decisions: 3,
      knowledge: 5,
    });
    const { rerender } = render(<KnowledgeTab />);
    expect(mocks.counts).toHaveBeenCalledWith("p1", "ws");
    expect(countOn(screen.getByTestId("knowledge-items-tab"))).toBe("2");
    expect(countOn(screen.getByTestId("adr-tab"))).toBe("3");

    mocks.counts.mockReturnValue({
      feature: 0,
      terms: 0,
      decisions: 3,
      knowledge: 3,
    });
    rerender(<KnowledgeTab />);
    expect(countOn(screen.getByTestId("knowledge-items-tab"))).toBeNull();
  });

  it("지식 제안 기능과 결정 기록 하위 탭을 함께 제공한다", () => {
    const { rerender } = render(<KnowledgeTab />);
    expect(screen.getByTestId("propose-term")).toBeInTheDocument();
    expect(screen.getByTestId("term-resolve")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("adr-tab"));
    expect(mocks.navigate).toHaveBeenCalledWith(
      expect.objectContaining({
        search: expect.objectContaining({ tab: "decisions" }),
      }),
    );
    mocks.search = { tab: "decisions", status: "current", q: undefined };
    rerender(<KnowledgeTab />);
    expect(screen.getByTestId("decision-list")).toBeInTheDocument();
    expect(mocks.adrList).toHaveBeenLastCalledWith(
      expect.objectContaining({ canManage: true }),
    );
  });
});
