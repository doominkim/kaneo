import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentDecisionDetail } from "@/fetchers/agent-layer/agent-decisions";
import { AdrEditorDialog } from "./adr-editor-dialog";

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  update: vi.fn(),
  tasks: vi.fn(),
  conflict: false,
  pending: false,
}));
vi.mock("react-i18next", () => ({
  initReactI18next: { type: "3rdParty", init: () => undefined },
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("@/fetchers/agent-layer/api-error", () => ({
  isAgentLayerStatus: () => mocks.conflict,
}));
vi.mock("@/hooks/mutations/agent-layer/use-agent-decisions", () => ({
  useCreateAgentDecision: () => ({
    mutateAsync: mocks.create,
    isPending: mocks.pending,
  }),
  useUpdateAgentDecision: () => ({
    mutateAsync: mocks.update,
    isPending: mocks.pending,
  }),
}));
vi.mock("@/hooks/queries/task/use-get-tasks", () => ({
  useGetTasks: mocks.tasks,
}));

const base = {
  id: "d1",
  workspaceId: "w1",
  projectId: "p1",
  number: 1,
  title: "Original title",
  context: "Original context",
  decision: "Original decision",
  alternatives: null,
  consequences: null,
  sourceNote: null,
  reversible: null,
  status: "draft",
  sourceEntryId: null,
  supersedesDecisionId: null,
  supersedes: null,
  supersededBy: null,
  refs: null,
  tasks: [],
  createdBy: "u1",
  createdAuthor: { userId: "u1", name: "User" },
  createdActor: null,
  updatedBy: "u1",
  updatedAuthor: { userId: "u1", name: "User" },
  updatedActor: null,
  acceptedBy: null,
  acceptor: null,
  acceptedAt: null,
  createdAt: "2026-09-11T00:00:00.000Z",
  updatedAt: "2026-09-11T00:00:00.000Z",
} as AgentDecisionDetail;

beforeEach(() => {
  mocks.create.mockReset();
  mocks.update.mockReset();
  mocks.tasks.mockReset().mockReturnValue({ data: undefined });
  mocks.conflict = false;
  mocks.pending = false;
});
afterEach(cleanup);

describe("ADR 편집기", () => {
  it("열 때의 본문과 버전을 고정해 같은 항목의 재조회가 작성 중 입력을 덮지 않는다", async () => {
    mocks.update.mockResolvedValue(base);
    const saved = vi.fn();
    const { rerender } = render(
      <AdrEditorDialog
        open
        onOpenChange={vi.fn()}
        projectId="p1"
        decision={base}
        onSaved={saved}
      />,
    );
    const title = screen.getByLabelText("agentLayer:adr.title");
    fireEvent.change(title, { target: { value: "Unsaved local title" } });
    rerender(
      <AdrEditorDialog
        open
        onOpenChange={vi.fn()}
        projectId="p1"
        decision={{
          ...base,
          title: "Server title",
          updatedAt: "2026-09-11T01:00:00.000Z",
        }}
        onSaved={saved}
      />,
    );
    expect(title).toHaveValue("Unsaved local title");
    fireEvent.click(screen.getByText("agentLayer:adr.saveDraft"));
    await waitFor(() => expect(mocks.update).toHaveBeenCalled());
    expect(mocks.update.mock.calls[0]?.[0]).toMatchObject({
      body: {
        expectedUpdatedAt: base.updatedAt,
        title: "Unsaved local title",
        reversible: null,
      },
    });
  });

  it("409에서도 작성 내용을 남기고 저장 중에는 입력과 닫기를 막는다", async () => {
    mocks.conflict = true;
    mocks.update.mockRejectedValue(new Error("conflict"));
    const close = vi.fn();
    const { rerender } = render(
      <AdrEditorDialog
        open
        onOpenChange={close}
        projectId="p1"
        decision={base}
        onSaved={vi.fn()}
      />,
    );
    const title = screen.getByLabelText("agentLayer:adr.title");
    fireEvent.change(title, { target: { value: "Keep this text" } });
    fireEvent.click(screen.getByText("agentLayer:adr.saveDraft"));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "agentLayer:adr.conflict",
    );
    expect(title).toHaveValue("Keep this text");

    mocks.pending = true;
    rerender(
      <AdrEditorDialog
        open
        onOpenChange={close}
        projectId="p1"
        decision={base}
        onSaved={vi.fn()}
      />,
    );
    expect(screen.getByLabelText("agentLayer:adr.title")).toBeDisabled();
    fireEvent.click(screen.getByText("agentLayer:adr.cancel"));
    expect(close).not.toHaveBeenCalled();
  });

  it("닫혀 있을 때 태스크를 조회하지 않고 untouched reversible을 null로 저장한다", async () => {
    mocks.create.mockResolvedValue(base);
    const props = { onOpenChange: vi.fn(), projectId: "p1", onSaved: vi.fn() };
    const { rerender } = render(<AdrEditorDialog {...props} open={false} />);
    expect(mocks.tasks).toHaveBeenLastCalledWith("");
    rerender(<AdrEditorDialog {...props} open />);
    expect(mocks.tasks).toHaveBeenLastCalledWith("p1");
    fireEvent.change(screen.getByLabelText("agentLayer:adr.title"), {
      target: { value: "Title" },
    });
    fireEvent.change(screen.getByLabelText("agentLayer:adr.context"), {
      target: { value: "Context" },
    });
    fireEvent.change(screen.getByLabelText("agentLayer:adr.decision"), {
      target: { value: "Decision" },
    });
    fireEvent.click(screen.getByText("agentLayer:adr.saveDraft"));
    await waitFor(() => expect(mocks.create).toHaveBeenCalled());
    expect(mocks.create.mock.calls[0]?.[0]).toMatchObject({ reversible: null });
  });
});
