import { cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentDesign } from "@/fetchers/agent-layer/agent-designs";
import type { SpecTarget } from "@/fetchers/agent-layer/agent-spec-lifecycle";
import { DesignPage } from "./design-page";

const mocks = vi.hoisted(() => ({ put: vi.fn(), review: vi.fn() }));

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
  useReviewAgentSpec: () => ({ mutateAsync: mocks.review, isPending: false }),
}));
vi.mock("./spec-lifecycle", () => ({
  SpecLifecycleActions: ({
    target,
    canDelete,
  }: {
    target: SpecTarget;
    canDelete: boolean;
  }) => (
    <div
      data-testid="spec-lifecycle"
      data-kind={target.kind}
      data-can-delete={String(canDelete)}
    />
  ),
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
    reviewed: true,
    reviewedAt: "2026-09-13T00:00:00.000Z",
    reviewedBy: "u1",
    revisedAt: "2026-09-13T00:00:00.000Z",
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
        changedSinceRevision: false,
      },
      {
        itemId: "i2",
        key: "REQ-SPEC-TABS-2",
        text: "b",
        status: "active",
        updatedAt: "2026-09-13T02:00:00.000Z",
        changedSinceRevision: true,
      },
    ],
    tasks: [{ id: "t1", number: 19, title: "KAN-19", status: "in-progress" }],
    ...overrides,
  };
}

beforeEach(() => {
  mocks.put.mockReset().mockResolvedValue({});
  mocks.review.mockReset().mockResolvedValue({});
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
    expect(screen.getAllByTestId("changed-since-revision")).toHaveLength(1);
    expect(screen.getByTestId("derived-tasks").textContent).toContain(
      "KAN-19 KAN-19",
    );
  });

  it("[REQ-AGENT-AUTOAPPLY-5] a stale design offers no approve button and shows no draft or approved status", () => {
    render(
      <DesignPage
        design={makeDesign()}
        requirementSet={null}
        workspaceId="ws"
        projectId="p1"
        canEdit
        canDelete
      />,
    );
    expect(screen.queryByTestId("approve-design")).toBeNull();
    expect(screen.queryByTestId("spec-status")).toBeNull();
    const text = document.body.textContent ?? "";
    for (const gone of [
      "agentLayer:spec.approve",
      "agentLayer:spec.statusDraft",
      "agentLayer:spec.statusApproved",
    ]) {
      expect(text).not.toContain(gone);
    }
    expect(screen.getByTestId("spec-lifecycle")).toHaveAttribute(
      "data-can-delete",
      "true",
    );
  });

  it("[REQ-AGENT-AUTOAPPLY-8] opening an unreviewed design marks it reviewed once", () => {
    const design = makeDesign({
      reviewed: false,
      reviewedAt: null,
      reviewedBy: null,
    });
    const { rerender } = render(
      <DesignPage
        design={design}
        requirementSet={null}
        workspaceId="ws"
        projectId="p1"
        canEdit={false}
      />,
    );
    expect(mocks.review).toHaveBeenCalledTimes(1);
    expect(mocks.review).toHaveBeenCalledWith({
      kind: "design",
      projectId: "p1",
      feature: "spec-tabs",
    });
    expect(screen.getByTestId("unreviewed-badge")).toBeInTheDocument();

    rerender(
      <DesignPage
        design={{ ...design, reviewed: true }}
        requirementSet={null}
        workspaceId="ws"
        projectId="p1"
        canEdit={false}
      />,
    );
    expect(mocks.review).toHaveBeenCalledTimes(1);
  });

  it("[REQ-SPEC-TABS-12] a fresh reviewed design shows no stale mark and is not reviewed again", () => {
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
    expect(screen.queryByTestId("unreviewed-badge")).toBeNull();
    expect(mocks.review).not.toHaveBeenCalled();
  });
});

describe("설계 본문의 기준 참조", () => {
  it("[REQ-FEATURE-HUB-25] turns [n.m] and [REQ-key] references into chips and counts the criteria never mentioned", () => {
    const requirementSet = {
      body: "## 1. A\n\n1. 시스템은 a. `api` REQ-SPEC-TABS-1\n2. 시스템은 b. `api` REQ-SPEC-TABS-2\n",
      items: [],
    } as never;
    render(
      <DesignPage
        design={makeDesign({
          body: "본문에서 [1.1] 과 [REQ-SPEC-TABS-1] 을 참조한다.",
        })}
        requirementSet={requirementSet}
        workspaceId="ws"
        projectId="p1"
        canEdit
      />,
    );
    const mentions = screen.getByTestId("design-mentions");
    expect(mentions.textContent).toContain(
      'agentLayer:spec.docMentioned:{"mentioned":1,"total":2}',
    );
    expect(mentions.textContent).toContain("1.2");
    // The rendered body carries the reference as a code span (a chip in the markdown renderer).
    expect(screen.getByText(/본문에서/).textContent).toContain("`1.1`");
  });
});
