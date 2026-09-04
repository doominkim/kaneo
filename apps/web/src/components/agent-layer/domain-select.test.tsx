import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AgentDomainNode } from "@/fetchers/agent-layer/get-agent-domains";
import { DomainSelect } from "./domain-select";

vi.mock("react-i18next", () => ({
  initReactI18next: { type: "3rdParty", init: () => {} },
  useTranslation: () => ({ t: (key: string) => key }),
}));

function node(overrides: Partial<AgentDomainNode> & { id: string }) {
  return {
    workspaceId: "ws",
    parentId: null,
    slug: overrides.id,
    title: overrides.id,
    position: 0,
    proposedCount: 0,
    createdAt: "2026-09-03T00:00:00.000Z",
    updatedAt: "2026-09-03T00:00:00.000Z",
    ...overrides,
  } as AgentDomainNode;
}

const nodes = [
  node({ id: "d-pharmacy", title: "약국" }),
  node({ id: "d-lot", title: "로트", parentId: "d-pharmacy" }),
];

afterEach(() => cleanup());

describe("DomainSelect", () => {
  it("names the selected page by its path", () => {
    render(<DomainSelect nodes={nodes} value="d-lot" onChange={() => {}} />);
    expect(screen.getByTestId("domain-select")).toHaveTextContent(
      "약국 / 로트",
    );
  });

  it("says so when a set value names no page it can see", () => {
    // The listing has not loaded, or the value points outside this workspace.
    // Either way the trigger must not render blank, and must not claim the
    // item is unfiled.
    render(
      <DomainSelect nodes={undefined} value="d-lot" onChange={() => {}} />,
    );
    const trigger = screen.getByTestId("domain-select");
    expect(trigger).toHaveTextContent("agentLayer:domain.unknown");
    expect(trigger).not.toHaveTextContent("agentLayer:domain.none");
  });

  it("falls back to the none label when nothing is selected", () => {
    render(<DomainSelect nodes={nodes} value={null} onChange={() => {}} />);
    expect(screen.getByTestId("domain-select")).toHaveTextContent(
      "agentLayer:domain.none",
    );
  });
});
