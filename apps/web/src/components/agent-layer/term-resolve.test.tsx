import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentTerm } from "@/fetchers/agent-layer/get-agent-terms";
import { TermResolve } from "./term-resolve";

const mocks = vi.hoisted(() => ({ resolve: vi.fn() }));

vi.mock("react-i18next", () => ({
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
vi.mock("@/components/public-project/markdown-renderer", () => ({
  MarkdownRenderer: ({ content }: { content: string }) => (
    <div data-testid="markdown">{content}</div>
  ),
}));
vi.mock("@/hooks/queries/agent-layer/use-agent-term-resolve", () => ({
  useAgentTermResolve: mocks.resolve,
}));

const base: AgentTerm = {
  id: "t1",
  canonical: "급여코드",
  definition: null,
  aliases: ["보험코드"],
  notToConfuseWith: [],
  anchors: [],
  confidence: "confirmed",
  state: "active",
  supersededBy: null,
  domainId: null,
  actorId: null,
  actor: null,
  lastVerifiedAt: null,
  createdAt: "2026-09-03T00:00:00.000Z",
};

function answer(
  match: "canonical" | "alias" | "none",
  term: AgentTerm | null,
  ambiguous: AgentTerm[] = [],
) {
  return {
    isPending: false,
    isError: false,
    data: { match, term, ambiguous },
    refetch: vi.fn(),
  };
}

function submit(value: string) {
  fireEvent.change(screen.getByTestId("resolve-input"), { target: { value } });
  fireEvent.click(screen.getByTestId("resolve-submit"));
}

beforeEach(() => {
  mocks.resolve.mockReset().mockReturnValue(answer("none", null));
});

afterEach(() => cleanup());

describe("TermResolve", () => {
  it("only resolves on submit and passes the trimmed word", () => {
    render(<TermResolve workspaceId="ws" />);
    expect(mocks.resolve).toHaveBeenLastCalledWith("ws", "");
    expect(screen.queryByTestId("resolve-result")).not.toBeInTheDocument();
    expect(screen.getByTestId("resolve-submit")).toBeDisabled();

    submit("  보험코드 ");
    expect(mocks.resolve).toHaveBeenLastCalledWith("ws", "보험코드");
  });

  it("shows an alias match with the resolved term", () => {
    mocks.resolve.mockReturnValue(answer("alias", base));
    render(<TermResolve workspaceId="ws" />);
    submit("보험코드");

    const result = screen.getByTestId("resolve-result");
    expect(result.dataset.match).toBe("alias");
    expect(screen.getByTestId("resolve-match")).toHaveTextContent(
      "agentLayer:knowledge.resolveMatch.alias",
    );
    expect(screen.getByTestId("term-row")).toHaveTextContent("급여코드");
    // The resolver never offers review actions.
    expect(screen.queryByTestId("confirm-term")).not.toBeInTheDocument();
  });

  it("lists every candidate when the word is ambiguous", () => {
    mocks.resolve.mockReturnValue(
      answer("alias", null, [
        base,
        { ...base, id: "t2", canonical: "청구코드" },
      ]),
    );
    render(<TermResolve workspaceId="ws" />);
    submit("코드");

    expect(screen.getByTestId("resolve-match")).toHaveTextContent(
      "agentLayer:knowledge.resolveAmbiguous count=2",
    );
    expect(screen.getAllByTestId("term-row")).toHaveLength(2);
  });

  it("explains a miss", () => {
    render(<TermResolve workspaceId="ws" />);
    submit("없는말");
    expect(screen.getByTestId("resolve-result").dataset.match).toBe("none");
    expect(
      screen.getByText("agentLayer:knowledge.resolveNoneHint"),
    ).toBeInTheDocument();
  });
});
