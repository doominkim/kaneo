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
import type { AgentDomainPage } from "@/fetchers/agent-layer/get-agent-domain";
import { DomainPage } from "./domain-page";

const mocks = vi.hoisted(() => ({
  update: vi.fn(),
  remove: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("@tanstack/react-router", () => ({
  Link: ({
    children,
    to,
    params,
    ...rest
  }: {
    children: React.ReactNode;
    to: string;
    params?: Record<string, string>;
    [key: string]: unknown;
  }) => (
    <a
      href={Object.entries(params ?? {}).reduce(
        (href, [key, value]) => href.replace(`$${key}`, value),
        to,
      )}
      {...rest}
    >
      {children}
    </a>
  ),
}));
vi.mock("react-i18next", () => ({
  initReactI18next: { type: "3rdParty", init: () => {} },
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      options
        ? `${key} ${Object.entries(options)
            .map(([name, value]) => `${name}=${String(value)}`)
            .join(" ")}`
        : key,
  }),
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
vi.mock("@/hooks/mutations/agent-layer/use-update-agent-domain", () => ({
  useUpdateAgentDomain: () => ({
    mutateAsync: mocks.update,
    isPending: false,
  }),
}));
vi.mock("@/hooks/mutations/agent-layer/use-delete-agent-domain", () => ({
  useDeleteAgentDomain: () => ({
    mutateAsync: mocks.remove,
    isPending: false,
  }),
}));
vi.mock("./create-domain-dialog", () => ({
  CreateDomainDialog: ({ open }: { open: boolean }) =>
    open ? <div data-testid="create-dialog" /> : null,
}));
vi.mock("./move-domain-dialog", () => ({
  MoveDomainDialog: ({ open }: { open: boolean }) =>
    open ? <div data-testid="move-dialog" /> : null,
}));

const page: AgentDomainPage = {
  id: "d-pharmacist",
  workspaceId: "ws",
  parentId: "d-pharmacy",
  slug: "pharmacist",
  title: "약사",
  body: "# 약사\n\n조제와 복약지도를 맡는다.",
  position: 0,
  updatedBy: "user-1",
  actorId: null,
  author: { userId: "user-1", name: "Dominic" },
  actor: null,
  createdAt: "2026-09-03T00:00:00.000Z",
  updatedAt: "2026-09-03T00:00:00.000Z",
  ancestors: [{ id: "d-pharmacy", slug: "pharmacy", title: "약국" }],
  children: [{ id: "d-license", slug: "license", title: "면허" }],
  terms: [
    {
      id: "t1",
      canonical: "복약지도",
      confidence: "confirmed",
      state: "active",
    },
    { id: "t2", canonical: "조제료", confidence: "proposed", state: "active" },
  ],
  projects: [{ id: "p1", name: "Vanpharm", slug: "VAN" }],
  documents: [
    {
      id: "doc1",
      projectId: "p1",
      slug: "pharmacist-onboarding",
      title: "약사 온보딩",
      updatedAt: "2026-09-03T00:00:00.000Z",
    },
  ],
};

function renderPage(overrides: Partial<Parameters<typeof DomainPage>[0]> = {}) {
  const onOpen = vi.fn();
  const onDeleted = vi.fn();
  render(
    <DomainPage
      page={page}
      workspaceId="ws"
      nodes={[]}
      canEdit
      canManage
      onOpen={onOpen}
      onDeleted={onDeleted}
      {...overrides}
    />,
  );
  return { onOpen, onDeleted };
}

beforeEach(() => {
  mocks.update.mockReset();
  mocks.remove.mockReset();
  mocks.toastSuccess.mockReset();
  mocks.toastError.mockReset();
});

afterEach(() => cleanup());

describe("DomainPage", () => {
  it("renders the breadcrumb, author line, body and every aggregate", () => {
    renderPage();
    const crumbs = within(screen.getByTestId("domain-breadcrumb"));
    expect(crumbs.getByTestId("breadcrumb-ancestor")).toHaveAttribute(
      "href",
      "/dashboard/workspace/ws/domain/d-pharmacy",
    );
    expect(crumbs.getByText("약사")).toHaveAttribute("aria-current", "page");

    expect(screen.getByTestId("domain-title")).toHaveTextContent("약사");
    expect(screen.getByTestId("entry-author")).toHaveAttribute(
      "data-author-kind",
      "human",
    );
    expect(screen.getByTestId("markdown")).toHaveTextContent("복약지도를");

    expect(screen.getByTestId("child-link")).toHaveAttribute(
      "href",
      "/dashboard/workspace/ws/domain/d-license",
    );
    const terms = screen.getAllByTestId("domain-term");
    expect(terms).toHaveLength(2);
    expect(within(terms[0]).getByTestId("confidence-badge")).toHaveTextContent(
      "agentLayer:confidence.confirmed",
    );
    expect(screen.getByTestId("domain-project")).toHaveAttribute(
      "href",
      "/dashboard/workspace/ws/project/p1/overview",
    );
    expect(screen.getByTestId("domain-document")).toHaveAttribute(
      "href",
      "/dashboard/workspace/ws/project/p1/docs/pharmacist-onboarding",
    );
  });

  it("shows the model badge when an agent wrote the body", () => {
    renderPage({
      page: {
        ...page,
        author: null,
        actor: {
          id: "a1",
          provider: "anthropic",
          model: "claude-fable-5-1",
          onBehalfOf: "user-1",
        },
      },
    });
    expect(screen.getByTestId("entry-author")).toHaveAttribute(
      "data-author-kind",
      "agent",
    );
    expect(screen.getByTestId("agent-author")).toHaveTextContent(
      "claude-fable-5-1",
    );
  });

  it("gates edit on task:update and move/delete on workspace:update", () => {
    renderPage({ canEdit: false, canManage: false });
    expect(screen.queryByTestId("edit-domain")).not.toBeInTheDocument();
    expect(screen.queryByTestId("add-child-domain")).not.toBeInTheDocument();
    expect(screen.queryByTestId("move-domain")).not.toBeInTheDocument();
    expect(screen.queryByTestId("delete-domain")).not.toBeInTheDocument();
  });

  it("edits title and body with a byte counter and saves a full replacement", async () => {
    mocks.update.mockResolvedValue({ ...page, body: "changed" });
    renderPage();
    fireEvent.click(screen.getByTestId("edit-domain"));
    expect(screen.getByTestId("byte-counter")).toHaveTextContent(
      "agentLayer:domain.byteCounter used=",
    );
    fireEvent.change(screen.getByTestId("editor"), {
      target: { value: "changed" },
    });
    fireEvent.change(screen.getByLabelText("agentLayer:domain.titleLabel"), {
      target: { value: " 약사 (신규) " },
    });
    fireEvent.click(screen.getByTestId("save-domain"));
    await waitFor(() =>
      expect(mocks.update).toHaveBeenCalledWith({
        workspaceId: "ws",
        domainId: "d-pharmacist",
        body: { title: "약사 (신규)", body: "changed" },
      }),
    );
    expect(mocks.toastSuccess).toHaveBeenCalledWith("agentLayer:domain.saved");
    expect(screen.queryByTestId("editor")).not.toBeInTheDocument();
  });

  it("blocks saving a body over 200KB", () => {
    renderPage();
    fireEvent.click(screen.getByTestId("edit-domain"));
    fireEvent.change(screen.getByTestId("editor"), {
      target: { value: "x".repeat(200 * 1024 + 1) },
    });
    expect(screen.getByTestId("save-domain")).toBeDisabled();
  });

  it("shows the API's 409 counts verbatim inside the delete dialog", async () => {
    mocks.remove.mockRejectedValue(
      new AgentLayerApiError(
        409,
        "Domain still has 1 child, 2 terms, 1 document and 1 project",
      ),
    );
    const { onDeleted } = renderPage();
    fireEvent.click(screen.getByTestId("delete-domain"));
    fireEvent.click(await screen.findByTestId("confirm-delete-domain"));
    const error = await screen.findByTestId("delete-domain-error");
    expect(error).toHaveTextContent(
      "agentLayer:domain.deleteRefused Domain still has 1 child, 2 terms, 1 document and 1 project",
    );
    expect(screen.getByTestId("delete-domain-dialog")).toBeInTheDocument();
    expect(onDeleted).not.toHaveBeenCalled();
    expect(mocks.toastError).not.toHaveBeenCalled();
  });

  it("hands the parent back after a successful delete", async () => {
    mocks.remove.mockResolvedValue({ id: page.id, slug: page.slug });
    const { onDeleted } = renderPage();
    fireEvent.click(screen.getByTestId("delete-domain"));
    fireEvent.click(await screen.findByTestId("confirm-delete-domain"));
    await waitFor(() => expect(onDeleted).toHaveBeenCalledWith("d-pharmacy"));
    expect(mocks.remove).toHaveBeenCalledWith({
      workspaceId: "ws",
      domainId: "d-pharmacist",
    });
  });

  it("opens the child and move dialogs from the header", () => {
    renderPage();
    fireEvent.click(screen.getByTestId("add-child-domain"));
    expect(screen.getByTestId("create-dialog")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("move-domain"));
    expect(screen.getByTestId("move-dialog")).toBeInTheDocument();
  });
});
