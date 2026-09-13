import { describe, expect, it } from "vitest";
import {
  featureOfKey,
  featuresOfBadge,
  filterTasksByFeature,
} from "./feature-filter";

const badge = (taskId: string, keys: string[], designs: string[]) => ({
  taskId,
  requirementKeys: keys,
  designFeatures: designs,
  stale: false,
});

describe("feature filter", () => {
  it("[REQ-FEATURE-HUB-11] groups a task's keys by feature and counts them", () => {
    expect(featureOfKey("REQ-SPEC-TABS-3")).toBe("spec-tabs");
    expect([
      ...featuresOfBadge(
        badge(
          "t",
          ["REQ-ADMIN-QA-1", "REQ-ADMIN-QA-2", "REQ-SPEC-TABS-9"],
          ["spec-tabs", "beta"],
        ),
      ),
    ]).toEqual([
      ["admin-qa", 2],
      ["spec-tabs", 1],
      ["beta", 0],
    ]);
  });

  it("[REQ-FEATURE-HUB-12] keeps only tasks linked to the chosen feature, and everything when none is chosen", () => {
    const badges = new Map([
      ["t1", badge("t1", ["REQ-ALPHA-1"], [])],
      ["t2", badge("t2", [], ["beta"])],
    ]);
    const tasks = [{ id: "t1" }, { id: "t2" }, { id: "t3" }];
    expect(
      filterTasksByFeature(tasks, badges, "alpha").map((t) => t.id),
    ).toEqual(["t1"]);
    expect(
      filterTasksByFeature(tasks, badges, "beta").map((t) => t.id),
    ).toEqual(["t2"]);
    expect(filterTasksByFeature(tasks, badges, null).map((t) => t.id)).toEqual([
      "t1",
      "t2",
      "t3",
    ]);
    expect(filterTasksByFeature(tasks, undefined, "alpha")).toEqual([]);
  });
});
