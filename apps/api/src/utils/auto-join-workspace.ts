import { and, eq } from "drizzle-orm";
import { syncWorkspaceSeats } from "../billing/controllers/sync-seats";
import db, { schema } from "../database";

/**
 * better-auth's genericOAuth plugin mounts its callback at
 * `/oauth2/callback/:providerId`, and Kaneo registers exactly one generic
 * provider with `providerId: "custom"` (see `genericOAuth` in `auth.ts`).
 *
 * This is deliberately narrower than `isOAuthCallbackPath` in `auth.ts`, which
 * also matches the built-in social providers under `/callback/:providerId`.
 * Auto-join grants workspace membership without any invitation, so it must
 * only fire for the company IdP: only mcp.vanpharm.com decides who is allowed
 * into Kaneo at all. A GitHub or Google sign-in reaching the same code would
 * hand a workspace to anyone with an account on those providers.
 */
export const CUSTOM_OAUTH_CALLBACK_PATH = "/oauth2/callback/custom";

export const CUSTOM_OAUTH_CALLBACK_ROUTE = "/oauth2/callback/:providerId";
export const CUSTOM_OAUTH_PROVIDER_ID = "custom";

export function isCustomOAuthCallbackPath(path: unknown): boolean {
  if (typeof path !== "string") return false;
  // Tolerate a `?code=...&state=...` suffix rather than silently failing closed.
  const [withoutQuery] = path.split(/[?#]/);
  return withoutQuery === CUSTOM_OAUTH_CALLBACK_PATH;
}

/**
 * What `databaseHooks` actually receive. better-auth passes the endpoint's
 * *route template* as `ctx.path` (`/oauth2/callback/:providerId`, compare the
 * username plugin's `ctx.path === "/sign-up/email"`), with the provider in
 * `ctx.params.providerId`. Verified in production on 2026-09-10: matching the
 * resolved path alone never fired. Accept either shape.
 */
export function isCustomOAuthCallback(ctx: unknown): boolean {
  if (!ctx || typeof ctx !== "object") return false;
  const { path, params } = ctx as {
    path?: unknown;
    params?: unknown;
  };
  if (isCustomOAuthCallbackPath(path)) return true;
  if (typeof path !== "string") return false;
  const [withoutQuery] = path.split(/[?#]/);
  if (withoutQuery !== CUSTOM_OAUTH_CALLBACK_ROUTE) return false;
  const providerId =
    params && typeof params === "object"
      ? (params as { providerId?: unknown }).providerId
      : undefined;
  return providerId === CUSTOM_OAUTH_PROVIDER_ID;
}

export const DEFAULT_AUTO_JOIN_ROLE = "member";

export type AutoJoinWorkspaceConfig = {
  workspaceId: string;
  role: string;
};

/**
 * Reads the auto-join target from the environment. Returns `null` when
 * `CUSTOM_OAUTH_AUTO_JOIN_WORKSPACE_ID` is unset or blank, which is the
 * upstream default: no env, no auto-join.
 */
export function getAutoJoinWorkspaceConfig(): AutoJoinWorkspaceConfig | null {
  const workspaceId = process.env.CUSTOM_OAUTH_AUTO_JOIN_WORKSPACE_ID?.trim();
  if (!workspaceId) return null;

  const configuredRole = process.env.CUSTOM_OAUTH_AUTO_JOIN_ROLE?.trim();
  if (!configuredRole) {
    return { workspaceId, role: DEFAULT_AUTO_JOIN_ROLE };
  }

  // Roles are per-workspace slugs in `workspace_role` (plus the static
  // `owner`), so there is no closed list to validate against here. Reject
  // shapes that cannot be a slug at all rather than writing a membership no
  // permission check will ever match.
  if (!/^[a-z0-9_-]{1,64}$/i.test(configuredRole)) {
    console.warn(
      "Ignoring CUSTOM_OAUTH_AUTO_JOIN_ROLE: not a valid role slug, falling back to",
      DEFAULT_AUTO_JOIN_ROLE,
    );
    return { workspaceId, role: DEFAULT_AUTO_JOIN_ROLE };
  }

  return { workspaceId, role: configuredRole };
}

/**
 * Put a first-time SSO user into the workspace named by
 * `CUSTOM_OAUTH_AUTO_JOIN_WORKSPACE_ID`.
 *
 * The company Kaneo has no self-signup: `CUSTOM_OAUTH_*` delegates login to
 * mcp.vanpharm.com, which only issues a token to people holding the `kaneo`
 * permission. Authorization is therefore already settled before better-auth
 * ever creates the user row, and requiring a separate Kaneo invitation on top
 * of that just leaves every new employee with zero workspaces (and every MCP
 * call failing on workspace access).
 *
 * Call this only from the generic OAuth callback path
 * (`isCustomOAuthCallbackPath`) and only for an IdP-asserted email, and only
 * *after* `acceptPendingInvitationsForUser` — an invitation carries an
 * explicitly chosen role, and this must not overwrite or duplicate it.
 *
 * Never throws: the user row is already committed by the time the
 * `user.create.after` hook runs, so failing here would abort a sign-in over a
 * membership an admin can still grant by hand.
 *
 * Returns the workspace id joined, or `null` when nothing was inserted.
 */
export async function autoJoinConfiguredWorkspace(user: {
  id: string;
}): Promise<string | null> {
  const config = getAutoJoinWorkspaceConfig();
  if (!config) return null;

  try {
    const [existingMembership] = await db
      .select({ id: schema.workspaceUserTable.id })
      .from(schema.workspaceUserTable)
      .where(
        and(
          eq(schema.workspaceUserTable.workspaceId, config.workspaceId),
          eq(schema.workspaceUserTable.userId, user.id),
        ),
      )
      .limit(1);

    // Already a member — normally because a pending invitation to this same
    // workspace was just accepted, which is the authoritative role.
    // `workspace_member` has no unique constraint on (workspace_id, user_id),
    // so this check is the only thing preventing a duplicate row.
    if (existingMembership) return null;

    await db.insert(schema.workspaceUserTable).values({
      workspaceId: config.workspaceId,
      userId: user.id,
      role: config.role,
      joinedAt: new Date(),
    });
  } catch (error) {
    // Most likely cause: the configured workspace id does not exist, which the
    // `workspace_member.workspace_id` foreign key rejects. That is an operator
    // misconfiguration, not something the signing-in user can fix.
    console.error(
      "Auto-join into workspace failed for user",
      user.id,
      config.workspaceId,
      error,
    );
    return null;
  }

  // Mirror organizationHooks.afterAddMember in auth.ts: every other path that
  // creates a member row syncs billing seats, and this one bypasses it.
  void syncWorkspaceSeats(config.workspaceId).catch((error) => {
    console.error(
      "Seat sync after workspace auto-join failed:",
      config.workspaceId,
      error,
    );
  });

  return config.workspaceId;
}
