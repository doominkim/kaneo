import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SidebarProvider } from "@/components/ui/sidebar";
import type { AgentDomainNode } from "@/fetchers/agent-layer/get-agent-domains";
import { NavDomains } from "./nav-domains";

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  params: vi.fn(),
  location: vi.fn(),
  domains: vi.fn(),
  canUpdateTasks: vi.fn(),
}));

vi.mock("react-i18next", () => ({
  initReactI18next: { type: "3rdParty", init: () => {} },
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => mocks.navigate,
  useParams: () => mocks.params(),
  useLocation: () => mocks.location(),
}));
vi.mock("@/hooks/queries/workspace/use-active-workspace", () => ({
  default: () => ({ data: { id: "ws" } }),
}));
vi.mock("@/hooks/queries/agent-layer/use-agent-domains", () => ({
  useAgentDomains: () => mocks.domains(),
}));
vi.mock("@/hooks/use-workspace-permission", () => ({
  useWorkspacePermission: () => ({ canUpdateTasks: mocks.canUpdateTasks }),
}));
vi.mock("./create-domain-dialog", () => ({
  CreateDomainDialog: ({
    open,
    parent,
  }: {
    open: boolean;
    parent: { id: string; title: string } | null;
  }) =>
    open ? (
      <div data-testid="create-dialog" data-parent={parent?.id ?? "root"} />
    ) : null,
}));

function node(
  id: string,
  parentId: string | null,
  title: string,
  proposedCount = 0,
): AgentDomainNode {
  return {
    id,
    parentId,
    slug: id,
    title,
    position: 0,
    updatedAt: "2026-09-03T00:00:00.000Z",
    childCount: 0,
    proposedCount,
    confirmedCount: 0,
    disputedCount: 0,
  };
}

const domains = [
  node("pharmacy", null, "약국", 3),
  node("pharmacist", "pharmacy", "약사"),
  node("inbound", "pharmacy", "입고내역", 1),
  node("lot", "inbound", "로트", 2),
  node("billing", null, "청구"),
];

const unfiled = { proposedCount: 2, confirmedCount: 5, disputedCount: 1 };

function renderNav() {
  // The sidebar provider reads the mobile media query.
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
  return render(
    <SidebarProvider>
      <NavDomains />
    </SidebarProvider>,
  );
}

/** The badge on a row, split into what is shown and what is announced. */
function badge(container: HTMLElement) {
  const el = within(container).queryByTestId("domain-pending");
  if (!el) return null;
  return {
    number: el.querySelector('[aria-hidden="true"]')?.textContent,
    label: el.querySelector(".sr-only")?.textContent,
  };
}

const rowBadge = (title: string) =>
  badge(
    screen
      .getByText(title)
      .closest('[data-testid="domain-node"]') as HTMLElement,
  );

const visibleIds = () =>
  screen
    .getAllByTestId("domain-node")
    .map((el) => el.getAttribute("data-domain-id"));

beforeEach(() => {
  mocks.navigate.mockReset();
  mocks.params.mockReturnValue({ workspaceId: "ws" });
  mocks.location.mockReturnValue({ pathname: "/dashboard/workspace/ws" });
  mocks.domains.mockReturnValue({
    data: { domains, unfiled },
    isPending: false,
  });
  mocks.canUpdateTasks.mockReturnValue(true);
});

afterEach(() => cleanup());

describe("NavDomains", () => {
  it("shows the roots collapsed and expands a branch on its chevron", () => {
    renderNav();
    expect(visibleIds()).toEqual(["pharmacy", "billing"]);

    const [toggle] = screen.getAllByTestId("domain-toggle");
    fireEvent.click(toggle);
    expect(visibleIds()).toEqual([
      "pharmacy",
      "pharmacist",
      "inbound",
      "billing",
    ]);
    expect(
      screen.getByText("약사").closest('[data-testid="domain-node"]'),
    ).toHaveAttribute("data-depth", "1");
    expect(mocks.navigate).not.toHaveBeenCalled();
  });

  it("opens the ancestors of the current page and highlights it", () => {
    mocks.params.mockReturnValue({ workspaceId: "ws", domainId: "lot" });
    renderNav();
    expect(visibleIds()).toEqual([
      "pharmacy",
      "pharmacist",
      "inbound",
      "lot",
      "billing",
    ]);
    const active = screen
      .getByText("로트")
      .closest('[data-testid="domain-node"]');
    expect(active?.querySelector("[data-active]")).toHaveAttribute(
      "data-active",
      "true",
    );
  });

  it("navigates to the page on click", () => {
    renderNav();
    fireEvent.click(screen.getByText("청구"));
    expect(mocks.navigate).toHaveBeenCalledWith({
      to: "/dashboard/workspace/$workspaceId/domain/$domainId",
      params: { workspaceId: "ws", domainId: "billing" },
    });
  });

  it("offers root and child creation with task:update", () => {
    renderNav();
    fireEvent.click(screen.getByTestId("add-root-domain"));
    expect(screen.getByTestId("create-dialog")).toHaveAttribute(
      "data-parent",
      "root",
    );
  });

  it("targets the row's page when adding a sub-domain", () => {
    renderNav();
    fireEvent.click(screen.getAllByTestId("add-child-domain")[1]);
    expect(screen.getByTestId("create-dialog")).toHaveAttribute(
      "data-parent",
      "billing",
    );
  });

  it("hides every create control without task:update", () => {
    mocks.canUpdateTasks.mockReturnValue(false);
    renderNav();
    expect(screen.queryByTestId("add-root-domain")).not.toBeInTheDocument();
    expect(screen.queryAllByTestId("add-child-domain")).toHaveLength(0);
  });

  it("badges a collapsed branch with everything waiting under it", () => {
    renderNav();
    // 3 on the page itself, 1 on `inbound`, 2 on the grandchild `lot`: the
    // whole branch is hidden while collapsed, so the row has to carry it.
    expect(rowBadge("약국")).toEqual({
      number: "6",
      label: "agentLayer:domain.pendingReviewSubtree",
    });

    // A page with nothing pending anywhere carries no number at all: a zero
    // badge is noise on every row that is already done.
    expect(rowBadge("청구")).toBeNull();
  });

  it("drops back to the page's own count once the branch is open", () => {
    renderNav();
    fireEvent.click(screen.getAllByTestId("domain-toggle")[0]);
    // The children now draw their own badges, so a parent still showing the
    // total would look like the same items counted twice.
    expect(rowBadge("약국")).toEqual({
      number: "3",
      label: "agentLayer:domain.pendingReview",
    });
    // `inbound` is itself collapsed and hides `lot`'s two.
    expect(rowBadge("입고내역")).toEqual({
      number: "3",
      label: "agentLayer:domain.pendingReviewSubtree",
    });
    expect(rowBadge("약사")).toBeNull();

    fireEvent.click(screen.getAllByTestId("domain-toggle")[1]);
    expect(rowBadge("입고내역")).toEqual({
      number: "1",
      label: "agentLayer:domain.pendingReview",
    });
    // A leaf has no rollup of its own to announce.
    expect(rowBadge("로트")).toEqual({
      number: "2",
      label: "agentLayer:domain.pendingReview",
    });
  });

  it("badges nothing when the whole tree is clear", () => {
    mocks.domains.mockReturnValue({
      data: {
        domains: domains.map((d) => ({ ...d, proposedCount: 0 })),
        unfiled: { ...unfiled, proposedCount: 0 },
      },
      isPending: false,
    });
    renderNav();
    expect(screen.queryAllByTestId("domain-pending")).toHaveLength(0);
  });

  it("keeps the unfiled bucket last, counted from the workspace total", () => {
    renderNav();
    const rows = screen.getAllByTestId(/^domain-(node|unfiled)$/);
    expect(rows.at(-1)).toHaveAttribute("data-testid", "domain-unfiled");

    const unfiledRow = screen.getByTestId("domain-unfiled");
    expect(unfiledRow).toHaveTextContent("agentLayer:domain.unfiled");
    // The bucket has no sub-tree, so the rollup never applies to it.
    expect(badge(unfiledRow)).toEqual({
      number: "2",
      label: "agentLayer:domain.pendingReview",
    });

    fireEvent.click(screen.getByText("agentLayer:domain.unfiled"));
    expect(mocks.navigate).toHaveBeenCalledWith({
      to: "/dashboard/workspace/$workspaceId/domain/unfiled",
      params: { workspaceId: "ws" },
    });
  });

  it("still offers the unfiled bucket with nothing waiting, and marks it active", () => {
    mocks.location.mockReturnValue({
      pathname: "/dashboard/workspace/ws/domain/unfiled",
    });
    mocks.domains.mockReturnValue({
      data: { domains, unfiled: { ...unfiled, proposedCount: 0 } },
      isPending: false,
    });
    renderNav();
    const unfiledRow = screen.getByTestId("domain-unfiled");
    expect(within(unfiledRow).queryByTestId("domain-pending")).toBeNull();
    expect(unfiledRow.querySelector("[data-active]")).toHaveAttribute(
      "data-active",
      "true",
    );
  });

  it("says so when the workspace has no pages", () => {
    mocks.domains.mockReturnValue({
      data: { domains: [], unfiled: { ...unfiled, proposedCount: 0 } },
      isPending: false,
    });
    renderNav();
    expect(screen.getByTestId("domain-tree-empty")).toHaveTextContent(
      "agentLayer:domain.noneYet",
    );
  });
});
