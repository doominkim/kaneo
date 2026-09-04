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
import type { AgentTerm } from "@/fetchers/agent-layer/get-agent-terms";
import { DomainPage } from "./domain-page";

const mocks = vi.hoisted(() => ({
  update: vi.fn(),
  remove: vi.fn(),
  terms: vi.fn(),
  review: vi.fn(),
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
// The knowledge section is the real TermList (KAN-16): the review UI is
// reused here, not reimplemented, so only its data sources are stubbed.
vi.mock("@/hooks/queries/agent-layer/use-agent-terms", () => ({
  useAgentTerms: mocks.terms,
}));
vi.mock("@/hooks/mutations/agent-layer/use-confirm-agent-term", () => ({
  useConfirmAgentTerm: () => ({ mutateAsync: mocks.review, isPending: false }),
}));
vi.mock("@/hooks/mutations/agent-layer/use-delete-agent-term", () => ({
  useDeleteAgentTerm: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock("@/hooks/mutations/agent-layer/use-set-agent-term-domain", () => ({
  useSetAgentTermDomain: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock("@/hooks/queries/agent-layer/use-agent-domains", () => ({
  useAgentDomains: () => ({ data: { domains: [] }, isPending: false }),
}));
vi.mock("./domain-select", () => ({
  DomainSelect: () => <span data-testid="term-domain-select" />,
}));

function listedTerm(overrides: Partial<AgentTerm> & { id: string }): AgentTerm {
  return {
    canonical: "조제료",
    definition: "조제 행위에 붙는 수가.",
    aliases: [],
    notToConfuseWith: [],
    anchors: [],
    confidence: "proposed",
    state: "active",
    supersededBy: null,
    domainId: "d-pharmacist",
    actorId: null,
    actor: null,
    reviewerId: null,
    reviewer: null,
    reviewedAt: null,
    rejectReason: null,
    lastVerifiedAt: null,
    createdAt: "2026-09-03T00:00:00.000Z",
    ...overrides,
  };
}

function listTerms(terms: AgentTerm[]) {
  mocks.terms.mockReturnValue({
    isPending: false,
    isError: false,
    data: { terms },
    refetch: vi.fn(),
  });
}

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
  const view = render(
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
  const rerenderWith = (next: Partial<Parameters<typeof DomainPage>[0]> = {}) =>
    view.rerender(
      <DomainPage
        page={page}
        workspaceId="ws"
        nodes={[]}
        canEdit
        canManage
        onOpen={onOpen}
        onDeleted={onDeleted}
        {...overrides}
        {...next}
      />,
    );
  return { onOpen, onDeleted, rerenderWith };
}

beforeEach(() => {
  mocks.update.mockReset();
  mocks.remove.mockReset();
  mocks.review.mockReset().mockResolvedValue({ id: "t2" });
  mocks.toastSuccess.mockReset();
  mocks.toastError.mockReset();
  listTerms([listedTerm({ id: "t2" })]);
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
    // Scoped to the page body: the knowledge section below renders markdown of
    // its own, since a row awaiting review arrives with its definition open.
    expect(
      within(screen.getByTestId("domain-body")).getByTestId("markdown"),
    ).toHaveTextContent("복약지도를");

    expect(screen.getByTestId("child-link")).toHaveAttribute(
      "href",
      "/dashboard/workspace/ws/domain/d-license",
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

  it("reviews knowledge in place, off the list API rather than the page aggregate", async () => {
    // `page.terms` names 복약지도 and 조제료; the list API is the only source
    // that carries the definition and provenance a review rests on, so the
    // rows must come from it.
    listTerms([listedTerm({ id: "t9", canonical: "조제수가" })]);
    const { rerenderWith } = renderPage();

    expect(mocks.terms).toHaveBeenLastCalledWith("ws", {
      confidence: undefined,
      state: undefined,
      domainId: "d-pharmacist",
    });
    const section = within(screen.getByTestId("domain-terms"));
    expect(section.getByTestId("term-row")).toHaveTextContent("조제수가");
    expect(section.queryByText("복약지도")).toBeNull();

    expect(section.getByTestId("confidence-badge")).toHaveTextContent(
      "agentLayer:confidence.proposed",
    );
    expect(section.getByTestId("unconfirmed-hint")).toBeInTheDocument();

    fireEvent.click(section.getByTestId("confirm-term"));
    fireEvent.click(
      within(await screen.findByTestId("review-dialog")).getByTestId(
        "review-submit",
      ),
    );
    await waitFor(() =>
      expect(mocks.review).toHaveBeenCalledWith({
        workspaceId: "ws",
        termId: "t9",
        confidence: "confirmed",
      }),
    );

    // The invalidated query comes back confirmed and the row leaves the
    // pending group: confirmed badge, no "agents cannot read this" hint.
    listTerms([
      listedTerm({ id: "t9", canonical: "조제수가", confidence: "confirmed" }),
    ]);
    rerenderWith();
    const reviewed = within(screen.getByTestId("domain-terms"));
    expect(reviewed.getByTestId("confidence-badge")).toHaveTextContent(
      "agentLayer:confidence.confirmed",
    );
    expect(reviewed.queryByTestId("unconfirmed-hint")).toBeNull();
  });

  it("will not take a dispute without a reason", async () => {
    renderPage();
    fireEvent.click(
      within(screen.getByTestId("domain-terms")).getByTestId("dispute-term"),
    );
    const dialog = await screen.findByTestId("review-dialog");
    expect(within(dialog).getByTestId("review-submit")).toBeDisabled();

    fireEvent.change(within(dialog).getByTestId("reject-reason-input"), {
      target: { value: "   " },
    });
    expect(within(dialog).getByTestId("review-submit")).toBeDisabled();
    expect(mocks.review).not.toHaveBeenCalled();

    fireEvent.change(within(dialog).getByTestId("reject-reason-input"), {
      target: { value: "조제료와 다른 개념." },
    });
    fireEvent.click(within(dialog).getByTestId("review-submit"));
    await waitFor(() =>
      expect(mocks.review).toHaveBeenCalledWith({
        workspaceId: "ws",
        termId: "t2",
        confidence: "disputed",
        rejectReason: "조제료와 다른 개념.",
      }),
    );
  });

  it("offers no review controls without workspace:update", () => {
    renderPage({ canManage: false });
    const section = within(screen.getByTestId("domain-terms"));
    expect(section.queryByTestId("confirm-term")).toBeNull();
    expect(section.queryByTestId("dispute-term")).toBeNull();
    // The filters stay: reading the queue is not the same as acting on it.
    expect(section.getByTestId("confidence-filter")).toBeInTheDocument();
  });

  it("opens the child and move dialogs from the header", () => {
    renderPage();
    fireEvent.click(screen.getByTestId("add-child-domain"));
    expect(screen.getByTestId("create-dialog")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("move-domain"));
    expect(screen.getByTestId("move-dialog")).toBeInTheDocument();
  });
});
