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
import { RequirementSetPage } from "./requirement-set-page";

const mocks = vi.hoisted(() => ({
  put: vi.fn(),
  approve: vi.fn(),
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
  useApproveAgentRequirementSet: () => ({
    mutateAsync: mocks.approve,
    isPending: false,
  }),
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
    status: "draft",
    approvedAt: null,
    approvedBy: null,
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

beforeEach(() => {
  mocks.put.mockReset().mockResolvedValue({});
  mocks.approve.mockReset().mockResolvedValue({});
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

  it("[REQ-SPEC-TABS-4] a draft set offers approve to an editor; an approved one does not", () => {
    const { unmount } = render(
      <RequirementSetPage
        set={makeSet()}
        workspaceId="ws"
        projectId="p1"
        canEdit
      />,
    );
    fireEvent.click(screen.getByTestId("approve-set"));
    expect(mocks.approve).toHaveBeenCalledWith({
      projectId: "p1",
      feature: "spec-tabs",
    });
    unmount();

    render(
      <RequirementSetPage
        set={makeSet({
          status: "approved",
          approvedAt: "2026-09-13T01:00:00.000Z",
        })}
        workspaceId="ws"
        projectId="p1"
        canEdit
      />,
    );
    expect(screen.queryByTestId("approve-set")).toBeNull();
    expect(screen.getByTestId("spec-status").getAttribute("data-status")).toBe(
      "approved",
    );
  });

  it("[REQ-SPEC-TABS-4] a reader without task:update sees neither approve nor edit", () => {
    render(
      <RequirementSetPage
        set={makeSet()}
        workspaceId="ws"
        projectId="p1"
        canEdit={false}
      />,
    );
    expect(screen.queryByTestId("approve-set")).toBeNull();
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
