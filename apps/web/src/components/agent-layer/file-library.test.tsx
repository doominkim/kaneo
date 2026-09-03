import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentArtifact } from "@/fetchers/agent-layer/get-agent-artifacts";
import type { AgentDocumentSummary } from "@/fetchers/agent-layer/get-agent-documents";
import { FileLibrary } from "./file-library";

const mocks = vi.hoisted(() => ({
  deleteArtifact: vi.fn(),
  deleteDocument: vi.fn(),
  download: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("@tanstack/react-router", () => ({
  Link: ({
    children,
    params,
    to,
    ...rest
  }: {
    children?: React.ReactNode;
    params: Record<string, string>;
    to: string;
  }) => (
    <a href={to} data-params={JSON.stringify(params)} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      options && ("name" in options || "title" in options)
        ? `${key}:${String(options.name ?? options.title)}`
        : key,
  }),
}));
vi.mock("@/lib/format", () => ({
  formatRelativeTime: () => "2 hours ago",
  formatDateTime: () => "Sep 2, 2026",
  formatDateMedium: (value: string) => `day:${value.slice(0, 10)}`,
}));
vi.mock("@/lib/toast", () => ({
  toast: { success: mocks.toastSuccess, error: mocks.toastError },
}));
vi.mock("@/lib/download-agent-artifact", () => ({
  downloadAgentArtifact: mocks.download,
}));
vi.mock("@/hooks/mutations/agent-layer/use-delete-agent-artifact", () => ({
  useDeleteAgentArtifact: () => ({
    mutateAsync: mocks.deleteArtifact,
    isPending: false,
  }),
}));
vi.mock("@/hooks/mutations/agent-layer/use-delete-agent-document", () => ({
  useDeleteAgentDocument: () => ({
    mutateAsync: mocks.deleteDocument,
    isPending: false,
  }),
}));
// The uploader has its own test; here only its presence matters.
vi.mock("./artifact-uploader", () => ({
  ArtifactUploader: () => <div data-testid="artifact-uploader" />,
}));

const artifacts: AgentArtifact[] = [
  {
    id: "a1",
    projectId: "p",
    taskId: "t1",
    name: "report.html",
    contentType: "text/html",
    size: 20480,
    uploadedBy: null,
    actorId: "actor-1",
    createdAt: "2026-09-03T02:00:00.000Z",
  },
  {
    id: "a2",
    projectId: "p",
    taskId: null,
    name: "bundle.zip",
    contentType: "application/zip",
    size: 3 * 1024 * 1024,
    uploadedBy: "user-1",
    actorId: null,
    createdAt: "2026-09-02T02:00:00.000Z",
  },
];

const documents: AgentDocumentSummary[] = [
  {
    id: "d1",
    slug: "session-report",
    title: "Session report",
    taskId: "t1",
    updatedBy: "user-1",
    actorId: null,
    updatedAt: "2026-09-03T01:00:00.000Z",
  },
];

function renderLibrary(
  overrides: Partial<Parameters<typeof FileLibrary>[0]> = {},
) {
  const onCreateDocument = vi.fn();
  render(
    <FileLibrary
      artifacts={artifacts}
      documents={documents}
      workspaceId="ws"
      projectId="p"
      projectSlug="KAN"
      tasks={[{ id: "t1", number: 7, title: "Ship it" }]}
      memberNameById={new Map([["user-1", "Dominic"]])}
      canUpload
      canDelete
      onCreateDocument={onCreateDocument}
      {...overrides}
    />,
  );
  return { onCreateDocument };
}

beforeEach(() => {
  mocks.deleteArtifact.mockReset().mockResolvedValue({ id: "a1" });
  mocks.deleteDocument.mockReset().mockResolvedValue({ id: "d1" });
  mocks.download.mockReset().mockResolvedValue(undefined);
  mocks.toastSuccess.mockReset();
  mocks.toastError.mockReset();
});

afterEach(() => {
  cleanup();
});

describe("FileLibrary", () => {
  it("groups artifacts and documents by task with the project group first", () => {
    renderLibrary();

    const groups = screen.getAllByTestId("library-group");
    expect(groups).toHaveLength(2);

    const [projectGroup, taskGroup] = groups;
    expect(within(projectGroup).getByTestId("group-label")).toHaveTextContent(
      "agentLayer:docs.groupProject",
    );
    const projectRows = within(projectGroup).getAllByTestId("library-row");
    expect(projectRows).toHaveLength(1);
    expect(within(projectRows[0]).getByText("bundle.zip")).toBeInTheDocument();
    expect(within(projectRows[0]).getByText("3.0 MB")).toBeInTheDocument();
    expect(within(projectRows[0]).getByText("Dominic")).toBeInTheDocument();
    expect(
      within(projectRows[0]).queryByTestId("view-artifact"),
    ).not.toBeInTheDocument();

    expect(within(taskGroup).getByTestId("group-label")).toHaveTextContent(
      "KAN-7",
    );
    const taskRows = within(taskGroup).getAllByTestId("library-row");
    expect(taskRows.map((row) => row.dataset.kind)).toEqual([
      "artifact",
      "document",
    ]);
    expect(within(taskRows[0]).getByTestId("agent-author")).toBeInTheDocument();
    expect(within(taskRows[0]).getByTestId("view-artifact")).toHaveAttribute(
      "data-params",
      JSON.stringify({ workspaceId: "ws", projectId: "p", artifactId: "a1" }),
    );
    expect(within(taskRows[1]).getByText("Session report")).toBeInTheDocument();
    expect(within(taskRows[1]).getByText("session-report")).toBeInTheDocument();
  });

  it("switches to day groups with a task column", () => {
    renderLibrary();
    fireEvent.click(screen.getByTestId("group-date"));

    const labels = screen
      .getAllByTestId("group-label")
      .map((label) => label.textContent);
    expect(labels).toHaveLength(2);
    expect(labels.every((label) => label?.startsWith("day:"))).toBe(true);
    expect(screen.getAllByText("agentLayer:docs.columnTask")).toHaveLength(2);
  });

  it("downloads a zip from its name and the download action", async () => {
    renderLibrary();
    fireEvent.click(screen.getByTestId("download-name"));
    fireEvent.click(screen.getAllByTestId("download-artifact")[0]);
    expect(mocks.download).toHaveBeenCalledWith("p", "a2");
    expect(mocks.download).toHaveBeenCalledTimes(2);
  });

  it("confirms before deleting an artifact and calls the artifact mutation", async () => {
    renderLibrary();
    const zipRow = screen
      .getAllByTestId("library-row")
      .find((row) => within(row).queryByText("bundle.zip"));
    if (!zipRow) throw new Error("zip row missing");
    fireEvent.click(within(zipRow).getByTestId("delete-item"));

    expect(
      await screen.findByText("agentLayer:docs.deleteFileTitle"),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("confirm-delete"));
    await vi.waitFor(() =>
      expect(mocks.deleteArtifact).toHaveBeenCalledWith({
        projectId: "p",
        artifactId: "a2",
      }),
    );
    expect(mocks.deleteDocument).not.toHaveBeenCalled();
    expect(mocks.toastSuccess).toHaveBeenCalledWith(
      "agentLayer:docs.fileDeleted",
    );
  });

  it("routes a document delete through the document mutation", async () => {
    renderLibrary();
    const docRow = screen
      .getAllByTestId("library-row")
      .find((row) => row.dataset.kind === "document");
    if (!docRow) throw new Error("document row missing");
    fireEvent.click(within(docRow).getByTestId("delete-item"));
    expect(
      await screen.findByText("agentLayer:docs.deleteTitle"),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("confirm-delete"));
    await vi.waitFor(() =>
      expect(mocks.deleteDocument).toHaveBeenCalledWith({
        projectId: "p",
        slug: "session-report",
      }),
    );
  });

  it("gates upload, markdown creation and delete on capabilities", () => {
    renderLibrary({ canUpload: false, canDelete: false });
    expect(screen.queryByTestId("toggle-upload")).not.toBeInTheDocument();
    expect(screen.queryByTestId("new-document")).not.toBeInTheDocument();
    expect(screen.queryByTestId("artifact-uploader")).not.toBeInTheDocument();
    expect(screen.queryByTestId("delete-item")).not.toBeInTheDocument();
  });

  it("reveals the uploader on demand and forwards markdown creation", () => {
    const { onCreateDocument } = renderLibrary();
    expect(screen.queryByTestId("artifact-uploader")).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId("toggle-upload"));
    expect(screen.getByTestId("artifact-uploader")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("new-document"));
    expect(onCreateDocument).toHaveBeenCalledTimes(1);
  });

  it("shows the uploader with the empty state when there is nothing yet", () => {
    renderLibrary({ artifacts: [], documents: [] });
    expect(screen.getByText("agentLayer:docs.empty")).toBeInTheDocument();
    expect(screen.getByTestId("artifact-uploader")).toBeInTheDocument();
    expect(screen.queryByTestId("library-row")).not.toBeInTheDocument();
  });
});
