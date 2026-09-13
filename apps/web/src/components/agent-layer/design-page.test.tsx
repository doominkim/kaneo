import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentDesign } from "@/fetchers/agent-layer/agent-designs";
import { DesignPage } from "./design-page";

const mocks = vi.hoisted(() => ({ put: vi.fn(), approve: vi.fn() }));

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
vi.mock("@/components/public-project/markdown-renderer", () => ({
  MarkdownRenderer: ({ content }: { content: string }) => <div>{content}</div>,
}));
vi.mock("@/hooks/mutations/agent-layer/use-agent-spec", () => ({
  usePutAgentDesign: () => ({ mutateAsync: mocks.put, isPending: false }),
  useApproveAgentDesign: () => ({
    mutateAsync: mocks.approve,
    isPending: false,
  }),
}));

function makeDesign(overrides: Partial<AgentDesign> = {}): AgentDesign {
  return {
    id: "d1",
    workspaceId: "ws",
    projectId: "p1",
    feature: "spec-tabs",
    title: "Design",
    body: "# design",
    status: "approved",
    approvedAt: "2026-09-13T00:00:00.000Z",
    approvedBy: "u1",
    sourceSlug: null,
    updatedBy: "u1",
    actorId: null,
    actor: null,
    createdAt: "2026-09-13T00:00:00.000Z",
    updatedAt: "2026-09-13T00:00:00.000Z",
    stale: {
      stale: true,
      causes: [
        {
          kind: "requirement",
          key: "REQ-SPEC-TABS-2",
          changedAt: "2026-09-13T02:00:00.000Z",
        },
      ],
    },
    requirements: [
      {
        itemId: "i1",
        key: "REQ-SPEC-TABS-1",
        text: "a",
        status: "active",
        updatedAt: "2026-09-12T00:00:00.000Z",
        changedSinceApproval: false,
      },
      {
        itemId: "i2",
        key: "REQ-SPEC-TABS-2",
        text: "b",
        status: "active",
        updatedAt: "2026-09-13T02:00:00.000Z",
        changedSinceApproval: true,
      },
    ],
    tasks: [{ id: "t1", number: 19, title: "KAN-19", status: "in-progress" }],
    ...overrides,
  };
}

beforeEach(() => {
  mocks.put.mockReset().mockResolvedValue({});
  mocks.approve.mockReset().mockResolvedValue({});
});
afterEach(() => cleanup());

describe("설계 페이지", () => {
  it("[REQ-SPEC-TABS-12] shows the stale verdict with its cause and marks the changed key", () => {
    render(
      <DesignPage
        design={makeDesign()}
        requirementSet={null}
        workspaceId="ws"
        projectId="p1"
        projectSlug="KAN"
        canEdit
      />,
    );
    expect(screen.getByTestId("stale-badge")).toBeTruthy();
    expect(screen.getByTestId("stale-causes").textContent).toContain(
      "REQ-SPEC-TABS-2",
    );
    expect(screen.getAllByTestId("changed-since-approval")).toHaveLength(1);
    expect(screen.getByTestId("derived-tasks").textContent).toContain(
      "KAN-19 KAN-19",
    );
  });

  it("[REQ-SPEC-TABS-10] a stale approved design can be re-approved, which is the human way to clear stale", () => {
    render(
      <DesignPage
        design={makeDesign()}
        requirementSet={null}
        workspaceId="ws"
        projectId="p1"
        canEdit
      />,
    );
    fireEvent.click(screen.getByTestId("approve-design"));
    expect(mocks.approve).toHaveBeenCalledWith({
      projectId: "p1",
      feature: "spec-tabs",
    });
  });

  it("[REQ-SPEC-TABS-12] a fresh approved design shows no stale mark and no approve button", () => {
    render(
      <DesignPage
        design={makeDesign({
          stale: { stale: false, causes: [] },
          requirements: [],
        })}
        requirementSet={null}
        workspaceId="ws"
        projectId="p1"
        canEdit
      />,
    );
    expect(screen.queryByTestId("stale-badge")).toBeNull();
    expect(screen.queryByTestId("approve-design")).toBeNull();
  });
});
