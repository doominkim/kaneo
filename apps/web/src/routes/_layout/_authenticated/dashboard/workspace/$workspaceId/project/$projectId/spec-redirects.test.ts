import { describe, expect, it } from "vitest";
import { Route as DesignFeature } from "./design.$feature";
import { Route as DesignIndex } from "./design.index";
import { Route as RequirementsFeature } from "./requirements.$feature";
import { Route as RequirementsIndex } from "./requirements.index";

type Redirect = { options: { to: string; params?: unknown; search?: unknown } };

function redirectOf(
  fn: unknown,
  ctx: Record<string, unknown>,
): Redirect["options"] {
  try {
    (fn as (c: Record<string, unknown>) => void)(ctx);
  } catch (thrown) {
    return (thrown as Redirect).options;
  }
  throw new Error("expected a redirect");
}

describe("[REQ-FEATURE-HUB-16] old requirement and design links", () => {
  const params = { workspaceId: "ws", projectId: "p1", feature: "spec-tabs" };

  it("send the old list tabs to the Feature tab", () => {
    expect(
      redirectOf(RequirementsIndex.options.beforeLoad, { params }).to,
    ).toBe("/dashboard/workspace/$workspaceId/project/$projectId/feature");
    expect(redirectOf(DesignIndex.options.beforeLoad, { params }).to).toBe(
      "/dashboard/workspace/$workspaceId/project/$projectId/feature",
    );
  });

  it("send an old detail link to the same feature's sub tab, keeping edit", () => {
    const req = redirectOf(RequirementsFeature.options.beforeLoad, {
      params,
      search: { edit: true },
    });
    expect(req.to).toBe(
      "/dashboard/workspace/$workspaceId/project/$projectId/feature/$feature",
    );
    expect(req.params).toEqual(params);
    expect(req.search).toEqual({ tab: "requirements", edit: true });
    const design = redirectOf(DesignFeature.options.beforeLoad, {
      params,
      search: {},
    });
    expect(design.search).toEqual({ tab: "design", edit: undefined });
  });
});
