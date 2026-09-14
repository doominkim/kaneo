import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TaskSpecBadges, TaskSpecLinks } from "./task-spec-links";

const mocks = vi.hoisted(() => ({
  badges: vi.fn(),
  links: vi.fn(),
  acknowledge: vi.fn(),
  reviewLinks: vi.fn(),
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
  useReviewAgentTaskLinks: () => ({
    mutateAsync: mocks.reviewLinks,
    isPending: false,
  }),
  usePutAgentTaskLinks: () => ({ mutateAsync: mocks.put, isPending: false }),
}));

type LinkReview = { acknowledgedByAgent: boolean; reviewed: boolean };

function linksData({
  requirement = { acknowledgedByAgent: false, reviewed: false },
  design = { acknowledgedByAgent: false, reviewed: false },
}: {
  requirement?: LinkReview;
  design?: LinkReview;
} = {}) {
  return {
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
        acknowledgedAt: requirement.acknowledgedByAgent
          ? "2026-09-13T03:00:00.000Z"
          : null,
        ...requirement,
      },
    ],
    designs: [
      {
        designId: "d1",
        feature: "spec-tabs",
        title: "Design",
        status: "approved",
        approvedAt: "2026-09-13T00:00:00.000Z",
        revisedAt: "2026-09-13T00:00:00.000Z",
        createdAt: "2026-09-13T00:00:00.000Z",
        acknowledgedAt: design.acknowledgedByAgent
          ? "2026-09-13T03:00:00.000Z"
          : null,
        ...design,
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
  };
}

beforeEach(() => {
  mocks.acknowledge.mockReset().mockResolvedValue({});
  mocks.reviewLinks.mockReset().mockResolvedValue({});
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
  mocks.links.mockReset().mockReturnValue({ data: linksData() });
});
afterEach(() => cleanup());

describe("task 배지와 링크", () => {
  it("[REQ-SPEC-TABS-13] [REQ-FEATURE-HUB-11] the board card shows feature · REQ count and a stale mark, not every key", () => {
    render(<TaskSpecBadges projectId="p1" taskId="t1" />);
    const badges = screen.getByTestId("task-spec-badges");
    expect(
      screen.getAllByTestId("feature-badge").map((b) => b.textContent),
    ).toEqual(["spec-tabs · REQ 1"]);
    expect(badges.textContent).not.toContain("REQ-SPEC-TABS-7");
    expect(screen.getByTestId("stale-badge")).toBeTruthy();
    expect(mocks.badges).toHaveBeenCalledWith("p1");
  });

  it("[REQ-SPEC-TABS-13] a card without links renders nothing", () => {
    const { container } = render(<TaskSpecBadges projectId="p1" taskId="t2" />);
    expect(container.innerHTML).toBe("");
  });

  it("[REQ-FEATURE-HUB-13] the detail sidebar links each feature name to the feature page", () => {
    render(
      <TaskSpecLinks workspaceId="ws" projectId="p1" taskId="t1" canEdit />,
    );
    expect(
      screen.getAllByTestId("task-feature-link").map((l) => l.textContent),
    ).toEqual(["spec-tabs"]);
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

  it("[REQ-AGENT-AUTOAPPLY-11] marks the link an agent acknowledged with 'AI 확인 · 미확인' and reviews the task once on open", () => {
    mocks.links.mockReturnValue({
      data: linksData({
        requirement: { acknowledgedByAgent: true, reviewed: false },
      }),
    });
    const { rerender } = render(
      <TaskSpecLinks
        workspaceId="ws"
        projectId="p1"
        taskId="t1"
        canEdit={false}
      />,
    );
    const marks = screen.getAllByTestId("agent-ack-unreviewed");
    expect(marks).toHaveLength(1);
    expect(marks[0]).toHaveTextContent("agentLayer:spec.agentAckUnreviewed");
    expect(mocks.reviewLinks).toHaveBeenCalledTimes(1);
    expect(mocks.reviewLinks).toHaveBeenCalledWith({
      projectId: "p1",
      taskId: "t1",
    });

    // The review lands and the refetch clears the flag: the person who opened
    // the task still sees what the agent signed off, and nothing is re-sent.
    mocks.links.mockReturnValue({
      data: linksData({
        requirement: { acknowledgedByAgent: true, reviewed: true },
      }),
    });
    rerender(
      <TaskSpecLinks
        workspaceId="ws"
        projectId="p1"
        taskId="t1"
        canEdit={false}
      />,
    );
    expect(screen.getAllByTestId("agent-ack-unreviewed")).toHaveLength(1);
    expect(mocks.reviewLinks).toHaveBeenCalledTimes(1);
  });

  it("[REQ-AGENT-AUTOAPPLY-11] an agent-acknowledged design link is marked too", () => {
    mocks.links.mockReturnValue({
      data: linksData({
        design: { acknowledgedByAgent: true, reviewed: false },
      }),
    });
    render(
      <TaskSpecLinks workspaceId="ws" projectId="p1" taskId="t1" canEdit />,
    );
    expect(screen.getAllByTestId("agent-ack-unreviewed")).toHaveLength(1);
    expect(mocks.reviewLinks).toHaveBeenCalledTimes(1);
  });

  it("[REQ-AGENT-AUTOAPPLY-11] links no agent acknowledged, or a person already reviewed, get no mark and no review call", () => {
    const { unmount } = render(
      <TaskSpecLinks workspaceId="ws" projectId="p1" taskId="t1" canEdit />,
    );
    expect(screen.queryAllByTestId("agent-ack-unreviewed")).toHaveLength(0);
    unmount();

    mocks.links.mockReturnValue({
      data: linksData({
        requirement: { acknowledgedByAgent: true, reviewed: true },
      }),
    });
    render(
      <TaskSpecLinks workspaceId="ws" projectId="p1" taskId="t1" canEdit />,
    );
    expect(screen.queryAllByTestId("agent-ack-unreviewed")).toHaveLength(0);
    expect(mocks.reviewLinks).not.toHaveBeenCalled();
  });
});
