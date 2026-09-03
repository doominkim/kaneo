import { describe, expect, it } from "vitest";
import {
  MAX_SLUG_PATH_DEPTH,
  parseSlugPath,
  resolveSlugPath,
} from "../../../apps/api/src/agent-domain/slug-path";

describe("parseSlugPath", () => {
  it("splits a root-to-child path and tolerates stray slashes", () => {
    expect(parseSlugPath("billing/refunds")).toEqual(["billing", "refunds"]);
    expect(parseSlugPath("/billing/refunds/")).toEqual(["billing", "refunds"]);
    expect(parseSlugPath(" billing / refunds ")).toEqual([
      "billing",
      "refunds",
    ]);
    expect(parseSlugPath("root")).toEqual(["root"]);
  });

  it("rejects an empty path, an invalid segment, or one deeper than the tree bound", () => {
    expect(parseSlugPath("")).toBeNull();
    expect(parseSlugPath("/")).toBeNull();
    expect(parseSlugPath("Billing/refunds")).toBeNull();
    expect(parseSlugPath("billing/re funds")).toBeNull();
    expect(parseSlugPath("약국/입고내역")).toBeNull();
    expect(parseSlugPath("-leading")).toBeNull();
    expect(parseSlugPath(`a/${"b".repeat(65)}`)).toBeNull();
    const deep = Array.from({ length: MAX_SLUG_PATH_DEPTH + 1 }, () => "x");
    expect(parseSlugPath(deep.join("/"))).toBeNull();
    expect(parseSlugPath(deep.slice(1).join("/"))).toHaveLength(
      MAX_SLUG_PATH_DEPTH,
    );
  });
});

describe("resolveSlugPath", () => {
  const domains = [
    { id: "a", parentId: null, slug: "billing" },
    { id: "b", parentId: "a", slug: "refunds" },
    { id: "c", parentId: "b", slug: "partial" },
    // Same slug at another level must not match a root-level lookup.
    { id: "d", parentId: "a", slug: "billing" },
    { id: "e", parentId: null, slug: "refunds" },
  ];

  it("walks root to child, matching each segment only at its level", () => {
    expect(resolveSlugPath(domains, ["billing"])?.id).toBe("a");
    expect(resolveSlugPath(domains, ["billing", "refunds"])?.id).toBe("b");
    expect(
      resolveSlugPath(domains, ["billing", "refunds", "partial"])?.id,
    ).toBe("c");
    expect(resolveSlugPath(domains, ["billing", "billing"])?.id).toBe("d");
    expect(resolveSlugPath(domains, ["refunds"])?.id).toBe("e");
  });

  it("returns null when any step has no match", () => {
    expect(resolveSlugPath(domains, ["refunds", "partial"])).toBeNull();
    expect(resolveSlugPath(domains, ["partial"])).toBeNull();
    expect(resolveSlugPath(domains, ["billing", "nope"])).toBeNull();
    expect(resolveSlugPath([], ["billing"])).toBeNull();
    expect(resolveSlugPath(domains, [])).toBeNull();
  });
});
