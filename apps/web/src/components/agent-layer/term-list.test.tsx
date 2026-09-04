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
import type { AgentTerm } from "@/fetchers/agent-layer/get-agent-terms";
import { TermList } from "./term-list";

const mocks = vi.hoisted(() => ({
  terms: vi.fn(),
  review: vi.fn(),
  remove: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
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
vi.mock("@/components/public-project/markdown-renderer", () => ({
  MarkdownRenderer: ({ content }: { content: string }) => (
    <div data-testid="markdown">{content}</div>
  ),
}));
vi.mock("@/hooks/queries/agent-layer/use-agent-terms", () => ({
  useAgentTerms: mocks.terms,
}));
vi.mock("@/hooks/mutations/agent-layer/use-confirm-agent-term", () => ({
  useConfirmAgentTerm: () => ({ mutateAsync: mocks.review, isPending: false }),
}));
vi.mock("@/hooks/mutations/agent-layer/use-delete-agent-term", () => ({
  useDeleteAgentTerm: () => ({ mutateAsync: mocks.remove, isPending: false }),
}));
vi.mock("@/hooks/queries/agent-layer/use-agent-domains", () => ({
  useAgentDomains: () => ({ data: { domains: [] }, isPending: false }),
}));
vi.mock("@/hooks/mutations/agent-layer/use-set-agent-term-domain", () => ({
  useSetAgentTermDomain: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock("@tanstack/react-router", () => ({
  Link: ({ children }: { children: React.ReactNode }) => (
    <a href="/">{children}</a>
  ),
}));
vi.mock("./domain-select", () => ({
  DomainSelect: () => <span data-testid="term-domain-select" />,
}));

function term(overrides: Partial<AgentTerm> & { id: string }): AgentTerm {
  return {
    canonical: "급여코드",
    definition: null,
    aliases: [],
    notToConfuseWith: [],
    anchors: [],
    confidence: "proposed",
    state: "active",
    supersededBy: null,
    domainId: null,
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

const terms: AgentTerm[] = [
  term({
    id: "t1",
    canonical: "급여코드",
    definition: "The **benefit** code.",
    aliases: ["보험코드", "BenefitCode"],
    notToConfuseWith: ["claim-code"],
    anchors: [
      { kind: "db", table: "benefits", column: "benefit_cd" },
      { kind: "code", path: "src/benefit.ts", symbol: "BenefitCode" },
      { kind: "doc", url: "https://example.com/spec" },
      { bogus: true },
    ],
  }),
  term({
    id: "t2",
    canonical: "청구코드",
    confidence: "confirmed",
    reviewerId: "u1",
    reviewer: { userId: "u1", name: "Dominic" },
    reviewedAt: "2026-09-03T02:00:00.000Z",
    lastVerifiedAt: "2026-09-03T00:00:00.000Z",
  }),
  term({
    id: "t3",
    canonical: "구코드",
    confidence: "disputed",
    state: "retired",
    supersededBy: "t2",
    actorId: "a1",
    actor: {
      id: "a1",
      provider: "anthropic",
      model: "claude-opus-5",
      onBehalfOf: null,
    },
    reviewerId: "u1",
    reviewer: { userId: "u1", name: "Dominic" },
    reviewedAt: "2026-09-03T02:00:00.000Z",
    rejectReason: "Superseded by 청구코드; the old spelling is ambiguous.",
  }),
];

beforeEach(() => {
  mocks.review.mockReset().mockResolvedValue(terms[0]);
  mocks.remove
    .mockReset()
    .mockResolvedValue({ id: "t1", canonical: "급여코드" });
  mocks.toastSuccess.mockReset();
  mocks.toastError.mockReset();
  mocks.terms.mockReset().mockReturnValue({
    isPending: false,
    isError: false,
    data: { terms },
    refetch: vi.fn(),
  });
});

afterEach(() => cleanup());

describe("TermList", () => {
  it("renders canonical, aliases, anchors, not-to-confuse and badges per row", () => {
    render(<TermList workspaceId="ws" canReview={false} />);

    const rows = screen.getAllByTestId("term-row");
    expect(rows).toHaveLength(3);

    const first = rows[0];
    expect(first).toHaveTextContent("급여코드");
    expect(
      within(first)
        .getAllByTestId("alias-chip")
        .map((chip) => chip.textContent),
    ).toEqual(["보험코드", "BenefitCode"]);
    expect(within(first).getByTestId("confidence-badge")).toHaveTextContent(
      "agentLayer:confidence.proposed",
    );
    expect(within(first).getByTestId("not-to-confuse")).toHaveTextContent(
      "claim-code",
    );
    expect(
      within(first)
        .getAllByTestId("anchor-chip")
        .map((chip) => chip.getAttribute("title")),
    ).toEqual([
      "db benefits.benefit_cd",
      "code src/benefit.ts#BenefitCode",
      "doc https://example.com/spec",
    ]);

    // Definition is collapsed until asked for.
    expect(screen.queryByTestId("markdown")).not.toBeInTheDocument();
    fireEvent.click(within(first).getByTestId("definition-toggle"));
    expect(within(first).getByTestId("markdown")).toHaveTextContent(
      "The **benefit** code.",
    );

    // Active terms carry no state badge; the retired one shows its tombstone.
    expect(within(first).queryByTestId("state-badge")).not.toBeInTheDocument();
    expect(within(rows[2]).getByTestId("state-badge")).toHaveTextContent(
      "agentLayer:state.retired",
    );
    expect(rows[2]).toHaveTextContent(
      "agentLayer:knowledge.supersededBy id=t2",
    );
  });

  it("drives the query with the confidence and state filters", () => {
    render(<TermList workspaceId="ws" canReview={false} />);
    expect(mocks.terms).toHaveBeenLastCalledWith("ws", {
      confidence: undefined,
      state: undefined,
      domainId: undefined,
    });

    fireEvent.click(
      within(screen.getByTestId("confidence-filter")).getByText(
        "agentLayer:confidence.proposed",
      ),
    );
    expect(mocks.terms).toHaveBeenLastCalledWith("ws", {
      confidence: "proposed",
      state: undefined,
      domainId: undefined,
    });

    fireEvent.click(
      within(screen.getByTestId("state-filter")).getByText(
        "agentLayer:state.retired",
      ),
    );
    expect(mocks.terms).toHaveBeenLastCalledWith("ws", {
      confidence: "proposed",
      state: "retired",
      domainId: undefined,
    });
  });

  it("scopes the query to a domain, including the unfiled bucket", () => {
    render(<TermList workspaceId="ws" canReview domainId="d-pharmacy" />);
    expect(mocks.terms).toHaveBeenLastCalledWith("ws", {
      confidence: undefined,
      state: undefined,
      domainId: "d-pharmacy",
    });
    cleanup();

    render(<TermList workspaceId="ws" canReview domainId="none" />);
    expect(mocks.terms).toHaveBeenLastCalledWith("ws", {
      confidence: undefined,
      state: undefined,
      domainId: "none",
    });
  });

  it("shows only confirmed items and no review controls in the read-only view", () => {
    render(<TermList workspaceId="ws" canReview confirmedOnly />);

    // The confidence is pinned by the caller rather than by a filter chip, so
    // the surface cannot be mistaken for the review queue.
    expect(mocks.terms).toHaveBeenLastCalledWith("ws", {
      confidence: "confirmed",
      state: undefined,
      domainId: undefined,
    });
    expect(screen.queryByTestId("confidence-filter")).not.toBeInTheDocument();
    expect(screen.queryByTestId("state-filter")).not.toBeInTheDocument();

    // workspace:update is not enough to review here.
    expect(screen.queryByTestId("confirm-term")).not.toBeInTheDocument();
    expect(screen.queryByTestId("dispute-term")).not.toBeInTheDocument();
    expect(screen.queryByTestId("delete-term")).not.toBeInTheDocument();
    expect(screen.queryByTestId("term-domain-select")).not.toBeInTheDocument();
  });

  it("hides review actions without workspace:update", () => {
    render(<TermList workspaceId="ws" canReview={false} />);
    expect(screen.queryByTestId("confirm-term")).not.toBeInTheDocument();
    expect(screen.queryByTestId("dispute-term")).not.toBeInTheDocument();
  });

  it("confirms through the dialog when the viewer may review", async () => {
    render(<TermList workspaceId="ws" canReview />);

    const rows = screen.getAllByTestId("term-row");
    // Already-confirmed rows cannot be confirmed again; disputed cannot be re-disputed.
    expect(within(rows[1]).getByTestId("confirm-term")).toBeDisabled();
    expect(within(rows[2]).getByTestId("dispute-term")).toBeDisabled();

    fireEvent.click(within(rows[0]).getByTestId("confirm-term"));
    const dialog = await screen.findByTestId("review-dialog");
    expect(dialog).toHaveTextContent(
      "agentLayer:knowledge.confirmTitle term=급여코드",
    );
    expect(mocks.review).not.toHaveBeenCalled();

    fireEvent.click(within(dialog).getByTestId("review-submit"));
    await waitFor(() =>
      expect(mocks.review).toHaveBeenCalledWith({
        workspaceId: "ws",
        termId: "t1",
        confidence: "confirmed",
      }),
    );
    expect(mocks.toastSuccess).toHaveBeenCalled();
  });

  it("refuses to dispute without a reason, and sends the reason once given", async () => {
    render(<TermList workspaceId="ws" canReview />);
    fireEvent.click(
      within(screen.getAllByTestId("term-row")[1]).getByTestId("dispute-term"),
    );
    const dialog = await screen.findByTestId("review-dialog");
    expect(dialog).toHaveTextContent(
      "agentLayer:knowledge.disputeTitle term=청구코드",
    );

    // An empty reason is not a dispute the next reviewer can act on.
    expect(within(dialog).getByTestId("review-submit")).toBeDisabled();
    expect(
      within(dialog).getByTestId("reject-reason-required"),
    ).toHaveTextContent("agentLayer:knowledge.disputeReasonRequired");

    // Whitespace is not a reason either.
    fireEvent.change(within(dialog).getByTestId("reject-reason-input"), {
      target: { value: "   " },
    });
    expect(within(dialog).getByTestId("review-submit")).toBeDisabled();

    fireEvent.change(within(dialog).getByTestId("reject-reason-input"), {
      target: { value: "  Means the claim code, not the benefit code.  " },
    });
    expect(
      within(dialog).queryByTestId("reject-reason-required"),
    ).not.toBeInTheDocument();

    fireEvent.click(within(dialog).getByTestId("review-submit"));
    await waitFor(() =>
      expect(mocks.review).toHaveBeenCalledWith({
        workspaceId: "ws",
        termId: "t2",
        confidence: "disputed",
        rejectReason: "Means the claim code, not the benefit code.",
      }),
    );
  });

  it("keeps the API's 400 next to the reason field", async () => {
    mocks.review.mockRejectedValueOnce(
      new AgentLayerApiError(400, "rejectReason is required when disputing"),
    );
    render(<TermList workspaceId="ws" canReview />);
    fireEvent.click(
      within(screen.getAllByTestId("term-row")[1]).getByTestId("dispute-term"),
    );
    const dialog = await screen.findByTestId("review-dialog");
    fireEvent.change(within(dialog).getByTestId("reject-reason-input"), {
      target: { value: "wrong" },
    });
    fireEvent.click(within(dialog).getByTestId("review-submit"));

    expect(
      await within(dialog).findByTestId("reject-reason-error"),
    ).toHaveTextContent("rejectReason is required when disputing");
    expect(mocks.toastError).not.toHaveBeenCalled();
    expect(screen.getByTestId("review-dialog")).toBeInTheDocument();
  });

  it("asks for no reason when confirming", async () => {
    render(<TermList workspaceId="ws" canReview />);
    fireEvent.click(
      within(screen.getAllByTestId("term-row")[0]).getByTestId("confirm-term"),
    );
    const dialog = await screen.findByTestId("review-dialog");
    expect(
      within(dialog).queryByTestId("reject-reason-input"),
    ).not.toBeInTheDocument();
    expect(within(dialog).getByTestId("review-submit")).not.toBeDisabled();
  });

  it("marks unconfirmed terms as invisible to agents, and shows review provenance", () => {
    render(<TermList workspaceId="ws" canReview={false} />);
    const [proposed, confirmed, disputed] = screen.getAllByTestId("term-row");

    // Proposed: the badge plus the reason the badge matters.
    expect(within(proposed).getByTestId("confidence-badge")).toHaveTextContent(
      "agentLayer:confidence.proposed",
    );
    expect(within(proposed).getByTestId("unconfirmed-hint")).toHaveTextContent(
      "agentLayer:knowledge.unconfirmedHint",
    );
    expect(within(proposed).queryByTestId("term-review")).toBeNull();

    // Reviewed: who and when, in the row itself.
    expect(within(confirmed).queryByTestId("unconfirmed-hint")).toBeNull();
    expect(within(confirmed).getByTestId("term-review")).toHaveTextContent(
      "agentLayer:knowledge.reviewedBy name=Dominic time=2 hours ago",
    );

    // Disputed: the reason it was rejected travels with the row.
    expect(within(disputed).getByTestId("reject-reason")).toHaveTextContent(
      "Superseded by 청구코드; the old spelling is ambiguous.",
    );
    expect(within(disputed).getByTestId("term-review")).toHaveTextContent(
      "agentLayer:knowledge.reviewedBy name=Dominic time=2 hours ago",
    );
  });

  it("opens the definition of an item that still needs a decision", () => {
    mocks.terms.mockReturnValue({
      isPending: false,
      isError: false,
      data: {
        terms: [
          term({
            id: "p1",
            canonical: "조제료",
            definition: "The **dispensing** fee.",
          }),
          term({
            id: "c1",
            canonical: "청구코드",
            confidence: "confirmed",
            definition: "The claim code.",
          }),
        ],
      },
      refetch: vi.fn(),
    });
    render(<TermList workspaceId="ws" canReview />);
    const [proposed, confirmed] = screen.getAllByTestId("term-row");

    // A reviewer cannot judge what is hidden, so the unconfirmed row arrives
    // readable; the confirmed one has nothing to decide and stays scannable.
    expect(within(proposed).getByTestId("markdown")).toHaveTextContent(
      "The **dispensing** fee.",
    );
    expect(within(proposed).getByTestId("definition-toggle")).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    expect(within(confirmed).queryByTestId("markdown")).toBeNull();

    // Expanded by default is still a toggle, not a fixed state.
    fireEvent.click(within(proposed).getByTestId("definition-toggle"));
    expect(within(proposed).queryByTestId("markdown")).toBeNull();
  });

  it("leaves definitions collapsed where the viewer cannot review", () => {
    const withDefinition = [
      term({
        id: "p1",
        canonical: "조제료",
        definition: "The **dispensing** fee.",
      }),
    ];
    mocks.terms.mockReturnValue({
      isPending: false,
      isError: false,
      data: { terms: withDefinition },
      refetch: vi.fn(),
    });

    // The read-only knowledge tab: the same unconfirmed row, collapsed —
    // the surface is for scanning the lexicon, not for deciding on it.
    render(<TermList workspaceId="ws" canReview confirmedOnly />);
    expect(screen.queryByTestId("markdown")).toBeNull();
    expect(screen.getByTestId("definition-toggle")).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    cleanup();

    render(<TermList workspaceId="ws" canReview={false} />);
    expect(screen.queryByTestId("markdown")).toBeNull();
  });

  it("states the review gate once for the list, not on every row", () => {
    render(<TermList workspaceId="ws" canReview />);
    const hints = screen.getAllByTestId("unconfirmed-hint");
    expect(hints).toHaveLength(1);
    expect(hints[0]).toHaveTextContent(
      "agentLayer:knowledge.unconfirmedHintAll",
    );
    for (const row of screen.getAllByTestId("term-row")) {
      expect(within(row).queryByTestId("unconfirmed-hint")).toBeNull();
    }
    cleanup();

    // Nothing proposed is left, so there is no gate left to explain.
    mocks.terms.mockReturnValue({
      isPending: false,
      isError: false,
      data: {
        terms: [term({ id: "c1", confidence: "confirmed" })],
      },
      refetch: vi.fn(),
    });
    render(<TermList workspaceId="ws" canReview />);
    expect(screen.queryByTestId("unconfirmed-hint")).toBeNull();
  });

  it("tells a model proposal apart from a person's", () => {
    render(<TermList workspaceId="ws" canReview={false} />);
    const [proposed, , disputed] = screen.getAllByTestId("term-row");

    expect(within(proposed).getByTestId("term-proposer")).toHaveAttribute(
      "data-proposer-kind",
      "human",
    );

    const agent = within(disputed).getByTestId("term-proposer");
    expect(agent).toHaveAttribute("data-proposer-kind", "agent");
    // The model id is shown verbatim, not mapped to a display name.
    expect(within(agent).getByTestId("agent-author")).toHaveTextContent(
      "claude-opus-5",
    );
  });

  it("offers delete on every row, and only with workspace:update", () => {
    render(<TermList workspaceId="ws" canReview={false} />);
    expect(screen.queryByTestId("delete-term")).not.toBeInTheDocument();
    cleanup();

    render(<TermList workspaceId="ws" canReview />);
    const rows = screen.getAllByTestId("term-row");
    // proposed, confirmed and disputed/retired alike.
    for (const row of rows) {
      expect(within(row).getByTestId("delete-term")).toBeInTheDocument();
    }
  });

  it("deletes a term through the dialog and shows the 409 reason verbatim", async () => {
    render(<TermList workspaceId="ws" canReview />);

    fireEvent.click(
      within(screen.getAllByTestId("term-row")[0]).getByTestId("delete-term"),
    );
    const dialog = await screen.findByTestId("delete-term-dialog");
    expect(dialog).toHaveTextContent(
      "agentLayer:knowledge.deleteTitle term=급여코드",
    );
    expect(mocks.remove).not.toHaveBeenCalled();

    fireEvent.click(within(dialog).getByTestId("delete-term-submit"));
    await waitFor(() =>
      expect(mocks.remove).toHaveBeenCalledWith({
        workspaceId: "ws",
        termId: "t1",
      }),
    );
    expect(mocks.toastSuccess).toHaveBeenCalledWith(
      "agentLayer:knowledge.deleted term=급여코드",
    );
    await waitFor(() =>
      expect(screen.queryByTestId("delete-term-dialog")).toBeNull(),
    );

    const reason =
      'Term is referenced as the replacement of "구코드" and cannot be deleted';
    mocks.remove.mockRejectedValueOnce(new AgentLayerApiError(409, reason));
    fireEvent.click(
      within(screen.getAllByTestId("term-row")[0]).getByTestId("delete-term"),
    );
    fireEvent.click(
      within(await screen.findByTestId("delete-term-dialog")).getByTestId(
        "delete-term-submit",
      ),
    );
    await waitFor(() =>
      expect(mocks.toastError).toHaveBeenCalledWith(
        "agentLayer:knowledge.deleteRefused",
        { description: reason },
      ),
    );
    // The dialog stays open on failure so the user sees what was refused.
    expect(screen.getByTestId("delete-term-dialog")).toBeInTheDocument();
  });

  it("shows the empty state when no term matches", () => {
    mocks.terms.mockReturnValue({
      isPending: false,
      isError: false,
      data: { terms: [] },
      refetch: vi.fn(),
    });
    render(<TermList workspaceId="ws" canReview={false} />);
    expect(
      screen.getByText("agentLayer:knowledge.termsEmpty"),
    ).toBeInTheDocument();
  });
});
