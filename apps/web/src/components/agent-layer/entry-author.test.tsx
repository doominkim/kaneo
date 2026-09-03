import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AgentEntrySummary } from "@/fetchers/agent-layer/get-agent-entries";
import type { LatestAgentEntry } from "@/hooks/queries/agent-layer/use-agent-latest-entry";
import { EntryRow } from "./entry-row";
import { HandoffCallout } from "./handoff-callout";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: { value?: number | string }) =>
      options?.value !== undefined ? `${key}:${options.value}` : key,
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

function summary(
  overrides: Partial<AgentEntrySummary> & { id: string },
): AgentEntrySummary {
  return {
    taskId: "t1",
    kind: "work",
    summary: "Did a thing",
    hasDecision: false,
    coreChanged: null,
    repo: null,
    branch: null,
    effort: null,
    agentLabel: null,
    usage: null,
    createdAt: "2026-09-03T00:00:00.000Z",
    deletedAt: null,
    actor: null,
    author: null,
    ...overrides,
  };
}

const agentActor = {
  id: "actor-1",
  provider: "anthropic",
  model: "claude-fable-5-1",
  onBehalfOf: "user-1",
};

afterEach(() => {
  cleanup();
});

describe("EntryRow authorship", () => {
  it("names a person with the human marker and never shows effort or usage", () => {
    render(
      <ul>
        <EntryRow
          entry={summary({
            id: "h1",
            author: { userId: "user-1", name: "Dominic" },
            // Defensive: even if a row carried them, a person has no cost line.
            effort: "high",
            usage: { totalTokens: 999 },
          })}
          onOpen={vi.fn()}
        />
      </ul>,
    );
    const row = screen.getByTestId("entry-row");
    expect(row.dataset.authorKind).toBe("human");
    const author = within(row).getByTestId("entry-author");
    expect(author.dataset.authorKind).toBe("human");
    expect(author).toHaveTextContent("Dominic");
    expect(author).toHaveTextContent("agentLayer:common.human");
    expect(within(row).queryByTestId("agent-author")).toBeNull();
    expect(row).not.toHaveTextContent("high");
    expect(row).not.toHaveTextContent("agentLayer:common.tokens");
  });

  it("shows the model badge, label, effort and tokens for an agent", () => {
    render(
      <ul>
        <EntryRow
          entry={summary({
            id: "a1",
            actor: agentActor,
            agentLabel: "3setter",
            effort: "high",
            usage: { totalTokens: 12300 },
          })}
          onOpen={vi.fn()}
        />
      </ul>,
    );
    const row = screen.getByTestId("entry-row");
    expect(row.dataset.authorKind).toBe("agent");
    expect(within(row).getByTestId("agent-author")).toHaveTextContent(
      "claude-fable-5-1",
    );
    expect(within(row).getByTestId("entry-author")).toHaveTextContent(
      "3setter · high",
    );
    expect(row).toHaveTextContent("agentLayer:common.tokens:12.3K");
    expect(row).not.toHaveTextContent("agentLayer:common.human");
  });

  it("says the author is unknown when both actor and author are null", () => {
    render(
      <ul>
        <EntryRow entry={summary({ id: "u1" })} onOpen={vi.fn()} />
      </ul>,
    );
    const author = screen.getByTestId("entry-author");
    expect(author.dataset.authorKind).toBe("unknown");
    expect(author).toHaveTextContent("agentLayer:common.unknownAuthor");
    expect(screen.queryByTestId("agent-author")).toBeNull();
  });
});

describe("HandoffCallout authorship", () => {
  function latest(
    overrides: Partial<NonNullable<LatestAgentEntry>["entry"]>,
  ): LatestAgentEntry {
    return {
      isFallback: false,
      entry: {
        id: "h1",
        workspaceId: "ws",
        projectId: "p",
        taskId: "t1",
        kind: "handoff",
        summary: "Handing over the composer",
        body: "Next: browser proof.",
        decision: null,
        refs: { branch: "feat/kan-12" },
        coreChanged: null,
        effort: null,
        agentLabel: null,
        usage: null,
        compaction: "none",
        sessionId: null,
        createdAt: "2026-09-03T00:00:00.000Z",
        deletedAt: null,
        deletedBy: null,
        actor: null,
        author: null,
        ...overrides,
      },
    };
  }

  it("footers a human handoff with the person's name", () => {
    render(
      <HandoffCallout
        latest={latest({ author: { userId: "user-1", name: "Dominic" } })}
      />,
    );
    const footer = screen.getByTestId("handoff-footer");
    expect(footer).toHaveTextContent("Dominic");
    expect(footer).toHaveTextContent("agentLayer:common.human");
    expect(footer).toHaveTextContent("2 hours ago");
    expect(within(footer).queryByTestId("agent-author")).toBeNull();
  });

  it("footers an agent handoff with the model badge and effort", () => {
    render(
      <HandoffCallout
        latest={latest({
          actor: agentActor,
          effort: "max",
          agentLabel: "1setter",
        })}
      />,
    );
    const footer = screen.getByTestId("handoff-footer");
    expect(within(footer).getByTestId("agent-author")).toHaveTextContent(
      "claude-fable-5-1",
    );
    expect(footer).toHaveTextContent("1setter · max");
  });
});
