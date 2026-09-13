import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import type { ComponentType, ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Route } from "./feature.index";

const mocks = vi.hoisted(() => ({
  features: vi.fn(),
  put: vi.fn(),
  navigate: vi.fn(),
  canUpdateTasks: vi.fn(),
}));

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (options: Record<string, unknown>) => ({
    ...options,
    useParams: () => ({ workspaceId: "ws", projectId: "p1" }),
  }),
  useNavigate: () => mocks.navigate,
  Link: ({
    children,
    params,
    search,
  }: {
    children: ReactNode;
    params?: unknown;
    search?: unknown;
  }) => (
    <a
      href="/"
      data-params={JSON.stringify(params)}
      data-search={JSON.stringify(search)}
    >
      {children}
    </a>
  ),
}));
vi.mock("react-i18next", () => ({
  initReactI18next: { type: "3rdParty", init: () => {} },
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      options ? `${key}:${JSON.stringify(options)}` : key,
  }),
}));
vi.mock("@/lib/format", () => ({
  formatRelativeTime: () => "just now",
  formatDateTime: () => "Sep 13, 2026",
}));
vi.mock("@/lib/toast", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/components/common/project-layout", () => ({
  default: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/page-title", () => ({ default: () => null }));
vi.mock("@/components/agent-layer/create-feature-dialog", () => ({
  CreateFeatureDialog: ({
    open,
    onCreate,
  }: {
    open: boolean;
    onCreate: (i: { feature: string; title: string }) => void;
  }) =>
    open ? (
      <button
        type="button"
        data-testid="fake-create"
        onClick={() => onCreate({ feature: "beta", title: "Beta" })}
      >
        create
      </button>
    ) : null,
}));
vi.mock("@/hooks/queries/project/use-get-project", () => ({
  default: () => ({ data: { name: "kaneo", slug: "KAN" } }),
}));
vi.mock("@/hooks/use-workspace-permission", () => ({
  useWorkspacePermission: () => ({ canUpdateTasks: mocks.canUpdateTasks }),
}));
vi.mock("@/hooks/queries/agent-layer/use-agent-features", () => ({
  useAgentFeatures: mocks.features,
}));
vi.mock("@/hooks/mutations/agent-layer/use-agent-spec", () => ({
  usePutAgentRequirementSet: () => ({
    mutateAsync: mocks.put,
    isPending: false,
  }),
}));

const FeatureIndex = (Route as unknown as { component: ComponentType })
  .component;

beforeEach(() => {
  mocks.navigate.mockReset();
  mocks.put.mockReset().mockResolvedValue({});
  mocks.canUpdateTasks.mockReturnValue(true);
  mocks.features.mockReset().mockReturnValue({
    isError: false,
    data: {
      features: [
        {
          feature: "feature-hub",
          title: "Feature 허브",
          requirements: {
            status: "approved",
            approvedAt: "2026-09-13T09:11:51.359Z",
            itemCount: 26,
            activeCount: 25,
            coveredCount: 4,
            updatedAt: "2026-09-13T09:11:51.359Z",
          },
          design: {
            status: "approved",
            approvedAt: "2026-09-13T09:15:22.836Z",
            stale: true,
            updatedAt: "2026-09-13T09:15:22.836Z",
          },
          tasks: { total: 8, done: 3, stale: 1 },
          updatedAt: "2026-09-13T09:15:22.836Z",
        },
        {
          feature: "beta",
          title: "Beta design",
          requirements: null,
          design: {
            status: "draft",
            approvedAt: null,
            stale: false,
            updatedAt: "2026-09-13T09:00:00.000Z",
          },
          tasks: { total: 0, done: 0, stale: 0 },
          updatedAt: "2026-09-13T09:00:00.000Z",
        },
      ],
    },
    refetch: vi.fn(),
  });
});
afterEach(() => cleanup());

describe("Feature 탭", () => {
  it("[REQ-FEATURE-HUB-2] [REQ-FEATURE-HUB-18] [REQ-FEATURE-HUB-19] lists every feature with requirement, design, task and coverage state on one row", () => {
    render(<FeatureIndex />);
    const rows = screen.getAllByTestId("feature-row");
    expect(rows).toHaveLength(2);
    const hub = within(rows[0]);
    expect(hub.getByText("feature-hub")).toBeTruthy();
    expect(hub.getByTestId("feature-requirements").textContent).toContain(
      "agentLayer:spec.statusApproved",
    );
    expect(
      within(hub.getByTestId("feature-design")).getByTestId("stale-badge"),
    ).toBeTruthy();
    expect(hub.getByTestId("feature-tasks").textContent).toContain("3/8");
    expect(hub.getByTestId("feature-tasks").textContent).toContain(
      'agentLayer:spec.staleCount:{"count":1}',
    );
    expect(hub.getByTestId("feature-coverage").textContent).toBe("4/25");
    const beta = within(rows[1]);
    expect(beta.getByTestId("feature-requirements").textContent).toBe(
      "agentLayer:spec.noRequirements",
    );
    expect(beta.getByTestId("feature-coverage").textContent).toBe("–");
  });

  it("[REQ-FEATURE-HUB-3] a new feature creates an empty requirement document and opens it in edit mode", () => {
    render(<FeatureIndex />);
    fireEvent.click(screen.getByTestId("new-feature"));
    fireEvent.click(screen.getByTestId("fake-create"));
    expect(mocks.put).toHaveBeenCalledWith({
      projectId: "p1",
      feature: "beta",
      body: { title: "Beta", body: "", items: [] },
    });
    return new Promise((resolve) => setTimeout(resolve, 0)).then(() => {
      expect(mocks.navigate).toHaveBeenCalledWith(
        expect.objectContaining({
          params: { workspaceId: "ws", projectId: "p1", feature: "beta" },
          search: { tab: "requirements", edit: true },
        }),
      );
    });
  });

  it("[REQ-FEATURE-HUB-2] an empty project says so instead of rendering a table", () => {
    mocks.features.mockReturnValue({
      isError: false,
      data: { features: [] },
      refetch: vi.fn(),
    });
    render(<FeatureIndex />);
    expect(screen.getByTestId("empty-features")).toBeTruthy();
    expect(screen.queryByTestId("features")).toBeNull();
  });
});
