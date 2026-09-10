import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { acceptPendingInvitationsForUser } from "../../apps/api/src/utils/accept-pending-invitations";
import { resetTestDatabase } from "./helpers/database";
import { createWorkspaceMember } from "./helpers/fixtures";

async function seedInvitedUser(email: string) {
  const [user] = await db
    .insert(schema.userTable)
    .values({
      id: `user-${randomUUID()}`,
      email,
      emailVerified: true,
      name: "SSO Employee",
    })
    .returning();
  return user;
}

async function seedInvitation(
  email: string,
  overrides?: Partial<{ status: string; expiresAt: Date; role: string | null }>,
) {
  const inviter = await createWorkspaceMember({ role: "owner" });

  const [invitation] = await db
    .insert(schema.invitationTable)
    .values({
      workspaceId: inviter.workspace.id,
      inviterId: inviter.user.id,
      email: email.toLowerCase(),
      role: overrides?.role === undefined ? "member" : overrides.role,
      status: overrides?.status ?? "pending",
      expiresAt: overrides?.expiresAt ?? new Date(Date.now() + 86_400_000),
    })
    .returning();

  return { invitation, workspace: inviter.workspace };
}

function membershipsOf(userId: string) {
  return db
    .select()
    .from(schema.workspaceUserTable)
    .where(eq(schema.workspaceUserTable.userId, userId));
}

async function invitationStatus(invitationId: string) {
  const [row] = await db
    .select({ status: schema.invitationTable.status })
    .from(schema.invitationTable)
    .where(eq(schema.invitationTable.id, invitationId));
  return row?.status;
}

describe("API integration: pending invitation auto-accept on signup", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  it("joins the invited workspace and marks the invitation accepted", async () => {
    const email = `sso-${randomUUID()}@example.com`;
    const { invitation, workspace } = await seedInvitation(email);
    const user = await seedInvitedUser(email);

    const joined = await acceptPendingInvitationsForUser({
      id: user.id,
      email: user.email,
    });

    expect(joined).toEqual([workspace.id]);
    const memberships = await membershipsOf(user.id);
    expect(memberships).toHaveLength(1);
    expect(memberships[0].workspaceId).toBe(workspace.id);
    expect(await invitationStatus(invitation.id)).toBe("accepted");
  });

  it("keeps the role the invitation was issued with", async () => {
    const email = `sso-${randomUUID()}@example.com`;
    await seedInvitation(email, { role: "admin" });
    const user = await seedInvitedUser(email);

    await acceptPendingInvitationsForUser({ id: user.id, email: user.email });

    const [membership] = await membershipsOf(user.id);
    expect(membership.role).toBe("admin");
  });

  it("falls back to member when the invitation carries no role", async () => {
    const email = `sso-${randomUUID()}@example.com`;
    await seedInvitation(email, { role: null });
    const user = await seedInvitedUser(email);

    await acceptPendingInvitationsForUser({ id: user.id, email: user.email });

    const [membership] = await membershipsOf(user.id);
    expect(membership.role).toBe("member");
  });

  it("matches the invitation regardless of the identity provider's casing", async () => {
    const email = `sso-${randomUUID()}@example.com`;
    const { workspace } = await seedInvitation(email);
    const user = await seedInvitedUser(email);

    const joined = await acceptPendingInvitationsForUser({
      id: user.id,
      email: email.toUpperCase(),
    });

    expect(joined).toEqual([workspace.id]);
  });

  it("accepts every pending invitation the user has", async () => {
    const email = `sso-${randomUUID()}@example.com`;
    const first = await seedInvitation(email);
    const second = await seedInvitation(email);
    const user = await seedInvitedUser(email);

    const joined = await acceptPendingInvitationsForUser({
      id: user.id,
      email: user.email,
    });

    expect(joined).toHaveLength(2);
    expect(new Set(joined)).toEqual(
      new Set([first.workspace.id, second.workspace.id]),
    );
    expect(await membershipsOf(user.id)).toHaveLength(2);
  });

  it("ignores expired and already-resolved invitations", async () => {
    const email = `sso-${randomUUID()}@example.com`;
    const expired = await seedInvitation(email, {
      expiresAt: new Date(Date.now() - 60_000),
    });
    const cancelled = await seedInvitation(email, { status: "canceled" });
    const user = await seedInvitedUser(email);

    const joined = await acceptPendingInvitationsForUser({
      id: user.id,
      email: user.email,
    });

    expect(joined).toEqual([]);
    expect(await membershipsOf(user.id)).toHaveLength(0);
    expect(await invitationStatus(expired.invitation.id)).toBe("pending");
    expect(await invitationStatus(cancelled.invitation.id)).toBe("canceled");
  });

  it("leaves invitations addressed to someone else alone", async () => {
    const other = await seedInvitation(`someone-${randomUUID()}@example.com`);
    const user = await seedInvitedUser(`sso-${randomUUID()}@example.com`);

    const joined = await acceptPendingInvitationsForUser({
      id: user.id,
      email: user.email,
    });

    expect(joined).toEqual([]);
    expect(await membershipsOf(user.id)).toHaveLength(0);
    expect(await invitationStatus(other.invitation.id)).toBe("pending");
  });

  it("does not add a second member row when the user is already a member", async () => {
    const email = `sso-${randomUUID()}@example.com`;
    const { invitation, workspace } = await seedInvitation(email);
    const user = await seedInvitedUser(email);
    await db.insert(schema.workspaceUserTable).values({
      workspaceId: workspace.id,
      userId: user.id,
      role: "member",
      joinedAt: new Date(),
    });

    const joined = await acceptPendingInvitationsForUser({
      id: user.id,
      email: user.email,
    });

    expect(joined).toEqual([]);
    const memberships = await db
      .select()
      .from(schema.workspaceUserTable)
      .where(
        and(
          eq(schema.workspaceUserTable.userId, user.id),
          eq(schema.workspaceUserTable.workspaceId, workspace.id),
        ),
      );
    expect(memberships).toHaveLength(1);
    // The invitation is still consumed, so it stops showing up as pending.
    expect(await invitationStatus(invitation.id)).toBe("accepted");
  });

  it("is idempotent across repeated sign-ins", async () => {
    const email = `sso-${randomUUID()}@example.com`;
    await seedInvitation(email);
    const user = await seedInvitedUser(email);

    await acceptPendingInvitationsForUser({ id: user.id, email: user.email });
    const secondRun = await acceptPendingInvitationsForUser({
      id: user.id,
      email: user.email,
    });

    expect(secondRun).toEqual([]);
    expect(await membershipsOf(user.id)).toHaveLength(1);
  });
});
