import { describe, expect, it } from "vitest";
import type { AgentDomainNode } from "@/fetchers/agent-layer/get-agent-domains";
import {
  buildDomainTree,
  descendantIds,
  domainPathLabel,
  flattenDomainTree,
  randomSlugFallback,
  slugFromTitle,
} from "./domain-tree";

function node(
  id: string,
  parentId: string | null,
  title = id,
  position = 0,
  proposedCount = 0,
): AgentDomainNode {
  return {
    id,
    parentId,
    slug: id,
    title,
    position,
    updatedAt: "2026-09-03T00:00:00.000Z",
    childCount: 0,
    proposedCount,
    confirmedCount: 0,
    disputedCount: 0,
  };
}

const rows = [
  node("pharmacy", null, "약국"),
  node("pharmacist", "pharmacy", "약사"),
  node("inbound", "pharmacy", "입고내역"),
  node("lot", "inbound", "로트"),
  node("billing", null, "청구"),
];

describe("buildDomainTree", () => {
  it("nests children under parents with depth and keeps API order", () => {
    const roots = buildDomainTree(rows);
    expect(roots.map((r) => r.id)).toEqual(["pharmacy", "billing"]);
    expect(roots[0].children.map((c) => c.id)).toEqual([
      "pharmacist",
      "inbound",
    ]);
    expect(roots[0].children[1].children[0]).toMatchObject({
      id: "lot",
      depth: 2,
    });
  });

  it("lifts an orphan to the root instead of dropping it", () => {
    const roots = buildDomainTree([node("x", "missing")]);
    expect(roots.map((r) => r.id)).toEqual(["x"]);
  });

  it("rolls the pending count up the branch without touching the direct one", () => {
    const roots = buildDomainTree([
      node("pharmacy", null, "약국", 0, 3),
      node("pharmacist", "pharmacy", "약사", 0, 2),
      node("inbound", "pharmacy", "입고내역", 0, 1),
      node("lot", "inbound", "로트", 0, 4),
      node("billing", null, "청구", 0, 0),
    ]);
    const [pharmacy, billing] = roots;
    expect(pharmacy).toMatchObject({
      proposedCount: 3,
      subtreeProposedCount: 10,
    });
    // A grandchild reaches the root, and the middle node carries its own.
    expect(pharmacy.children[1]).toMatchObject({
      id: "inbound",
      proposedCount: 1,
      subtreeProposedCount: 5,
    });
    // A leaf's rollup is just itself.
    expect(pharmacy.children[1].children[0]).toMatchObject({
      id: "lot",
      subtreeProposedCount: 4,
    });
    expect(billing).toMatchObject({
      proposedCount: 0,
      subtreeProposedCount: 0,
    });
  });

  it("flattens depth-first", () => {
    expect(flattenDomainTree(buildDomainTree(rows)).map((n) => n.id)).toEqual([
      "pharmacy",
      "pharmacist",
      "inbound",
      "lot",
      "billing",
    ]);
  });
});

describe("descendantIds", () => {
  it("includes the page itself and every level below", () => {
    expect([...descendantIds(rows, "pharmacy")].sort()).toEqual(
      ["inbound", "lot", "pharmacist", "pharmacy"].sort(),
    );
    expect([...descendantIds(rows, "billing")]).toEqual(["billing"]);
  });
});

describe("slugFromTitle", () => {
  it("lowercases and hyphenates ASCII, trims the edges", () => {
    expect(slugFromTitle("  Inbound Records (2026) ")).toBe(
      "inbound-records-2026",
    );
  });

  it("yields an empty suggestion for a title with no ASCII", () => {
    expect(slugFromTitle("약국")).toBe("");
  });

  it("caps at 64 characters without a trailing hyphen", () => {
    const slug = slugFromTitle(`${"a".repeat(63)} b`);
    expect(slug).toBe("a".repeat(63));
  });
});

describe("randomSlugFallback", () => {
  it("is a valid slug with a six-character base36 suffix", () => {
    for (let i = 0; i < 20; i += 1) {
      expect(randomSlugFallback()).toMatch(/^domain-[a-z0-9]{6}$/);
    }
  });
});

describe("domainPathLabel", () => {
  it("joins the ancestor titles root first", () => {
    expect(domainPathLabel(rows, "lot")).toBe("약국 / 입고내역 / 로트");
  });
});
