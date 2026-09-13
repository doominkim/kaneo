import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TaskSpecBadges, TaskSpecLinks } from "./task-spec-links";

const mocks = vi.hoisted(() => ({
  badges: vi.fn(),
  links: vi.fn(),
  acknowledge: vi.fn(),
  put: vi.fn(),
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
vi.mock("@/hooks/queries/agent-layer/use-agent-task-links", () => ({
  useAgentTaskLinkBadges: mocks.badges,
  useAgentTaskLinks: mocks.links,
}));
vi.mock("@/hooks/queries/agent-layer/use-agent-requirements", () => ({
  useAgentRequirementSets: () => ({ data: { sets: [] } }),
  useAgentRequirementSet: () => ({ data: undefined }),
}));
vi.mock("@/hooks/queries/agent-layer/use-agent-designs", () => ({
  useAgentDesigns: () => ({ data: { designs: [] } }),
}));
vi.mock("@/hooks/mutations/agent-layer/use-agent-spec", () => ({
  useAcknowledgeAgentTaskLinks: () => ({
    mutateAsync: mocks.acknowledge,
    isPending: false,
  }),
  usePutAgentTaskLinks: () => ({ mutateAsync: mocks.put, isPending: false }),
}));

beforeEach(() => {
  mocks.acknowledge.mockReset().mockResolvedValue({});
  mocks.badges.mockReset().mockReturnValue({
    data: new Map([
      [
        "t1",
        {
          taskId: "t1",
          requirementKeys: ["REQ-SPEC-TABS-7"],
          designFeatures: ["spec-tabs"],
          stale: true,
        },
      ],
    ]),
  });
  mocks.links.mockReset().mockReturnValue({
    data: {
      taskId: "t1",
      requirements: [
        {
          itemId: "i7",
          key: "REQ-SPEC-TABS-7",
          feature: "spec-tabs",
          text: "task 매핑",
          status: "active",
          updatedAt: "2026-09-13T02:00:00.000Z",
          createdAt: "2026-09-13T00:00:00.000Z",
          acknowledgedAt: null,
        },
      ],
      designs: [
        {
          designId: "d1",
          feature: "spec-tabs",
          title: "Design",
          status: "approved",
          approvedAt: "2026-09-13T00:00:00.000Z",
          createdAt: "2026-09-13T00:00:00.000Z",
          acknowledgedAt: null,
        },
      ],
      stale: {
        stale: true,
        causes: [
          {
            kind: "requirement",
            key: "REQ-SPEC-TABS-7",
            changedAt: "2026-09-13T02:00:00.000Z",
          },
        ],
      },
    },
  });
});
afterEach(() => cleanup());

describe("task 배지와 링크", () => {
  it("[REQ-SPEC-TABS-13] the board card shows the task's keys, design and a stale mark from one project query", () => {
    render(<TaskSpecBadges projectId="p1" taskId="t1" />);
    const badges = screen.getByTestId("task-spec-badges");
    expect(badges.textContent).toContain("REQ-SPEC-TABS-7");
    expect(badges.textContent).toContain("design:spec-tabs");
    expect(screen.getByTestId("stale-badge")).toBeTruthy();
    expect(mocks.badges).toHaveBeenCalledWith("p1");
  });

  it("[REQ-SPEC-TABS-13] a card without links renders nothing", () => {
    const { container } = render(<TaskSpecBadges projectId="p1" taskId="t2" />);
    expect(container.innerHTML).toBe("");
  });

  it("[REQ-SPEC-TABS-10] the detail sidebar names the stale cause and lets an editor acknowledge it", () => {
    render(
      <TaskSpecLinks workspaceId="ws" projectId="p1" taskId="t1" canEdit />,
    );
    expect(screen.getByTestId("stale-causes").textContent).toContain(
      "REQ-SPEC-TABS-7",
    );
    fireEvent.click(screen.getByTestId("acknowledge-task"));
    expect(mocks.acknowledge).toHaveBeenCalledWith({
      projectId: "p1",
      taskId: "t1",
    });
  });

  it("[REQ-SPEC-TABS-10] a reader cannot acknowledge or edit links", () => {
    render(
      <TaskSpecLinks
        workspaceId="ws"
        projectId="p1"
        taskId="t1"
        canEdit={false}
      />,
    );
    expect(screen.queryByTestId("acknowledge-task")).toBeNull();
    expect(screen.queryByTestId("edit-task-links")).toBeNull();
  });
});
