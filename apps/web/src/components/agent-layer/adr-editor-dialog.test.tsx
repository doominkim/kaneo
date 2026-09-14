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
  tasks: vi.fn(),
  conflict: false,
  pending: false,
}));
vi.mock("react-i18next", () => ({
  initReactI18next: { type: "3rdParty", init: () => undefined },
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      options ? `${key}:${JSON.stringify(options)}` : key,
  }),
}));
vi.mock("@/fetchers/agent-layer/api-error", () => ({
  isAgentLayerStatus: () => mocks.conflict,
}));
vi.mock("@/hooks/mutations/agent-layer/use-agent-decisions", () => ({
  useCreateAgentDecision: () => ({
    mutateAsync: mocks.create,
    isPending: mocks.pending,
  }),
}));
vi.mock("@/hooks/queries/task/use-get-tasks", () => ({
  useGetTasks: mocks.tasks,
}));

const accepted = {
  id: "d1",
  workspaceId: "w1",
  projectId: "p1",
  number: 7,
  title: "Original title",
  context: "Original context",
  decision: "Original decision",
  alternatives: "Keep Redis mandatory",
  consequences: null,
  sourceNote: null,
  reversible: true,
  status: "accepted",
  sourceEntryId: null,
  supersedesDecisionId: null,
  supersedes: null,
  supersededBy: null,
  refs: { repo: "kaneo" },
  tasks: [{ id: "t1", number: 4, title: "Deploy" }],
  createdBy: "u1",
  createdAuthor: { userId: "u1", name: "User" },
  createdActor: null,
  updatedBy: "u1",
  updatedAuthor: { userId: "u1", name: "User" },
  updatedActor: null,
  acceptedBy: "u1",
  acceptor: { userId: "u1", name: "User" },
  acceptedAt: "2026-09-11T00:00:00.000Z",
  reviewed: true,
  reviewedAt: "2026-09-11T00:00:00.000Z",
  reviewedBy: "u1",
  deletedAt: null,
  deletedBy: null,
  createdAt: "2026-09-11T00:00:00.000Z",
  updatedAt: "2026-09-11T00:00:00.000Z",
} as AgentDecisionDetail;

beforeEach(() => {
  mocks.create.mockReset();
  mocks.tasks.mockReset().mockReturnValue({ data: undefined });
  mocks.conflict = false;
  mocks.pending = false;
});
afterEach(cleanup);

describe("ADR 작성기", () => {
  it("새 ADR은 편집·초안 없이 곧바로 만들고 대체 대상을 보내지 않는다", async () => {
    mocks.create.mockResolvedValue(accepted);
    const props = { onOpenChange: vi.fn(), projectId: "p1", onSaved: vi.fn() };
    const { rerender } = render(<AdrEditorDialog {...props} open={false} />);
    expect(mocks.tasks).toHaveBeenLastCalledWith("");
    rerender(<AdrEditorDialog {...props} open />);
    expect(mocks.tasks).toHaveBeenLastCalledWith("p1");

    expect(screen.getByText("agentLayer:adr.newTitle")).toBeInTheDocument();
    expect(
      screen.getByText("agentLayer:adr.immutableHint"),
    ).toBeInTheDocument();
    expect(screen.queryByText("agentLayer:adr.saveDraft")).toBeNull();
    expect(screen.queryByTestId("adr-supersede-hint")).toBeNull();

    fireEvent.change(screen.getByLabelText("agentLayer:adr.title"), {
      target: { value: "Title" },
    });
    fireEvent.change(screen.getByLabelText("agentLayer:adr.context"), {
      target: { value: "Context" },
    });
    fireEvent.change(screen.getByLabelText("agentLayer:adr.decision"), {
      target: { value: "Decision" },
    });
    fireEvent.click(screen.getByText("agentLayer:adr.submit"));
    await waitFor(() => expect(mocks.create).toHaveBeenCalled());
    const body = mocks.create.mock.calls[0]?.[0];
    expect(body).toMatchObject({
      projectId: "p1",
      title: "Title",
      reversible: null,
      refs: null,
      taskIds: [],
    });
    expect(body).not.toHaveProperty("supersedesDecisionId");
    expect(props.onSaved).toHaveBeenCalledWith(accepted);
  });

  it("이 결정을 대체는 기존 내용을 채워 supersedesDecisionId와 함께 새 ADR을 만든다", async () => {
    mocks.create.mockResolvedValue({ ...accepted, id: "d2", number: 8 });
    render(
      <AdrEditorDialog
        open
        onOpenChange={vi.fn()}
        projectId="p1"
        supersedes={accepted}
        onSaved={vi.fn()}
      />,
    );
    expect(
      screen.getByText('agentLayer:adr.supersedeTitle:{"number":"007"}'),
    ).toBeInTheDocument();
    expect(screen.getByTestId("adr-supersede-hint")).toHaveTextContent(
      'agentLayer:adr.supersedeHint:{"number":"007"}',
    );
    expect(screen.getByLabelText("agentLayer:adr.title")).toHaveValue(
      "Original title",
    );

    fireEvent.change(screen.getByLabelText("agentLayer:adr.context"), {
      target: { value: "New context" },
    });
    fireEvent.click(screen.getByText("agentLayer:adr.submit"));
    await waitFor(() => expect(mocks.create).toHaveBeenCalled());
    expect(mocks.create.mock.calls[0]?.[0]).toMatchObject({
      projectId: "p1",
      supersedesDecisionId: "d1",
      title: "Original title",
      context: "New context",
      decision: "Original decision",
      alternatives: "Keep Redis mandatory",
      reversible: true,
      refs: { repo: "kaneo" },
      taskIds: ["t1"],
    });
  });

  it("대체 대상이 이미 바뀐 409에서도 작성 내용을 남기고, 저장 중에는 입력과 닫기를 막는다", async () => {
    mocks.conflict = true;
    mocks.create.mockRejectedValue(new Error("conflict"));
    const close = vi.fn();
    const { rerender } = render(
      <AdrEditorDialog
        open
        onOpenChange={close}
        projectId="p1"
        supersedes={accepted}
        onSaved={vi.fn()}
      />,
    );
    const title = screen.getByLabelText("agentLayer:adr.title");
    fireEvent.change(title, { target: { value: "Keep this text" } });
    fireEvent.click(screen.getByText("agentLayer:adr.submit"));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      'agentLayer:adr.supersedeConflict:{"number":"007"}',
    );
    expect(title).toHaveValue("Keep this text");

    mocks.pending = true;
    rerender(
      <AdrEditorDialog
        open
        onOpenChange={close}
        projectId="p1"
        supersedes={accepted}
        onSaved={vi.fn()}
      />,
    );
    expect(screen.getByLabelText("agentLayer:adr.title")).toBeDisabled();
    fireEvent.click(screen.getByText("agentLayer:adr.cancel"));
    expect(close).not.toHaveBeenCalled();
  });

  it("열 때의 내용을 고정해 대체 대상의 재조회가 작성 중 입력을 덮지 않는다", () => {
    const { rerender } = render(
      <AdrEditorDialog
        open
        onOpenChange={vi.fn()}
        projectId="p1"
        supersedes={accepted}
        onSaved={vi.fn()}
      />,
    );
    const title = screen.getByLabelText("agentLayer:adr.title");
    fireEvent.change(title, { target: { value: "Unsaved local title" } });
    rerender(
      <AdrEditorDialog
        open
        onOpenChange={vi.fn()}
        projectId="p1"
        supersedes={{
          ...accepted,
          title: "Server title",
          updatedAt: "2026-09-11T01:00:00.000Z",
        }}
        onSaved={vi.fn()}
      />,
    );
    expect(title).toHaveValue("Unsaved local title");
  });
});
