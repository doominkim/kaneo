import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentRequirementSet } from "@/fetchers/agent-layer/agent-requirements";
import type { SpecTarget } from "@/fetchers/agent-layer/agent-spec-lifecycle";
import { RequirementSetPage } from "./requirement-set-page";

const mocks = vi.hoisted(() => ({
  put: vi.fn(),
  review: vi.fn(),
}));

vi.mock("@tanstack/react-router", () => ({
  Link: ({
    children,
    params,
  }: {
    children: ReactNode;
    params?: Record<string, string>;
  }) => (
    <a href="/" data-params={JSON.stringify(params)}>
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
vi.mock("@/components/public-project/markdown-renderer", () => ({
  MarkdownRenderer: ({ content }: { content: string }) => <div>{content}</div>,
}));
vi.mock("@/hooks/mutations/agent-layer/use-agent-spec", () => ({
  usePutAgentRequirementSet: () => ({
    mutateAsync: mocks.put,
    isPending: false,
  }),
  useReviewAgentSpec: () => ({
    mutateAsync: mocks.review,
    isPending: false,
  }),
}));
// History and delete are exercised in spec-lifecycle.test.tsx; here only what
// the page hands them.
vi.mock("./spec-lifecycle", () => ({
  SpecLifecycleActions: ({
    target,
    canRevert,
    canDelete,
  }: {
    target: SpecTarget;
    canRevert: boolean;
    canDelete: boolean;
  }) => (
    <div
      data-testid="spec-lifecycle"
      data-kind={target.kind}
      data-feature={target.feature}
      data-can-revert={String(canRevert)}
      data-can-delete={String(canDelete)}
    />
  ),
}));

function makeSet(
  overrides: Partial<AgentRequirementSet> = {},
): AgentRequirementSet {
  return {
    id: "set-1",
    workspaceId: "ws",
    projectId: "p1",
    feature: "spec-tabs",
    title: "Spec tabs",
    body: "# scope",
    status: "approved",
    approvedAt: "2026-09-13T00:00:00.000Z",
    approvedBy: null,
    reviewed: true,
    reviewedAt: "2026-09-13T00:00:00.000Z",
    reviewedBy: "u1",
    revisedAt: "2026-09-13T00:00:00.000Z",
    nextSeq: 3,
    sourceSlug: null,
    updatedBy: "u1",
    actorId: null,
    actor: null,
    createdAt: "2026-09-13T00:00:00.000Z",
    updatedAt: "2026-09-13T00:00:00.000Z",
    items: [
      {
        id: "i1",
        setId: "set-1",
        projectId: "p1",
        key: "REQ-SPEC-TABS-1",
        seq: 1,
        text: "탭 순서",
        layer: "e2e",
        status: "active",
        story: null,
        createdAt: "2026-09-13T00:00:00.000Z",
        updatedAt: "2026-09-13T00:00:00.000Z",
        coverage: [
          {
            repo: "r",
            testPath: "nav.test.tsx",
            testName: null,
            reportedAt: "2026-09-13T00:00:00.000Z",
          },
        ],
        designs: [
          {
            id: "d1",
            feature: "spec-tabs",
            title: "Design",
            status: "approved",
          },
        ],
        tasks: [
          { id: "t1", number: 19, title: "KAN-19", status: "in-progress" },
        ],
      },
      {
        id: "i2",
        setId: "set-1",
        projectId: "p1",
        key: "REQ-SPEC-TABS-2",
        seq: 2,
        text: "set 저장",
        layer: "api",
        status: "active",
        story: null,
        createdAt: "2026-09-13T00:00:00.000Z",
        updatedAt: "2026-09-13T00:00:00.000Z",
        coverage: [],
        designs: [],
        tasks: [],
      },
    ],
    ...overrides,
  };
}

const unreviewed = () =>
  makeSet({ reviewed: false, reviewedAt: null, reviewedBy: null });

beforeEach(() => {
  mocks.put.mockReset().mockResolvedValue({});
  mocks.review.mockReset().mockResolvedValue({});
});
afterEach(() => cleanup());

describe("요구사항 문서 페이지", () => {
  it("[REQ-SPEC-TABS-11] lists every item with key, coverage, design and derived tasks", () => {
    render(
      <RequirementSetPage
        set={makeSet()}
        workspaceId="ws"
        projectId="p1"
        projectSlug="KAN"
        canEdit
      />,
    );
    const rows = screen.getAllByTestId("item-row");
    expect(rows).toHaveLength(2);
    const first = within(rows[0]);
    expect(first.getByText("REQ-SPEC-TABS-1")).toBeTruthy();
    expect(first.getByTestId("item-coverage").textContent).toContain(
      'agentLayer:spec.covered:{"count":1}',
    );
    expect(first.getByText("spec-tabs")).toBeTruthy();
    expect(first.getByText("KAN-19")).toBeTruthy();
    const second = within(rows[1]);
    expect(second.getByTestId("item-coverage").textContent).toBe(
      "agentLayer:spec.notCovered",
    );
  });

  it("[REQ-AGENT-AUTOAPPLY-5] shows no approve button and no draft or approved status", () => {
    render(
      <RequirementSetPage
        set={unreviewed()}
        workspaceId="ws"
        projectId="p1"
        canEdit
        canDelete
      />,
    );
    expect(screen.queryByTestId("approve-set")).toBeNull();
    expect(screen.queryByTestId("spec-status")).toBeNull();
    const text = document.body.textContent ?? "";
    for (const gone of [
      "agentLayer:spec.approve",
      "agentLayer:spec.statusDraft",
      "agentLayer:spec.statusApproved",
    ]) {
      expect(text).not.toContain(gone);
    }
  });

  it("[REQ-AGENT-AUTOAPPLY-8] opening an unreviewed document marks it reviewed once, for any reader", () => {
    const set = unreviewed();
    const { rerender } = render(
      <RequirementSetPage
        set={set}
        workspaceId="ws"
        projectId="p1"
        canEdit={false}
      />,
    );
    expect(mocks.review).toHaveBeenCalledTimes(1);
    expect(mocks.review).toHaveBeenCalledWith({
      kind: "requirement",
      projectId: "p1",
      feature: "spec-tabs",
    });
    expect(screen.getByTestId("unreviewed-badge")).toBeInTheDocument();

    rerender(
      <RequirementSetPage
        set={{ ...set }}
        workspaceId="ws"
        projectId="p1"
        canEdit={false}
      />,
    );
    // The refetch comes back reviewed; the mark stays for this visit.
    rerender(
      <RequirementSetPage
        set={{ ...set, reviewed: true }}
        workspaceId="ws"
        projectId="p1"
        canEdit={false}
      />,
    );
    expect(mocks.review).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("unreviewed-badge")).toBeInTheDocument();
  });

  it("[REQ-AGENT-AUTOAPPLY-8] a reviewed document is not reviewed again and carries no mark", () => {
    render(
      <RequirementSetPage
        set={makeSet()}
        workspaceId="ws"
        projectId="p1"
        canEdit
      />,
    );
    expect(mocks.review).not.toHaveBeenCalled();
    expect(screen.queryByTestId("unreviewed-badge")).toBeNull();
  });

  it("[REQ-AGENT-AUTOAPPLY-18] [REQ-AGENT-AUTOAPPLY-25] hands every reader the history, revert to task:update and delete to project:update", () => {
    const { unmount } = render(
      <RequirementSetPage
        set={makeSet()}
        workspaceId="ws"
        projectId="p1"
        canEdit={false}
      />,
    );
    const readOnly = screen.getByTestId("spec-lifecycle");
    expect(readOnly).toHaveAttribute("data-kind", "requirement");
    expect(readOnly).toHaveAttribute("data-feature", "spec-tabs");
    expect(readOnly).toHaveAttribute("data-can-revert", "false");
    expect(readOnly).toHaveAttribute("data-can-delete", "false");
    unmount();

    render(
      <RequirementSetPage
        set={makeSet()}
        workspaceId="ws"
        projectId="p1"
        canEdit
        canDelete
      />,
    );
    const manager = screen.getByTestId("spec-lifecycle");
    expect(manager).toHaveAttribute("data-can-revert", "true");
    expect(manager).toHaveAttribute("data-can-delete", "true");
  });

  it("[REQ-SPEC-TABS-4] a reader without task:update cannot edit", () => {
    render(
      <RequirementSetPage
        set={makeSet()}
        workspaceId="ws"
        projectId="p1"
        canEdit={false}
      />,
    );
    expect(screen.queryByTestId("edit-set")).toBeNull();
  });

  it("[REQ-SPEC-TABS-3] editing sends existing keys back and new rows without a key", () => {
    render(
      <RequirementSetPage
        set={makeSet()}
        workspaceId="ws"
        projectId="p1"
        canEdit
        startInEdit
      />,
    );
    fireEvent.click(screen.getByTestId("add-item"));
    const texts = screen.getAllByTestId("item-text");
    expect(texts).toHaveLength(3);
    fireEvent.change(texts[2], { target: { value: "새 항목" } });
    fireEvent.change(screen.getAllByTestId("item-status")[1], {
      target: { value: "dropped" },
    });
    fireEvent.click(screen.getByTestId("save-set"));
    expect(mocks.put).toHaveBeenCalledWith({
      projectId: "p1",
      feature: "spec-tabs",
      body: {
        title: "Spec tabs",
        body: "# scope",
        sourceSlug: null,
        items: [
          {
            key: "REQ-SPEC-TABS-1",
            text: "탭 순서",
            layer: "e2e",
            status: "active",
          },
          {
            key: "REQ-SPEC-TABS-2",
            text: "set 저장",
            layer: "api",
            status: "dropped",
          },
          { text: "새 항목", layer: null, status: "active" },
        ],
      },
    });
  });
});
