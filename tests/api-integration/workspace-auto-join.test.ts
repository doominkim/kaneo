import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { autoJoinConfiguredWorkspace } from "../../apps/api/src/utils/auto-join-workspace";
import { resetTestDatabase } from "./helpers/database";

const envKeys = [
  "CUSTOM_OAUTH_AUTO_JOIN_WORKSPACE_ID",
  "CUSTOM_OAUTH_AUTO_JOIN_ROLE",
] as const;

async function seedWorkspace() {
  const [workspace] = await db
    .insert(schema.workspaceTable)
    .values({
      id: `workspace-${randomUUID()}`,
      name: "Auto Join Workspace",
      slug: `workspace-${randomUUID()}`,
      createdAt: new Date(),
    })
    .returning();
  return workspace;
}

async function seedSsoUser() {
  const userId = `user-${randomUUID()}`;
  const [user] = await db
    .insert(schema.userTable)
    .values({
      id: userId,
      email: `${userId}@example.com`,
      emailVerified: true,
      name: "SSO Employee",
    })
    .returning();
  return user;
}

function membershipsOf(userId: string) {
  return db
    .select()
    .from(schema.workspaceUserTable)
    .where(eq(schema.workspaceUserTable.userId, userId));
}

describe("API integration: custom OAuth workspace auto-join", () => {
  const original: Partial<
    Record<(typeof envKeys)[number], string | undefined>
  > = {};

  beforeEach(async () => {
    for (const key of envKeys) {
      original[key] = process.env[key];
      delete process.env[key];
    }
    await resetTestDatabase();
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
  });

  it("joins the configured workspace as member", async () => {
    const workspace = await seedWorkspace();
    const user = await seedSsoUser();
    process.env.CUSTOM_OAUTH_AUTO_JOIN_WORKSPACE_ID = workspace.id;

    const joined = await autoJoinConfiguredWorkspace({ id: user.id });

    expect(joined).toBe(workspace.id);
    const memberships = await membershipsOf(user.id);
    expect(memberships).toHaveLength(1);
    expect(memberships[0].workspaceId).toBe(workspace.id);
    expect(memberships[0].role).toBe("member");
  });

  it("uses the role from CUSTOM_OAUTH_AUTO_JOIN_ROLE", async () => {
    const workspace = await seedWorkspace();
    const user = await seedSsoUser();
    process.env.CUSTOM_OAUTH_AUTO_JOIN_WORKSPACE_ID = workspace.id;
    process.env.CUSTOM_OAUTH_AUTO_JOIN_ROLE = "admin";

    await autoJoinConfiguredWorkspace({ id: user.id });

    const [membership] = await membershipsOf(user.id);
    expect(membership.role).toBe("admin");
  });

  it("does not add a second member row when the user is already a member", async () => {
    const workspace = await seedWorkspace();
    const user = await seedSsoUser();
    // Stands in for the invitation auto-accept that runs just before this in
    // the user.create hook: its role is the explicit one and must survive.
    await db.insert(schema.workspaceUserTable).values({
      workspaceId: workspace.id,
      userId: user.id,
      role: "owner",
      joinedAt: new Date(),
    });
    process.env.CUSTOM_OAUTH_AUTO_JOIN_WORKSPACE_ID = workspace.id;
    process.env.CUSTOM_OAUTH_AUTO_JOIN_ROLE = "member";

    const joined = await autoJoinConfiguredWorkspace({ id: user.id });

    expect(joined).toBeNull();
    const memberships = await membershipsOf(user.id);
    expect(memberships).toHaveLength(1);
    expect(memberships[0].role).toBe("owner");
  });

  it("is idempotent across repeated calls", async () => {
    const workspace = await seedWorkspace();
    const user = await seedSsoUser();
    process.env.CUSTOM_OAUTH_AUTO_JOIN_WORKSPACE_ID = workspace.id;

    await autoJoinConfiguredWorkspace({ id: user.id });
    const second = await autoJoinConfiguredWorkspace({ id: user.id });

    expect(second).toBeNull();
    expect(await membershipsOf(user.id)).toHaveLength(1);
  });

  it("is a no-op when no workspace is configured", async () => {
    await seedWorkspace();
    const user = await seedSsoUser();

    const joined = await autoJoinConfiguredWorkspace({ id: user.id });

    expect(joined).toBeNull();
    expect(await membershipsOf(user.id)).toHaveLength(0);
  });

  it("logs and gives up when the configured workspace does not exist", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const user = await seedSsoUser();
    process.env.CUSTOM_OAUTH_AUTO_JOIN_WORKSPACE_ID = `workspace-${randomUUID()}`;

    const joined = await autoJoinConfiguredWorkspace({ id: user.id });

    expect(joined).toBeNull();
    expect(await membershipsOf(user.id)).toHaveLength(0);
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });
});
