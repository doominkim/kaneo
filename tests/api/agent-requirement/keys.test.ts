import { HTTPException } from "hono/http-exception";
import { describe, expect, it } from "vitest";
import {
  buildKey,
  FEATURE_PATTERN,
  parseKey,
} from "../../../apps/api/src/agent-requirement/keys";

describe("requirement keys", () => {
  it("[REQ-SPEC-TABS-16] builds REQ-<FEATURE>-<n> from the feature slug", () => {
    expect(buildKey("spec-tabs", 3)).toBe("REQ-SPEC-TABS-3");
    expect(buildKey("admin-qa", 69)).toBe("REQ-ADMIN-QA-69");
  });

  it("[REQ-SPEC-TABS-16] parses a key back to its seq inside its own feature", () => {
    expect(parseKey("REQ-SPEC-TABS-12", "spec-tabs")).toEqual({ seq: 12 });
  });

  it("[REQ-SPEC-TABS-16] rejects a key filed under another feature", () => {
    expect(() => parseKey("REQ-ADMIN-QA-3", "spec-tabs")).toThrow(
      HTTPException,
    );
    expect(() => parseKey("REQ-ADMIN-QA-3", "spec-tabs")).toThrow(
      /does not belong/,
    );
  });

  it("[REQ-SPEC-TABS-16] rejects malformed keys and seq below 1", () => {
    expect(() => parseKey("SPEC-TABS-1", "spec-tabs")).toThrow(/must match/);
    expect(() => parseKey("REQ-spec-tabs-1", "spec-tabs")).toThrow(
      /must match/,
    );
    expect(() => parseKey("REQ-SPEC-TABS-0", "spec-tabs")).toThrow(/≥ 1/);
  });

  it("[REQ-SPEC-TABS-16] feature slugs are lower-case kebab like document slugs", () => {
    expect(FEATURE_PATTERN.test("spec-tabs")).toBe(true);
    expect(FEATURE_PATTERN.test("Spec Tabs")).toBe(false);
    expect(FEATURE_PATTERN.test("-lead")).toBe(false);
  });
});
