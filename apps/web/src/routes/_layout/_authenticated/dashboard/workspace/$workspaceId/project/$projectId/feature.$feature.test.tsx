import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ComponentType, ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AgentLayerApiError } from "@/fetchers/agent-layer/api-error";
import { Route } from "./feature.$feature";

const mocks = vi.hoisted(() => ({
  set: vi.fn(),
  design: vi.fn(),
  putSet: vi.fn(),
  putDesign: vi.fn(),
  navigate: vi.fn(),
  search: { tab: "requirements", edit: undefined as boolean | undefined },
}));

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (options: Record<string, unknown>) => ({
    ...options,
    useParams: () => ({
      workspaceId: "ws",
      projectId: "p1",
      feature: "feature-hub",
    }),
    useSearch: () => mocks.search,
  }),
  useNavigate: () => mocks.navigate,
  Link: ({ children }: { children: ReactNode }) => <a href="/">{children}</a>,
}));
vi.mock("react-i18next", () => ({
  initReactI18next: { type: "3rdParty", init: () => {} },
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("@/lib/toast", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/components/common/project-layout", () => ({
  default: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/page-title", () => ({ default: () => null }));
vi.mock("@/components/agent-layer/requirement-set-page", () => ({
  RequirementSetPage: ({
    set,
    embedded,
  }: {
    set: { feature: string };
    embedded?: boolean;
  }) => (
    <div data-testid="requirement-set-page" data-embedded={String(embedded)}>
      {set.feature}
    </div>
  ),
}));
vi.mock("@/components/agent-layer/design-page", () => ({
  DesignPage: ({ design }: { design: { feature: string } }) => (
    <div data-testid="design-page">{design.feature}</div>
  ),
}));
vi.mock("@/components/agent-layer/feature-tasks", () => ({
  FeatureTasks: ({
    feature,
    hasDesign,
  }: {
    feature: string;
    hasDesign: boolean;
  }) => (
    <div data-testid="feature-tasks-stub" data-has-design={String(hasDesign)}>
      {feature}
    </div>
  ),
}));
vi.mock("@/hooks/queries/project/use-get-project", () => ({
  default: () => ({ data: { name: "kaneo", slug: "KAN" } }),
}));
vi.mock("@/hooks/queries/agent-layer/use-member-names", () => ({
  useMemberNames: () => new Map(),
}));
vi.mock("@/hooks/use-workspace-permission", () => ({
  useWorkspacePermission: () => ({ canUpdateTasks: () => true }),
}));
vi.mock("@/hooks/queries/agent-layer/use-agent-requirements", () => ({
  useAgentRequirementSet: mocks.set,
}));
vi.mock("@/hooks/queries/agent-layer/use-agent-designs", () => ({
  useAgentDesign: mocks.design,
}));
vi.mock("@/hooks/mutations/agent-layer/use-agent-spec", () => ({
  usePutAgentRequirementSet: () => ({
    mutateAsync: mocks.putSet,
    isPending: false,
  }),
  usePutAgentDesign: () => ({ mutateAsync: mocks.putDesign, isPending: false }),
}));

const FeaturePage = (Route as unknown as { component: ComponentType })
  .component;
const loaded = (data: unknown) => ({
  data,
  isError: false,
  error: null,
  refetch: vi.fn(),
});
const missing = () => ({
  data: undefined,
  isError: true,
  error: new AgentLayerApiError(404, "nope"),
  refetch: vi.fn(),
});

beforeEach(() => {
  mocks.search = { tab: "requirements", edit: undefined };
  mocks.navigate.mockReset();
  mocks.putSet.mockReset().mockResolvedValue({});
  mocks.putDesign.mockReset().mockResolvedValue({});
  mocks.set.mockReset().mockReturnValue(
    loaded({
      id: "s1",
      feature: "feature-hub",
      title: "Feature 허브",
      updatedBy: null,
    }),
  );
  mocks.design
    .mockReset()
    .mockReturnValue(
      loaded({ id: "d1", feature: "feature-hub", title: "Design" }),
    );
});
afterEach(() => cleanup());

describe("feature 상세", () => {
  it("[REQ-FEATURE-HUB-4] shows three sub tabs and switching one is a single click that changes the search", () => {
    render(<FeaturePage />);
    expect(screen.getByTestId("feature-slug").textContent).toBe("feature-hub");
    expect(screen.getByTestId("tab-requirements")).toBeTruthy();
    expect(screen.getByTestId("tab-design")).toBeTruthy();
    expect(screen.getByTestId("tab-tasks")).toBeTruthy();
    fireEvent.click(screen.getByTestId("tab-tasks"));
    expect(mocks.navigate).toHaveBeenCalledWith(
      expect.objectContaining({ search: { tab: "tasks" }, replace: true }),
    );
  });

  it("[REQ-FEATURE-HUB-5] the requirements tab mounts the existing requirement page for this feature", () => {
    render(<FeaturePage />);
    const page = screen.getByTestId("requirement-set-page");
    expect(page.textContent).toBe("feature-hub");
    expect(page.getAttribute("data-embedded")).toBe("true");
  });

  it("[REQ-FEATURE-HUB-4] [REQ-FEATURE-HUB-6] the tasks tab mounts the feature task list", () => {
    mocks.search = { tab: "tasks", edit: undefined };
    render(<FeaturePage />);
    expect(
      screen.getByTestId("feature-tasks-stub").getAttribute("data-has-design"),
    ).toBe("true");
  });

  it("[REQ-FEATURE-HUB-8] a feature without a design offers to create an empty one from the requirement title", async () => {
    mocks.search = { tab: "design", edit: undefined };
    mocks.design.mockReturnValue(missing());
    render(<FeaturePage />);
    fireEvent.click(screen.getByTestId("create-design"));
    await new Promise((r) => setTimeout(r, 0));
    expect(mocks.putDesign).toHaveBeenCalledWith({
      projectId: "p1",
      feature: "feature-hub",
      body: {
        title: "Feature 허브",
        body: "# Feature 허브\n",
        requirementKeys: [],
      },
    });
    expect(mocks.navigate).toHaveBeenCalledWith(
      expect.objectContaining({ search: { tab: "design", edit: true } }),
    );
  });
});
