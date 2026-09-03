import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SidebarProvider } from "@/components/ui/sidebar";
import type { AgentDomainNode } from "@/fetchers/agent-layer/get-agent-domains";
import { NavDomains } from "./nav-domains";

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  params: vi.fn(),
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
): AgentDomainNode {
  return {
    id,
    parentId,
    slug: id,
    title,
    position: 0,
    updatedAt: "2026-09-03T00:00:00.000Z",
    childCount: 0,
  };
}

const domains = [
  node("pharmacy", null, "약국"),
  node("pharmacist", "pharmacy", "약사"),
  node("inbound", "pharmacy", "입고내역"),
  node("lot", "inbound", "로트"),
  node("billing", null, "청구"),
];

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

const visibleIds = () =>
  screen
    .getAllByTestId("domain-node")
    .map((el) => el.getAttribute("data-domain-id"));

beforeEach(() => {
  mocks.navigate.mockReset();
  mocks.params.mockReturnValue({ workspaceId: "ws" });
  mocks.domains.mockReturnValue({
    data: { domains },
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

  it("says so when the workspace has no pages", () => {
    mocks.domains.mockReturnValue({ data: { domains: [] }, isPending: false });
    renderNav();
    expect(screen.getByTestId("domain-tree-empty")).toHaveTextContent(
      "agentLayer:domain.noneYet",
    );
  });
});
