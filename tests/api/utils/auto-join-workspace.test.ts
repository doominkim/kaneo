import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CUSTOM_OAUTH_CALLBACK_PATH,
  DEFAULT_AUTO_JOIN_ROLE,
  getAutoJoinWorkspaceConfig,
  isCustomOAuthCallbackPath,
} from "../../../apps/api/src/utils/auto-join-workspace";

const envKeys = [
  "CUSTOM_OAUTH_AUTO_JOIN_WORKSPACE_ID",
  "CUSTOM_OAUTH_AUTO_JOIN_ROLE",
] as const;

describe("isCustomOAuthCallbackPath", () => {
  it("matches the generic OAuth callback for the `custom` provider", () => {
    expect(isCustomOAuthCallbackPath(CUSTOM_OAUTH_CALLBACK_PATH)).toBe(true);
    expect(isCustomOAuthCallbackPath("/oauth2/callback/custom")).toBe(true);
  });

  it("still matches when the callback carries its query string", () => {
    expect(
      isCustomOAuthCallbackPath("/oauth2/callback/custom?code=abc&state=xyz"),
    ).toBe(true);
    expect(isCustomOAuthCallbackPath("/oauth2/callback/custom#fragment")).toBe(
      true,
    );
  });

  it.each([
    // Built-in social providers: auto-join must not grant them a workspace.
    "/callback/google",
    "/callback/github",
    "/callback/custom",
    // Another generic provider, should one ever be registered.
    "/oauth2/callback/okta",
    // Prefix and suffix lookalikes.
    "/oauth2/callback/custom-idp",
    "/oauth2/callback/custom/extra",
    "/api/auth/oauth2/callback/custom",
    "/sign-in/email",
    "",
  ])("does not match %s", (path) => {
    expect(isCustomOAuthCallbackPath(path)).toBe(false);
  });

  it.each([undefined, null, 42, {}, ["/oauth2/callback/custom"]])(
    "does not match the non-string %s",
    (path) => {
      expect(isCustomOAuthCallbackPath(path)).toBe(false);
    },
  );
});

describe("getAutoJoinWorkspaceConfig", () => {
  const original: Partial<
    Record<(typeof envKeys)[number], string | undefined>
  > = {};

  beforeEach(() => {
    for (const key of envKeys) {
      original[key] = process.env[key];
      delete process.env[key];
    }
  });

  afterEach(() => {
    for (const key of envKeys) {
      const value = original[key];
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
    vi.restoreAllMocks();
  });

  it("returns null when no workspace is configured", () => {
    expect(getAutoJoinWorkspaceConfig()).toBeNull();
  });

  it("returns null when the workspace id is blank", () => {
    process.env.CUSTOM_OAUTH_AUTO_JOIN_WORKSPACE_ID = "   ";
    expect(getAutoJoinWorkspaceConfig()).toBeNull();
  });

  it("defaults the role to member", () => {
    process.env.CUSTOM_OAUTH_AUTO_JOIN_WORKSPACE_ID = " workspace-1 ";
    expect(getAutoJoinWorkspaceConfig()).toEqual({
      workspaceId: "workspace-1",
      role: DEFAULT_AUTO_JOIN_ROLE,
    });
  });

  it("uses the configured role", () => {
    process.env.CUSTOM_OAUTH_AUTO_JOIN_WORKSPACE_ID = "workspace-1";
    process.env.CUSTOM_OAUTH_AUTO_JOIN_ROLE = " admin ";
    expect(getAutoJoinWorkspaceConfig()).toEqual({
      workspaceId: "workspace-1",
      role: "admin",
    });
  });

  it("falls back to member when the role is not a usable slug", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    process.env.CUSTOM_OAUTH_AUTO_JOIN_WORKSPACE_ID = "workspace-1";
    process.env.CUSTOM_OAUTH_AUTO_JOIN_ROLE = "not a role";

    expect(getAutoJoinWorkspaceConfig()).toEqual({
      workspaceId: "workspace-1",
      role: DEFAULT_AUTO_JOIN_ROLE,
    });
    expect(warn).toHaveBeenCalled();
  });
});
