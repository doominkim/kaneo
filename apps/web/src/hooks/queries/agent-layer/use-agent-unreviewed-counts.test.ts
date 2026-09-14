import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentFeatureSummary } from "@/fetchers/agent-layer/agent-features";
import type { AgentDomainList } from "@/fetchers/agent-layer/get-agent-domains";
import {
  countUnreviewedFeatureDocs,
  countUnreviewedTerms,
  useAgentUnreviewedCounts,
} from "./use-agent-unreviewed-counts";

const mocks = vi.hoisted(() => ({
  features: vi.fn(),
  decisions: vi.fn(),
  domains: vi.fn(),
}));

vi.mock("./use-agent-features", () => ({ useAgentFeatures: mocks.features }));
vi.mock("./use-agent-decisions", () => ({
  useAgentDecisionCounts: mocks.decisions,
}));
vi.mock("./use-agent-domains", () => ({ useAgentDomains: mocks.domains }));

const when = "2026-09-14T00:00:00.000Z";

function doc(reviewed: boolean, deletedAt: string | null = null) {
  return {
    status: "approved",
    approvedAt: when,
    reviewed,
    revisedAt: when,
    deletedAt,
    deletedBy: deletedAt ? "u1" : null,
    updatedAt: when,
  };
}

const features = [
  {
    feature: "a",
    title: "A",
    requirements: {
      ...doc(false),
      itemCount: 1,
      activeCount: 1,
      coveredCount: 0,
    },
    design: { ...doc(false), stale: false },
    tasks: { total: 0, done: 0, stale: 0 },
    updatedAt: when,
  },
  {
    feature: "b",
    title: "B",
    requirements: {
      ...doc(true),
      itemCount: 1,
      activeCount: 1,
      coveredCount: 1,
    },
    design: null,
    tasks: { total: 0, done: 0, stale: 0 },
    updatedAt: when,
  },
  {
    feature: "c",
    title: "C",
    requirements: null,
    design: { ...doc(false, when), stale: false },
    tasks: { total: 0, done: 0, stale: 0 },
    updatedAt: when,
  },
] as AgentFeatureSummary[];

function node(id: string, unreviewedCount: number) {
  return {
    id,
    parentId: null,
    slug: id,
    title: id,
    position: 0,
    updatedAt: when,
    childCount: 0,
    unreviewedCount,
    confirmedCount: 0,
    disputedCount: 0,
  };
}

const domains = {
  domains: [node("pharmacy", 2), node("billing", 0), node("lot", 1)],
  unfiled: { unreviewedCount: 3, confirmedCount: 4, disputedCount: 1 },
} as AgentDomainList;

beforeEach(() => {
  mocks.features.mockReset().mockReturnValue({ data: { features } });
  mocks.decisions.mockReset().mockReturnValue({
    data: { unreviewed: 4, accepted: 9 },
  });
  mocks.domains.mockReset().mockReturnValue({ data: domains });
});

describe("unreviewed counts", () => {
  it("[REQ-AGENT-AUTOAPPLY-10] counts live, unreviewed requirement documents and designs", () => {
    expect(countUnreviewedFeatureDocs(features)).toBe(2);
    expect(countUnreviewedFeatureDocs(undefined)).toBe(0);
  });

  it("[REQ-AGENT-AUTOAPPLY-10] sums every domain page and the unfiled bucket for knowledge items", () => {
    expect(countUnreviewedTerms(domains)).toBe(6);
    expect(countUnreviewedTerms(undefined)).toBe(0);
  });

  it("[REQ-AGENT-AUTOAPPLY-10] combines ADRs and knowledge items for the knowledge tab", () => {
    const { result } = renderHook(() => useAgentUnreviewedCounts("p1", "ws"));
    expect(mocks.features).toHaveBeenCalledWith("p1");
    expect(mocks.decisions).toHaveBeenCalledWith("p1");
    expect(mocks.domains).toHaveBeenCalledWith("ws");
    expect(result.current).toEqual({
      feature: 2,
      terms: 6,
      decisions: 4,
      knowledge: 10,
    });
  });
});
