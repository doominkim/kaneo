import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AgentLayerApiError } from "@/fetchers/agent-layer/api-error";
import { ArtifactUploader } from "./artifact-uploader";

const mocks = vi.hoisted(() => ({
  presign: vi.fn(),
  finalize: vi.fn(),
  put: vi.fn(),
  invalidate: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      options && "name" in options ? `${key}:${String(options.name)}` : key,
  }),
}));
vi.mock("@/lib/toast", () => ({
  toast: { success: mocks.toastSuccess, error: mocks.toastError },
}));
vi.mock("@/fetchers/agent-layer/presign-agent-artifact", () => ({
  default: mocks.presign,
}));
vi.mock("@/fetchers/agent-layer/finalize-agent-artifact", () => ({
  default: mocks.finalize,
}));
vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: mocks.invalidate }),
  useMutation: ({
    mutationFn,
    onSuccess,
  }: {
    mutationFn: (input: unknown) => Promise<unknown>;
    onSuccess?: (data: unknown, variables: unknown) => void;
  }) => ({
    isPending: false,
    mutateAsync: async (input: unknown) => {
      const result = await mutationFn(input);
      onSuccess?.(result, input);
      return result;
    },
  }),
}));
// The Select popup needs a real pointer environment; the trigger is enough
// to prove the control is present.
vi.mock("@/components/ui/select", () => ({
  Select: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  SelectTrigger: ({
    children,
    ...props
  }: { children: React.ReactNode } & Record<string, unknown>) => (
    <button type="button" data-testid={props["data-testid"] as string}>
      {children}
    </button>
  ),
  SelectValue: ({ children }: { children: React.ReactNode }) => (
    <span>{children}</span>
  ),
  SelectContent: () => null,
  SelectItem: () => null,
}));

class FakeXhr {
  static instances: FakeXhr[] = [];
  static status = 200;
  method = "";
  url = "";
  headers: Record<string, string> = {};
  body: unknown;
  status = 0;
  upload: { onprogress: ((event: ProgressEvent) => void) | null } = {
    onprogress: null,
  };
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onabort: (() => void) | null = null;

  constructor() {
    FakeXhr.instances.push(this);
  }
  open(method: string, url: string) {
    this.method = method;
    this.url = url;
  }
  setRequestHeader(name: string, value: string) {
    this.headers[name] = value;
  }
  send(body: unknown) {
    this.body = body;
    this.upload.onprogress?.({
      lengthComputable: true,
      loaded: 5,
      total: 10,
    } as ProgressEvent);
    this.status = FakeXhr.status;
    queueMicrotask(() => this.onload?.());
  }
  abort() {
    this.onabort?.();
  }
}

const presigned = {
  artifactId: "art-1",
  uploadUrl: "https://storage.example/put",
  storageKey: "agent-artifacts/ws/p/art-1/report.html",
  expiresAt: "2026-09-03T00:10:00.000Z",
  headers: { "Content-Type": "text/html" },
};

function renderUploader() {
  render(
    <ArtifactUploader
      projectId="p"
      projectSlug="KAN"
      tasks={[{ id: "t1", number: 7, title: "Ship it" }]}
    />,
  );
}

function dropFiles(files: File[]) {
  const zone = screen.getByTestId("artifact-dropzone");
  fireEvent.drop(zone, { dataTransfer: { files } });
}

beforeEach(() => {
  FakeXhr.instances = [];
  FakeXhr.status = 200;
  vi.stubGlobal("XMLHttpRequest", FakeXhr);
  mocks.presign.mockReset().mockResolvedValue(presigned);
  mocks.finalize.mockReset().mockResolvedValue({
    id: "art-1",
    projectId: "p",
    taskId: null,
    name: "report.html",
    contentType: "text/html",
    size: 12,
    uploadedBy: "user-1",
    actorId: null,
    createdAt: "2026-09-03T00:00:00.000Z",
  });
  mocks.invalidate.mockReset();
  mocks.toastSuccess.mockReset();
  mocks.toastError.mockReset();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("ArtifactUploader", () => {
  it("runs presign → PUT → finalize with the presigned headers and refreshes caches", async () => {
    renderUploader();
    const file = new File(["<h1>hi</h1>"], "report.html", {
      type: "text/html",
    });
    dropFiles([file]);

    await waitFor(() =>
      expect(screen.getByTestId("upload-row")).toHaveAttribute(
        "data-status",
        "done",
      ),
    );

    expect(mocks.presign).toHaveBeenCalledWith("p", {
      name: "report.html",
      contentType: "text/html",
      size: file.size,
      taskId: null,
    });
    expect(FakeXhr.instances).toHaveLength(1);
    const [xhr] = FakeXhr.instances;
    expect(xhr.method).toBe("PUT");
    expect(xhr.url).toBe(presigned.uploadUrl);
    expect(xhr.headers).toEqual({ "Content-Type": "text/html" });
    expect(xhr.body).toBe(file);
    expect(mocks.finalize).toHaveBeenCalledWith("p", {
      artifactId: "art-1",
      storageKey: presigned.storageKey,
    });
    expect(mocks.invalidate).toHaveBeenCalledWith({
      queryKey: ["agent-artifacts", "p"],
    });
    expect(mocks.invalidate).toHaveBeenCalledWith({
      queryKey: ["agent-tree", "p"],
    });
    expect(mocks.toastSuccess).toHaveBeenCalledWith(
      "agentLayer:docs.uploaded:report.html",
    );
  });

  it("infers text/markdown from the extension when the browser reports no type", async () => {
    renderUploader();
    dropFiles([new File(["# hi"], "notes.md", { type: "" })]);
    await waitFor(() => expect(mocks.presign).toHaveBeenCalled());
    expect(mocks.presign.mock.calls[0][1]).toMatchObject({
      contentType: "text/markdown",
    });
  });

  it("rejects unsupported and oversized files before any request", async () => {
    renderUploader();
    const big = new File([new Uint8Array(1)], "big.pdf", {
      type: "application/pdf",
    });
    Object.defineProperty(big, "size", { value: 10 * 1024 * 1024 + 1 });
    dropFiles([new File(["x"], "photo.png", { type: "image/png" }), big]);

    const rows = screen.getAllByTestId("upload-row");
    expect(rows).toHaveLength(2);
    expect(
      rows.map((row) => within(row).getByTestId("upload-error").textContent),
    ).toEqual([
      "agentLayer:docs.errorUnsupported",
      "agentLayer:docs.errorTooLarge",
    ]);
    expect(screen.queryByTestId("retry-upload")).not.toBeInTheDocument();
    expect(mocks.presign).not.toHaveBeenCalled();
    expect(FakeXhr.instances).toHaveLength(0);
  });

  it("asks for a re-upload on a finalize 400 and retries the whole sequence", async () => {
    mocks.finalize.mockRejectedValueOnce(
      new AgentLayerApiError(400, "Object size mismatch"),
    );
    renderUploader();
    dropFiles([new File(["<p/>"], "report.html", { type: "text/html" })]);

    const row = await screen.findByTestId("upload-row");
    await waitFor(() => expect(row).toHaveAttribute("data-status", "error"));
    expect(within(row).getByTestId("upload-error")).toHaveTextContent(
      "agentLayer:docs.errorMismatch",
    );

    fireEvent.click(within(row).getByTestId("retry-upload"));
    await waitFor(() => expect(row).toHaveAttribute("data-status", "done"));
    expect(mocks.presign).toHaveBeenCalledTimes(2);
    expect(FakeXhr.instances).toHaveLength(2);
    expect(mocks.finalize).toHaveBeenCalledTimes(2);
  });

  it("explains a 503 as storage being unavailable and offers a retry", async () => {
    mocks.presign.mockRejectedValueOnce(
      new AgentLayerApiError(503, "Storage is not configured"),
    );
    renderUploader();
    dropFiles([new File(["{}"], "data.json", { type: "application/json" })]);

    const row = await screen.findByTestId("upload-row");
    await waitFor(() => expect(row).toHaveAttribute("data-status", "error"));
    expect(within(row).getByTestId("upload-error")).toHaveTextContent(
      "agentLayer:docs.errorStorage",
    );
    expect(within(row).getByTestId("retry-upload")).toBeInTheDocument();
    expect(FakeXhr.instances).toHaveLength(0);
  });

  it("surfaces a storage PUT failure without calling finalize", async () => {
    FakeXhr.status = 403;
    renderUploader();
    dropFiles([new File(["a"], "a.txt", { type: "text/plain" })]);

    const row = await screen.findByTestId("upload-row");
    await waitFor(() => expect(row).toHaveAttribute("data-status", "error"));
    expect(within(row).getByTestId("upload-error")).toHaveTextContent(
      "agentLayer:docs.errorPut",
    );
    expect(mocks.finalize).not.toHaveBeenCalled();
  });

  it("accepts files from the picker as well", async () => {
    renderUploader();
    const input = screen.getByTestId("artifact-file-input") as HTMLInputElement;
    fireEvent.change(input, {
      target: { files: [new File(["x"], "x.txt", { type: "text/plain" })] },
    });
    await waitFor(() => expect(mocks.presign).toHaveBeenCalledTimes(1));
    expect(screen.getByTestId("upload-task-select")).toHaveTextContent(
      "agentLayer:docs.noTask",
    );
  });
});
