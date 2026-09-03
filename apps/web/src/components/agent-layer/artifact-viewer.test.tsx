import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentArtifact } from "@/fetchers/agent-layer/get-agent-artifacts";
import { ArtifactViewer } from "./artifact-viewer";

const mocks = vi.hoisted(() => ({
  url: vi.fn(),
  download: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, to }: { children: React.ReactNode; to: string }) => (
    <a href={to}>{children}</a>
  ),
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("@/lib/format", () => ({
  formatRelativeTime: () => "2 hours ago",
  formatDateTime: () => "Sep 3, 2026",
}));
vi.mock("@/lib/toast", () => ({
  toast: { success: vi.fn(), error: mocks.toastError },
}));
vi.mock("@/lib/download-agent-artifact", () => ({
  downloadAgentArtifact: mocks.download,
}));
vi.mock("@/fetchers/agent-layer/get-agent-artifact-url", () => ({
  default: vi.fn(),
}));
vi.mock("@/hooks/queries/agent-layer/use-agent-artifact-url", () => ({
  useAgentArtifactUrl: mocks.url,
}));

const html: AgentArtifact = {
  id: "a1",
  projectId: "p",
  taskId: "t1",
  name: "report.html",
  contentType: "text/html",
  size: 2048,
  uploadedBy: null,
  actorId: "actor-1",
  createdAt: "2026-09-03T00:00:00.000Z",
};

function renderViewer(artifact: AgentArtifact) {
  render(
    <ArtifactViewer
      artifact={artifact}
      workspaceId="ws"
      projectId="p"
      projectSlug="KAN"
      taskNumber={7}
    />,
  );
}

beforeEach(() => {
  mocks.url.mockReset().mockReturnValue({
    isPending: false,
    isError: false,
    data: { url: "https://files.example/signed?x=1", expiresAt: "" },
    refetch: vi.fn(),
  });
  mocks.download.mockReset().mockResolvedValue(undefined);
});

afterEach(() => {
  cleanup();
});

describe("ArtifactViewer", () => {
  it("frames the inline URL in a fully sandboxed iframe", () => {
    renderViewer(html);

    expect(mocks.url).toHaveBeenCalledWith("p", "a1", "inline");
    const frame = screen.getByTestId("artifact-frame") as HTMLIFrameElement;
    expect(frame.getAttribute("src")).toBe("https://files.example/signed?x=1");
    expect(frame.hasAttribute("sandbox")).toBe(true);
    expect(frame.getAttribute("sandbox")).toBe("");
    expect(frame.getAttribute("sandbox")).not.toContain("allow-same-origin");
    expect(frame.getAttribute("sandbox")).not.toContain("allow-scripts");
    expect(frame.getAttribute("referrerpolicy")).toBe("no-referrer");
    // The document itself never enters the app DOM.
    expect(document.body.innerHTML).not.toContain("<h1");

    expect(screen.getByText("report.html")).toBeInTheDocument();
    expect(screen.getByText("2.0 KB")).toBeInTheDocument();
    expect(screen.getByText("KAN-7")).toBeInTheDocument();
    expect(screen.getByTestId("open-new-tab")).toBeInTheDocument();
  });

  it("downloads through the attachment helper", async () => {
    renderViewer(html);
    fireEvent.click(screen.getByTestId("download-artifact"));
    await vi.waitFor(() =>
      expect(mocks.download).toHaveBeenCalledWith("p", "a1"),
    );
  });

  it("never requests an inline URL for a zip and offers download only", () => {
    renderViewer({
      ...html,
      id: "a2",
      name: "bundle.zip",
      contentType: "application/zip",
    });
    expect(mocks.url).toHaveBeenCalledWith("p", undefined, "inline");
    expect(screen.queryByTestId("artifact-frame")).not.toBeInTheDocument();
    expect(screen.queryByTestId("open-new-tab")).not.toBeInTheDocument();
    expect(screen.getByText("agentLayer:docs.viewerZip")).toBeInTheDocument();
  });

  it("shows the error state with retry when the URL cannot be minted", () => {
    const refetch = vi.fn();
    mocks.url.mockReturnValue({
      isPending: false,
      isError: true,
      error: new Error("boom"),
      refetch,
    });
    renderViewer(html);
    expect(screen.getByTestId("agent-layer-error")).toBeInTheDocument();
    fireEvent.click(screen.getByText("agentLayer:common.retry"));
    expect(refetch).toHaveBeenCalled();
  });

  it("does not frame a pdf (Chrome blocks its viewer in sandboxed frames) but offers new tab and download", () => {
    renderViewer({
      ...html,
      id: "a3",
      name: "summary.pdf",
      contentType: "application/pdf",
    });
    expect(mocks.url).toHaveBeenCalledWith("p", undefined, "inline");
    expect(screen.queryByTestId("artifact-frame")).not.toBeInTheDocument();
    const fallback = screen.getByTestId("viewer-fallback");
    expect(fallback).toHaveTextContent("agentLayer:docs.viewerPdf");
    expect(fallback).toHaveTextContent("agentLayer:docs.openInNewTab");
    expect(fallback).toHaveTextContent("agentLayer:docs.download");
  });
});
