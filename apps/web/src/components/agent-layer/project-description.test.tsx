import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AgentLayerApiError } from "@/fetchers/agent-layer/api-error";
import type { AgentDocument } from "@/fetchers/agent-layer/get-agent-document";
import { ProjectDescription } from "./project-description";

const mocks = vi.hoisted(() => ({
  document: vi.fn(),
  put: vi.fn(),
  remove: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("@/lib/format", () => ({
  formatRelativeTime: () => "2 hours ago",
  formatDateTime: () => "Sep 3, 2026",
}));
vi.mock("@/lib/toast", () => ({
  toast: { success: mocks.toastSuccess, error: mocks.toastError },
}));
vi.mock("@/components/activity/comment-editor", () => ({
  default: ({
    value,
    onChange,
  }: {
    value: string;
    onChange: (value: string) => void;
  }) => (
    <textarea
      data-testid="editor"
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
vi.mock("@/hooks/queries/agent-layer/use-agent-document", () => ({
  useAgentDocument: mocks.document,
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
  id: "d-overview",
  workspaceId: "ws",
  projectId: "p",
  slug: "overview",
  title: "개요",
  body: "# Kaneo agent layer\n\nWhat this is.",
  taskId: null,
  updatedBy: "user-1",
  actorId: null,
  actor: null,
  createdAt: "2026-09-01T00:00:00.000Z",
  updatedAt: "2026-09-03T00:00:00.000Z",
};

function loaded(doc: AgentDocument) {
  return { isPending: false, isError: false, data: doc, refetch: vi.fn() };
}

function renderDescription(
  overrides: Partial<Parameters<typeof ProjectDescription>[0]> = {},
) {
  render(
    <ProjectDescription
      projectId="p"
      memberNameById={new Map([["user-1", "Dominic"]])}
      canEdit
      canDelete
      {...overrides}
    />,
  );
}

beforeEach(() => {
  mocks.document.mockReset().mockReturnValue(loaded(document));
  mocks.put.mockReset().mockResolvedValue(document);
  mocks.remove.mockReset().mockResolvedValue({ id: "d-overview" });
  mocks.toastSuccess.mockReset();
  mocks.toastError.mockReset();
});

afterEach(() => {
  cleanup();
});

describe("ProjectDescription", () => {
  it("reads the reserved overview document and renders it as markdown", () => {
    renderDescription();
    expect(mocks.document).toHaveBeenCalledWith("p", "overview");
    expect(screen.getByTestId("markdown")).toHaveTextContent(
      "# Kaneo agent layer",
    );
    expect(screen.getByText("Dominic")).toBeInTheDocument();
    expect(screen.getByText("2 hours ago")).toBeInTheDocument();
  });

  it("treats a 404 as 'no description yet' and lets an editor add one", async () => {
    mocks.document.mockReturnValue({
      isPending: false,
      isError: true,
      error: new AgentLayerApiError(404, "not found"),
      refetch: vi.fn(),
    });
    renderDescription();

    expect(
      screen.getByText("agentLayer:overview.descriptionEmpty"),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("edit-description")).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId("add-description"));

    fireEvent.change(screen.getByTestId("editor"), {
      target: { value: "Fresh description" },
    });
    fireEvent.click(screen.getByTestId("save-description"));

    await waitFor(() =>
      expect(mocks.put).toHaveBeenCalledWith({
        projectId: "p",
        slug: "overview",
        body: {
          title: "agentLayer:overview.descriptionTitle",
          body: "Fresh description",
          taskId: null,
        },
      }),
    );
    expect(mocks.toastSuccess).toHaveBeenCalledWith(
      "agentLayer:overview.descriptionSaved",
    );
  });

  it("hides the add action without task:update", () => {
    mocks.document.mockReturnValue({
      isPending: false,
      isError: true,
      error: new AgentLayerApiError(404, "not found"),
      refetch: vi.fn(),
    });
    renderDescription({ canEdit: false });
    expect(screen.queryByTestId("add-description")).not.toBeInTheDocument();
  });

  it("edits inline and keeps the stored title", async () => {
    renderDescription();
    fireEvent.click(screen.getByTestId("edit-description"));
    const editor = screen.getByTestId("editor") as HTMLTextAreaElement;
    expect(editor.value).toBe(document.body);
    fireEvent.change(editor, { target: { value: "Rewritten" } });
    fireEvent.click(screen.getByTestId("save-description"));
    await waitFor(() =>
      expect(mocks.put).toHaveBeenCalledWith({
        projectId: "p",
        slug: "overview",
        body: { title: "개요", body: "Rewritten", taskId: null },
      }),
    );
  });

  it("deletes through the confirm dialog with project:update only", async () => {
    renderDescription({ canDelete: false });
    expect(screen.queryByTestId("delete-description")).not.toBeInTheDocument();
    cleanup();

    renderDescription();
    fireEvent.click(screen.getByTestId("delete-description"));
    expect(
      await screen.findByText("agentLayer:overview.deleteDescriptionTitle"),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("confirm-delete"));
    await waitFor(() =>
      expect(mocks.remove).toHaveBeenCalledWith({
        projectId: "p",
        slug: "overview",
      }),
    );
  });

  it("surfaces non-404 failures as the shared error state", () => {
    mocks.document.mockReturnValue({
      isPending: false,
      isError: true,
      error: new AgentLayerApiError(403, "forbidden"),
      refetch: vi.fn(),
    });
    renderDescription();
    expect(screen.getByTestId("agent-layer-error")).toBeInTheDocument();
  });
});
