import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SpecTarget } from "@/fetchers/agent-layer/agent-spec-lifecycle";
import { SpecLifecycleActions } from "./spec-lifecycle";

const mocks = vi.hoisted(() => ({
  revisions: vi.fn(),
  revision: vi.fn(),
  revert: vi.fn(),
  remove: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("react-i18next", () => ({
  initReactI18next: { type: "3rdParty", init: () => {} },
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      options ? `${key}:${JSON.stringify(options)}` : key,
  }),
}));
vi.mock("@/lib/format", () => ({
  formatRelativeTime: (value: string) => `rel(${value})`,
  formatDateTime: (value: string) => `abs(${value})`,
}));
vi.mock("@/lib/toast", () => ({
  toast: { success: mocks.toastSuccess, error: mocks.toastError },
}));
vi.mock("@/components/public-project/markdown-renderer", () => ({
  MarkdownRenderer: ({ content }: { content: string }) => (
    <div data-testid="markdown">{content}</div>
  ),
}));
vi.mock("@/hooks/queries/agent-layer/use-agent-spec-revisions", () => ({
  useAgentSpecRevisions: mocks.revisions,
  useAgentSpecRevision: mocks.revision,
}));
vi.mock("@/hooks/mutations/agent-layer/use-agent-spec", () => ({
  useDeleteAgentSpec: () => ({ mutateAsync: mocks.remove, isPending: false }),
  useRevertAgentSpec: () => ({ mutateAsync: mocks.revert, isPending: false }),
}));

const target: SpecTarget = {
  kind: "design",
  projectId: "p1",
  feature: "spec-tabs",
};

// Newest first, as the API returns them.
const revisions = [
  {
    id: "r3",
    title: "Spec v3",
    createdAt: "2026-09-14T03:00:00.000Z",
    revertedFromId: "r1",
    createdBy: "u1",
    author: { userId: "u1", name: "Dominic" },
    actor: null,
  },
  {
    id: "r2",
    title: "Spec v2",
    createdAt: "2026-09-14T02:00:00.000Z",
    revertedFromId: null,
    createdBy: "u1",
    author: null,
    actor: {
      id: "a1",
      provider: "anthropic",
      model: "claude-opus-5",
      onBehalfOf: "u1",
    },
  },
  {
    id: "r1",
    title: "Spec v1",
    createdAt: "2026-09-14T01:00:00.000Z",
    revertedFromId: null,
    createdBy: "u2",
    author: { userId: "u2", name: "Mina" },
    actor: null,
  },
];

beforeEach(() => {
  mocks.revert.mockReset().mockResolvedValue({});
  mocks.remove.mockReset().mockResolvedValue({});
  mocks.toastSuccess.mockReset();
  mocks.toastError.mockReset();
  mocks.revisions.mockReset().mockReturnValue({
    isPending: false,
    isError: false,
    data: { revisions },
  });
  mocks.revision
    .mockReset()
    .mockImplementation((_target: SpecTarget, id: string | null) =>
      id
        ? {
            isPending: false,
            isError: false,
            data: {
              ...revisions.find((revision) => revision.id === id),
              body: `body of ${id}`,
              requirementKeys: id === "r2" ? ["REQ-SPEC-TABS-2"] : null,
            },
          }
        : { isPending: true, isError: false, data: undefined },
    );
});
afterEach(() => cleanup());

async function openHistory() {
  fireEvent.click(screen.getByTestId("open-revisions"));
  const dialog = await screen.findByTestId("revisions-dialog");
  return { dialog, rows: within(dialog).getAllByTestId("revision-row") };
}

describe("문서 리비전과 삭제", () => {
  it("[REQ-AGENT-AUTOAPPLY-25] lists revisions newest first with the author's name or model and the time, and previews the one picked", async () => {
    render(
      <SpecLifecycleActions target={target} canRevert canDelete={false} />,
    );
    const { dialog, rows } = await openHistory();
    expect(mocks.revisions).toHaveBeenCalledWith(target);

    expect(rows.map((row) => row.textContent?.slice(0, 7))).toEqual([
      "Spec v3",
      "Spec v2",
      "Spec v1",
    ]);
    expect(rows[0]).toHaveTextContent("Dominic");
    expect(rows[0]).toHaveTextContent("agentLayer:spec.revisionCurrent");
    expect(rows[0]).toHaveTextContent("agentLayer:spec.revisionReverted");
    expect(within(rows[1]).getByTestId("agent-author")).toHaveTextContent(
      "claude-opus-5",
    );
    expect(rows[2]).toHaveTextContent("Mina");
    const time = within(rows[0]).getByTestId("revision-time");
    expect(time).toHaveTextContent("rel(2026-09-14T03:00:00.000Z)");
    expect(time).toHaveAttribute("title", "abs(2026-09-14T03:00:00.000Z)");

    const preview = within(dialog).getByTestId("revision-preview");
    expect(preview).toHaveTextContent("agentLayer:spec.revisionPickHint");

    fireEvent.click(rows[1]);
    expect(rows[1]).toHaveAttribute("aria-pressed", "true");
    expect(mocks.revision).toHaveBeenLastCalledWith(target, "r2");
    expect(within(preview).getByTestId("markdown")).toHaveTextContent(
      "body of r2",
    );
    expect(preview).toHaveTextContent("REQ-SPEC-TABS-2");
  });

  it("[REQ-AGENT-AUTOAPPLY-25] reverts to the picked revision only after confirming, and never to the current one", async () => {
    render(
      <SpecLifecycleActions target={target} canRevert canDelete={false} />,
    );
    const { dialog, rows } = await openHistory();
    const revert = within(dialog).getByTestId("revert-revision");
    expect(revert).toBeDisabled();

    fireEvent.click(rows[0]);
    expect(revert).toBeDisabled();

    fireEvent.click(rows[2]);
    expect(revert).not.toBeDisabled();
    fireEvent.click(revert);

    const confirm = await screen.findByTestId("revert-dialog");
    expect(confirm).toHaveTextContent("agentLayer:spec.revertDescription");
    expect(mocks.revert).not.toHaveBeenCalled();

    fireEvent.click(within(confirm).getByTestId("revert-submit"));
    await waitFor(() =>
      expect(mocks.revert).toHaveBeenCalledWith({
        ...target,
        revisionId: "r1",
      }),
    );
    expect(mocks.toastSuccess).toHaveBeenCalledWith("agentLayer:spec.reverted");
  });

  it("[REQ-AGENT-AUTOAPPLY-25] a reader without task:update can read the history but not revert", async () => {
    render(
      <SpecLifecycleActions
        target={target}
        canRevert={false}
        canDelete={false}
      />,
    );
    const { dialog, rows } = await openHistory();
    fireEvent.click(rows[2]);
    expect(within(dialog).getByTestId("markdown")).toHaveTextContent(
      "body of r1",
    );
    expect(within(dialog).queryByTestId("revert-revision")).toBeNull();
  });

  it("[REQ-AGENT-AUTOAPPLY-18] deletes a document only after the confirm dialog, and only with project:update", async () => {
    const { unmount } = render(
      <SpecLifecycleActions target={target} canRevert canDelete={false} />,
    );
    expect(screen.queryByTestId("delete-spec")).toBeNull();
    unmount();

    render(<SpecLifecycleActions target={target} canRevert canDelete />);
    fireEvent.click(screen.getByTestId("delete-spec"));
    const dialog = await screen.findByTestId("delete-spec-dialog");
    expect(dialog).toHaveTextContent(
      'agentLayer:spec.deleteTitle:{"doc":"agentLayer:spec.docDesign","feature":"spec-tabs"}',
    );
    expect(mocks.remove).not.toHaveBeenCalled();

    fireEvent.click(within(dialog).getByTestId("delete-spec-submit"));
    await waitFor(() => expect(mocks.remove).toHaveBeenCalledWith(target));
    expect(mocks.toastSuccess).toHaveBeenCalledWith(
      'agentLayer:spec.deleted:{"doc":"agentLayer:spec.docDesign"}',
    );
  });
});
