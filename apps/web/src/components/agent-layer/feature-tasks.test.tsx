import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FeatureTasks } from "./feature-tasks";

const mocks = vi.hoisted(() => ({
  tasks: vi.fn(),
  createTask: vi.fn(),
  link: vi.fn(),
}));

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children }: { children: ReactNode }) => <a href="/">{children}</a>,
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
vi.mock("@/lib/i18n/domain", () => ({
  getStatusDisplayLabel: (s: string) => s,
}));
vi.mock("@/hooks/queries/agent-layer/use-agent-features", () => ({
  useAgentFeatureTasks: mocks.tasks,
}));
vi.mock("@/hooks/mutations/task/use-create-task", () => ({
  default: () => ({ mutateAsync: mocks.createTask, isPending: false }),
}));
vi.mock("@/hooks/mutations/agent-layer/use-agent-spec", () => ({
  usePutAgentTaskLinks: () => ({ mutateAsync: mocks.link, isPending: false }),
}));

const set = {
  id: "s1",
  items: [
    { id: "i1", key: "REQ-FEATURE-HUB-1", text: "탭 6개", status: "active" },
    { id: "i2", key: "REQ-FEATURE-HUB-2", text: "목록", status: "active" },
    { id: "i3", key: "REQ-FEATURE-HUB-10", text: "합침", status: "dropped" },
  ],
} as never;

beforeEach(() => {
  mocks.createTask.mockReset().mockResolvedValue({ id: "t9" });
  mocks.link.mockReset().mockResolvedValue({});
  mocks.tasks.mockReset().mockReturnValue({
    isError: false,
    data: {
      tasks: [
        {
          id: "t1",
          number: 4,
          title: "nav",
          status: "in-progress",
          requirementKeys: ["REQ-FEATURE-HUB-1"],
          viaDesign: true,
          stale: { stale: false, causes: [] },
        },
        {
          id: "t2",
          number: 5,
          title: "detail",
          status: "to-do",
          requirementKeys: [],
          viaDesign: true,
          stale: {
            stale: true,
            causes: [
              {
                kind: "design",
                key: "feature-hub",
                changedAt: "2026-09-13T09:15:22.836Z",
              },
            ],
          },
        },
      ],
    },
    refetch: vi.fn(),
  });
});
afterEach(() => cleanup());

describe("feature 태스크 탭", () => {
  it("[REQ-FEATURE-HUB-6] lists only the feature's tasks with status, keys and stale causes", () => {
    render(
      <FeatureTasks
        workspaceId="ws"
        projectId="p1"
        feature="feature-hub"
        projectSlug="KAN"
        requirementSet={set}
        hasDesign
        canEdit
      />,
    );
    const rows = screen.getAllByTestId("feature-task");
    expect(rows).toHaveLength(2);
    expect(rows[0]?.textContent).toContain("KAN-4 nav");
    expect(rows[0]?.textContent).toContain("REQ-FEATURE-HUB-1");
    expect(
      rows[1]?.querySelector('[data-testid="stale-causes"]')?.textContent,
    ).toContain("feature-hub");
    expect(mocks.tasks).toHaveBeenCalledWith("p1", "feature-hub");
  });

  it("[REQ-FEATURE-HUB-7] a task created here is linked to the design and the chosen criteria", async () => {
    render(
      <FeatureTasks
        workspaceId="ws"
        projectId="p1"
        feature="feature-hub"
        requirementSet={set}
        hasDesign
        canEdit
      />,
    );
    fireEvent.click(screen.getByTestId("new-feature-task"));
    fireEvent.change(screen.getByTestId("feature-task-title"), {
      target: { value: "T9 새 작업" },
    });
    // Dropped criteria are not offered.
    expect(screen.queryByText("REQ-FEATURE-HUB-10")).toBeNull();
    fireEvent.click(screen.getByLabelText("REQ-FEATURE-HUB-2"));
    fireEvent.click(screen.getByTestId("create-feature-task"));
    await new Promise((r) => setTimeout(r, 0));
    expect(mocks.createTask).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "T9 새 작업",
        projectId: "p1",
        status: "to-do",
      }),
    );
    expect(mocks.link).toHaveBeenCalledWith({
      projectId: "p1",
      taskId: "t9",
      body: {
        requirementKeys: ["REQ-FEATURE-HUB-2"],
        designFeatures: ["feature-hub"],
      },
    });
  });

  it("[REQ-FEATURE-HUB-7] without a design the new task is linked to criteria only, and readers cannot create", () => {
    const { unmount } = render(
      <FeatureTasks
        workspaceId="ws"
        projectId="p1"
        feature="feature-hub"
        requirementSet={set}
        hasDesign={false}
        canEdit={false}
      />,
    );
    expect(screen.queryByTestId("new-feature-task")).toBeNull();
    unmount();
  });
});
