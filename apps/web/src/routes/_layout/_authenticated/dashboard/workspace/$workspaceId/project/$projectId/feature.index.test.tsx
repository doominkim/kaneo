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
import { Route } from "./feature.index";

const mocks = vi.hoisted(() => ({
  features: vi.fn(),
  put: vi.fn(),
  restore: vi.fn(),
  navigate: vi.fn(),
  canUpdateTasks: vi.fn(),
  canUpdateProjects: vi.fn(),
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
  useWorkspacePermission: () => ({
    canUpdateTasks: mocks.canUpdateTasks,
    canUpdateProjects: mocks.canUpdateProjects,
  }),
}));
vi.mock("@/hooks/queries/agent-layer/use-agent-features", () => ({
  useAgentFeatures: mocks.features,
}));
vi.mock("@/hooks/queries/agent-layer/use-member-names", () => ({
  useMemberNames: () => new Map([["u2", "Mina"]]),
}));
vi.mock("@/hooks/mutations/agent-layer/use-agent-spec", () => ({
  usePutAgentRequirementSet: () => ({
    mutateAsync: mocks.put,
    isPending: false,
  }),
  useRestoreAgentSpec: () => ({
    mutateAsync: mocks.restore,
    isPending: false,
    variables: undefined,
  }),
}));

const FeatureIndex = (Route as unknown as { component: ComponentType })
  .component;

const lifecycle = (reviewed: boolean, deletedAt: string | null = null) => ({
  reviewed,
  revisedAt: "2026-09-13T09:00:00.000Z",
  deletedAt,
  deletedBy: deletedAt ? "u2" : null,
});

const live = {
  isError: false,
  data: {
    features: [
      {
        feature: "feature-hub",
        title: "Feature 허브",
        requirements: {
          status: "approved",
          approvedAt: "2026-09-13T09:11:51.359Z",
          ...lifecycle(true),
          itemCount: 26,
          activeCount: 25,
          coveredCount: 4,
          updatedAt: "2026-09-13T09:11:51.359Z",
        },
        design: {
          status: "approved",
          approvedAt: "2026-09-13T09:15:22.836Z",
          ...lifecycle(true),
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
          status: "approved",
          approvedAt: "2026-09-13T09:00:00.000Z",
          ...lifecycle(false),
          stale: false,
          updatedAt: "2026-09-13T09:00:00.000Z",
        },
        tasks: { total: 0, done: 0, stale: 0 },
        updatedAt: "2026-09-13T09:00:00.000Z",
      },
    ],
  },
  refetch: vi.fn(),
};

const deleted = {
  isError: false,
  data: {
    features: [
      {
        feature: "old",
        title: "Old flow",
        requirements: null,
        design: {
          status: "approved",
          approvedAt: null,
          ...lifecycle(true, "2026-09-14T01:00:00.000Z"),
          stale: false,
          updatedAt: "2026-09-14T01:00:00.000Z",
        },
        tasks: { total: 0, done: 0, stale: 0 },
        updatedAt: "2026-09-14T01:00:00.000Z",
      },
    ],
  },
  refetch: vi.fn(),
};

beforeEach(() => {
  mocks.navigate.mockReset();
  mocks.put.mockReset().mockResolvedValue({});
  mocks.restore.mockReset().mockResolvedValue({});
  mocks.canUpdateTasks.mockReturnValue(true);
  mocks.canUpdateProjects.mockReturnValue(true);
  mocks.features
    .mockReset()
    .mockImplementation(
      (_projectId: string, options?: { deleted?: boolean }) =>
        options?.deleted ? deleted : live,
    );
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
      'agentLayer:spec.revisedAt:{"when":"just now"}',
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

  it("[REQ-AGENT-AUTOAPPLY-5] rows show no draft or approved status", () => {
    render(<FeatureIndex />);
    expect(screen.queryAllByTestId("spec-status")).toHaveLength(0);
    const text = screen.getByTestId("features").textContent ?? "";
    expect(text).not.toContain("agentLayer:spec.statusApproved");
    expect(text).not.toContain("agentLayer:spec.statusDraft");
  });

  it("marks each unreviewed document in its own cell", () => {
    render(<FeatureIndex />);
    const [hub, beta] = screen.getAllByTestId("feature-row");
    expect(within(hub).queryAllByTestId("unreviewed-badge")).toHaveLength(0);
    expect(
      within(within(beta).getByTestId("feature-design")).getByTestId(
        "unreviewed-badge",
      ),
    ).toBeInTheDocument();
  });

  it("[REQ-AGENT-AUTOAPPLY-18] the Deleted filter lists deleted documents with who deleted them, when, and a restore", async () => {
    render(<FeatureIndex />);
    expect(mocks.features).toHaveBeenCalledWith("p1", {
      deleted: true,
      enabled: false,
    });
    fireEvent.click(screen.getByTestId("show-deleted-features"));
    expect(mocks.features).toHaveBeenLastCalledWith("p1", {
      deleted: true,
      enabled: true,
    });
    expect(screen.queryByTestId("features")).toBeNull();
    expect(screen.queryByTestId("new-feature")).toBeNull();

    const rows = screen.getAllByTestId("deleted-doc-row");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toHaveAttribute("data-kind", "design");
    expect(rows[0]).toHaveTextContent("old");
    expect(within(rows[0]).getByTestId("deleted-stamp")).toHaveTextContent(
      'agentLayer:common.deletedBy:{"name":"Mina","when":"just now"}',
    );

    fireEvent.click(within(rows[0]).getByTestId("restore-doc"));
    await waitFor(() =>
      expect(mocks.restore).toHaveBeenCalledWith({
        kind: "design",
        projectId: "p1",
        feature: "old",
      }),
    );
  });

  it("[REQ-AGENT-AUTOAPPLY-18] restore needs project:update", () => {
    mocks.canUpdateProjects.mockReturnValue(false);
    render(<FeatureIndex />);
    fireEvent.click(screen.getByTestId("show-deleted-features"));
    expect(screen.getByTestId("deleted-doc-row")).toBeInTheDocument();
    expect(screen.queryByTestId("restore-doc")).toBeNull();
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
