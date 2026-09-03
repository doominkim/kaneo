import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AgentLayerApiError } from "@/fetchers/agent-layer/api-error";
import { EntryComposer } from "./entry-composer";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      options && Object.keys(options).length > 0
        ? `${key}:${Object.values(options).join("/")}`
        : key,
  }),
}));
const mocks = vi.hoisted(() => ({
  append: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));
vi.mock("@/lib/toast", () => ({
  toast: { success: mocks.toastSuccess, error: mocks.toastError },
}));
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
vi.mock("@/hooks/mutations/agent-layer/use-append-agent-entry", () => ({
  useAppendAgentEntry: () => ({ mutateAsync: mocks.append, isPending: false }),
}));

function typeInto(testId: string, value: string) {
  fireEvent.change(screen.getByTestId(testId), { target: { value } });
}

async function submit() {
  fireEvent.click(screen.getByTestId("composer-submit"));
  // Let the awaited mutation settle before assertions.
  await Promise.resolve();
  await Promise.resolve();
}

beforeEach(() => {
  mocks.append.mockReset().mockResolvedValue({ id: "e-new" });
  mocks.toastSuccess.mockReset();
  mocks.toastError.mockReset();
});

afterEach(() => {
  cleanup();
});

describe("EntryComposer", () => {
  it("refuses an empty summary and one over 200 characters without calling the API", async () => {
    render(<EntryComposer projectId="p" taskId="t1" onClose={vi.fn()} />);

    await submit();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "agentLayer:composer.summaryRequired",
    );
    expect(mocks.append).not.toHaveBeenCalled();

    typeInto("composer-summary", "x".repeat(201));
    expect(screen.getByTestId("composer-summary-counter")).toHaveTextContent(
      "agentLayer:composer.summaryCounter:201/200",
    );
    await submit();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "agentLayer:composer.summaryTooLong:200",
    );
    expect(mocks.append).not.toHaveBeenCalled();
  });

  it("posts a human work entry: task id, body, prefilled branch, and no agent fields at all", async () => {
    const onClose = vi.fn();
    render(
      <EntryComposer
        projectId="p"
        taskId="t1"
        defaultBranch={{ repo: "doominkim/kaneo", branch: "feat/kan-12" }}
        onClose={onClose}
      />,
    );

    expect(screen.getByTestId("composer-branch")).toHaveValue("feat/kan-12");
    expect(screen.getByTestId("composer-repo")).toHaveValue("doominkim/kaneo");
    expect(screen.getByTestId("editor").dataset.attach).toBe("false");
    // Decision fields stay hidden for the default kind.
    expect(screen.queryByTestId("composer-decision")).toBeNull();

    typeInto("composer-summary", "  Reviewed the composer  ");
    typeInto("editor", "Looked at **both** paths.");
    await submit();

    expect(mocks.append).toHaveBeenCalledTimes(1);
    const body = mocks.append.mock.calls[0][0];
    expect(body).toEqual({
      projectId: "p",
      taskId: "t1",
      kind: "work",
      summary: "Reviewed the composer",
      body: "Looked at **both** paths.",
      refs: { repo: "doominkim/kaneo", branch: "feat/kan-12" },
    });
    // Presence — not value — is what the API reads as "an agent wrote this".
    for (const key of ["provider", "model", "effort", "agentLabel", "usage"]) {
      expect(Object.hasOwn(body, key)).toBe(false);
    }
    expect(mocks.toastSuccess).toHaveBeenCalledWith(
      "agentLayer:composer.saved",
    );
    expect(onClose).toHaveBeenCalled();
  });

  it("omits taskId and refs for a project-level note with no branch", async () => {
    render(<EntryComposer projectId="p" onClose={vi.fn()} />);
    expect(screen.getByTestId("entry-composer").dataset.scope).toBe("project");

    typeInto("composer-summary", "Project-wide note");
    await submit();

    const body = mocks.append.mock.calls[0][0];
    expect(body).toEqual({
      projectId: "p",
      kind: "work",
      summary: "Project-wide note",
    });
    expect(Object.hasOwn(body, "taskId")).toBe(false);
  });

  it("reveals decision fields, requires what and why, and posts the decision", async () => {
    render(<EntryComposer projectId="p" taskId="t1" onClose={vi.fn()} />);

    const decisionKind = screen
      .getByTestId("composer-kind")
      .querySelector('[data-kind="decision"]');
    if (!decisionKind) throw new Error("decision kind button missing");
    fireEvent.click(decisionKind);
    expect(decisionKind).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("composer-decision")).toBeInTheDocument();

    typeInto("composer-summary", "Segmented control over a Select");
    await submit();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "agentLayer:composer.decisionRequired",
    );
    expect(mocks.append).not.toHaveBeenCalled();

    typeInto("composer-what", "Use a segmented control for kind");
    typeInto("composer-why", "Four options; visible at once");
    typeInto("composer-rejected", "Base UI Select");
    fireEvent.click(screen.getByTestId("composer-reversible"));
    await submit();

    expect(mocks.append).toHaveBeenCalledTimes(1);
    expect(mocks.append.mock.calls[0][0]).toMatchObject({
      kind: "decision",
      decision: {
        what: "Use a segmented control for kind",
        why: "Four options; visible at once",
        rejected: "Base UI Select",
        reversible: false,
      },
    });
  });

  it("surfaces the API's 400 message and maps 403 to the permission hint", async () => {
    const onClose = vi.fn();
    render(<EntryComposer projectId="p" taskId="t1" onClose={onClose} />);
    typeInto("composer-summary", "Will fail");

    mocks.append.mockRejectedValueOnce(
      new AgentLayerApiError(400, "refs.branch: too long"),
    );
    await submit();
    expect(mocks.toastError).toHaveBeenCalledWith(
      "agentLayer:composer.failed",
      { description: "refs.branch: too long" },
    );
    expect(onClose).not.toHaveBeenCalled();

    mocks.append.mockRejectedValueOnce(new AgentLayerApiError(403, ""));
    await submit();
    expect(mocks.toastError).toHaveBeenLastCalledWith(
      "agentLayer:composer.failed",
      { description: "agentLayer:composer.forbidden" },
    );
  });

  it("cancel closes without posting", () => {
    const onClose = vi.fn();
    render(<EntryComposer projectId="p" taskId="t1" onClose={onClose} />);
    fireEvent.click(screen.getByTestId("composer-cancel"));
    expect(onClose).toHaveBeenCalled();
    expect(mocks.append).not.toHaveBeenCalled();
  });
});
