import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EntryDetailSheet } from "./entry-detail-sheet";

const mocks = vi.hoisted(() => ({
  entry: vi.fn(),
  promote: vi.fn(),
  navigate: vi.fn(),
  pending: false,
}));
vi.mock("react-i18next", () => ({
  initReactI18next: { type: "3rdParty", init: () => undefined },
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => mocks.navigate,
  Link: ({
    children,
    "data-testid": testId,
  }: {
    children: ReactNode;
    "data-testid"?: string;
  }) => (
    <a href="/decision" data-testid={testId}>
      {children}
    </a>
  ),
}));
vi.mock("@/components/ui/sheet", () => ({
  Sheet: ({
    children,
    onOpenChange,
  }: {
    children: ReactNode;
    onOpenChange: (open: boolean) => void;
  }) => (
    <div>
      {children}
      <button type="button" onClick={() => onOpenChange(false)}>
        sheet-close
      </button>
    </div>
  ),
  SheetContent: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  SheetHeader: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  SheetTitle: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  SheetDescription: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
}));
vi.mock("@/components/public-project/markdown-renderer", () => ({
  MarkdownRenderer: ({ content }: { content: string }) => <div>{content}</div>,
}));
vi.mock("@/hooks/queries/agent-layer/use-agent-entry", () => ({
  useAgentEntry: mocks.entry,
}));
vi.mock("@/hooks/mutations/agent-layer/use-agent-decisions", () => ({
  usePromoteAgentDecision: () => ({
    mutateAsync: mocks.promote,
    isPending: mocks.pending,
  }),
}));
vi.mock("@/hooks/use-workspace-permission", () => ({
  useWorkspacePermission: () => ({ canUpdateTasks: () => true }),
}));
vi.mock("./entry-actions", () => ({
  canDeleteEntry: () => false,
  EntryDeleteDialog: () => null,
  useEntryPermissions: () => ({ canUpdateProjects: false }),
  useRestoreEntry: () => ({ restore: vi.fn(), isPending: false }),
}));

const entry = {
  id: "e1",
  workspaceId: "w",
  projectId: "p",
  taskId: null,
  kind: "decision",
  summary: "Legacy decision",
  body: "Original note",
  decision: { what: "Choose A", why: "Reason" },
  refs: null,
  adrDecisionId: null,
  adrNumber: null,
  adrStatus: null,
  coreChanged: null,
  effort: null,
  agentLabel: null,
  usage: null,
  compaction: "full",
  sessionId: null,
  createdAt: "2026-09-11T00:00:00.000Z",
  deletedAt: null,
  deletedBy: null,
  actor: null,
  author: { userId: "u", name: "User" },
};

beforeEach(() => {
  mocks.entry
    .mockReset()
    .mockReturnValue({ data: entry, isPending: false, isError: false });
  mocks.promote.mockReset();
  mocks.navigate.mockReset();
  mocks.pending = false;
});
afterEach(cleanup);

describe("기존 결정 항목의 ADR 연결", () => {
  it("수명주기 항목은 기존 ADR 링크만 표시하고 다시 승격하지 않는다", () => {
    mocks.entry.mockReturnValue({
      data: {
        ...entry,
        adrDecisionId: "d1",
        adrNumber: 4,
        adrStatus: "accepted",
      },
      isPending: false,
      isError: false,
    });
    render(
      <EntryDetailSheet
        projectId="p"
        workspaceId="w"
        entryId="e1"
        taskNumberById={new Map()}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByTestId("open-lifecycle-adr")).toHaveTextContent(
      "ADR-004",
    );
    expect(screen.queryByTestId("promote-legacy-adr")).not.toBeInTheDocument();
  });

  it("승격 실패를 보여주고 다시 시도하며 진행 중에는 시트를 닫지 않는다", async () => {
    mocks.promote.mockRejectedValueOnce(new Error("failed"));
    const close = vi.fn();
    const { rerender } = render(
      <EntryDetailSheet
        projectId="p"
        workspaceId="w"
        entryId="e1"
        taskNumberById={new Map()}
        onClose={close}
      />,
    );
    fireEvent.click(screen.getByTestId("promote-legacy-adr"));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "agentLayer:adr.promoteFailed",
    );
    expect(close).not.toHaveBeenCalled();

    mocks.pending = true;
    rerender(
      <EntryDetailSheet
        projectId="p"
        workspaceId="w"
        entryId="e1"
        taskNumberById={new Map()}
        onClose={close}
      />,
    );
    fireEvent.click(screen.getByText("sheet-close"));
    expect(close).not.toHaveBeenCalled();
  });

  it("승격 성공 시 새 ADR로 이동한다", async () => {
    mocks.promote.mockResolvedValue({ id: "d2" });
    const close = vi.fn();
    render(
      <EntryDetailSheet
        projectId="p"
        workspaceId="w"
        entryId="e1"
        taskNumberById={new Map()}
        onClose={close}
      />,
    );
    fireEvent.click(screen.getByTestId("promote-legacy-adr"));
    await waitFor(() => expect(mocks.navigate).toHaveBeenCalled());
    expect(close).toHaveBeenCalledOnce();
    expect(mocks.navigate).toHaveBeenCalledWith(
      expect.objectContaining({
        params: { workspaceId: "w", projectId: "p", decisionId: "d2" },
      }),
    );
  });
});
