import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentDocument } from "@/fetchers/agent-layer/get-agent-document";
import { DocumentPage, documentBodyBytes } from "./document-page";

const mocks = vi.hoisted(() => ({
  put: vi.fn(),
  remove: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, to }: { children: React.ReactNode; to: string }) => (
    <a href={to}>{children}</a>
  ),
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      options && "used" in options
        ? `${key}:${String(options.used)}/${String(options.max)}`
        : key,
  }),
}));
vi.mock("@/lib/format", () => ({
  formatRelativeTime: () => "2 hours ago",
  formatDateTime: () => "Sep 2, 2026",
}));
vi.mock("@/lib/toast", () => ({
  toast: { success: mocks.toastSuccess, error: mocks.toastError },
}));
// The real editor pulls tiptap + shiki into jsdom; the page's own states are
// what is under test, so a textarea stands in for it.
vi.mock("@/components/activity/comment-editor", () => ({
  default: ({
    value,
    onChange,
    showQuickAttachButton,
  }: {
    value: string;
    onChange: (value: string) => void;
    showQuickAttachButton?: boolean;
  }) => (
    <textarea
      data-testid="editor"
      data-attach={String(showQuickAttachButton)}
      value={value}
      onChange={(event) => onChange(event.target.value)}
    />
  ),
}));
vi.mock("@/components/public-project/markdown-renderer", () => ({
  MarkdownRenderer: ({ content }: { content: string }) => (
    <div data-testid="markdown">{content}</div>
  ),
}));
vi.mock("@/hooks/mutations/agent-layer/use-put-agent-document", () => ({
  usePutAgentDocument: () => ({ mutateAsync: mocks.put, isPending: false }),
}));
vi.mock("@/hooks/mutations/agent-layer/use-delete-agent-document", () => ({
  useDeleteAgentDocument: () => ({
    mutateAsync: mocks.remove,
    isPending: false,
  }),
}));

const document: AgentDocument = {
  id: "d1",
  slug: "session-report",
  title: "Session report",
  taskId: "t1",
  domainId: null,
  updatedBy: "user-1",
  actorId: null,
  actor: null,
  updatedAt: "2026-09-02T00:00:00.000Z",
  createdAt: "2026-09-02T00:00:00.000Z",
  workspaceId: "ws",
  projectId: "p",
  body: "# Hello\n\nworld",
};

function renderPage(
  overrides: Partial<Parameters<typeof DocumentPage>[0]> = {},
) {
  const onDeleted = vi.fn();
  render(
    <DocumentPage
      document={document}
      workspaceId="ws"
      projectId="p"
      projectSlug="KAN"
      taskNumber={7}
      authorName="Dominic"
      canEdit
      canDelete
      onDeleted={onDeleted}
      {...overrides}
    />,
  );
  return { onDeleted };
}

beforeEach(() => {
  mocks.put.mockReset();
  mocks.remove.mockReset();
  mocks.toastSuccess.mockReset();
  mocks.toastError.mockReset();
});

afterEach(() => {
  cleanup();
});

describe("DocumentPage", () => {
  it("renders the markdown body with author and task in view mode", () => {
    renderPage();
    expect(screen.getByTestId("markdown")).toHaveTextContent("# Hello world");
    expect(screen.getByText("Dominic")).toBeInTheDocument();
    expect(screen.getByText("KAN-7")).toBeInTheDocument();
    expect(screen.getByTestId("edit-document")).toBeInTheDocument();
    expect(screen.getByTestId("delete-document")).toBeInTheDocument();
    expect(screen.queryByTestId("editor")).not.toBeInTheDocument();
  });

  it("names the writing model verbatim when an agent wrote the body", () => {
    renderPage({
      document: {
        ...document,
        updatedBy: null,
        actorId: "actor-1",
        actor: {
          id: "actor-1",
          provider: "openai",
          model: "gpt-5.6-luna",
          onBehalfOf: "user-1",
        },
      },
    });
    const author = screen.getByTestId("agent-author");
    expect(author).toHaveTextContent("gpt-5.6-luna");
    expect(author).toHaveAttribute("title", "openai/gpt-5.6-luna · user-1");
  });

  it("falls back to the flat agent label for a body with no actor", () => {
    renderPage({
      document: { ...document, updatedBy: null, actorId: null, actor: null },
    });
    expect(screen.getByTestId("agent-author")).toHaveTextContent(
      "agentLayer:common.agent",
    );
  });

  it("hides edit without task:update and delete without project:update", () => {
    renderPage({ canEdit: false, canDelete: false });
    expect(screen.queryByTestId("edit-document")).not.toBeInTheDocument();
    expect(screen.queryByTestId("delete-document")).not.toBeInTheDocument();
  });

  it("switches to the editor with attachments off, shows the byte counter and saves with taskId preserved", async () => {
    mocks.put.mockResolvedValue({ ...document, body: "changed" });
    renderPage();

    fireEvent.click(screen.getByTestId("edit-document"));

    const editor = screen.getByTestId("editor");
    expect(editor).toHaveAttribute("data-attach", "false");
    expect(screen.getByTestId("byte-counter")).toHaveTextContent(
      `agentLayer:docs.byteCounter:${documentBodyBytes(document.body)} B/200.0 KB`,
    );

    fireEvent.change(editor, { target: { value: "changed" } });
    fireEvent.click(screen.getByTestId("save-document"));

    await waitFor(() => expect(mocks.put).toHaveBeenCalledTimes(1));
    expect(mocks.put).toHaveBeenCalledWith({
      projectId: "p",
      slug: "session-report",
      body: {
        title: "Session report",
        body: "changed",
        taskId: "t1",
        domainId: null,
      },
    });
    expect(mocks.toastSuccess).toHaveBeenCalledWith("agentLayer:docs.saved");
    await waitFor(() =>
      expect(screen.queryByTestId("editor")).not.toBeInTheDocument(),
    );
  });

  it("blocks saving when the body exceeds 200KB", () => {
    renderPage();
    fireEvent.click(screen.getByTestId("edit-document"));

    fireEvent.change(screen.getByTestId("editor"), {
      target: { value: "x".repeat(200 * 1024 + 1) },
    });

    expect(screen.getByTestId("save-document")).toBeDisabled();
  });

  it("deletes through the confirm dialog and reports back", async () => {
    mocks.remove.mockResolvedValue({ id: "d1", slug: "session-report" });
    const { onDeleted } = renderPage();

    fireEvent.click(screen.getByTestId("delete-document"));
    fireEvent.click(await screen.findByTestId("confirm-delete"));

    await waitFor(() => expect(mocks.remove).toHaveBeenCalledTimes(1));
    expect(mocks.remove).toHaveBeenCalledWith({
      projectId: "p",
      slug: "session-report",
    });
    await waitFor(() => expect(onDeleted).toHaveBeenCalledTimes(1));
  });
});
