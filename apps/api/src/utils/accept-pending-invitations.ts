import { and, eq, gt } from "drizzle-orm";
import { syncWorkspaceSeats } from "../billing/controllers/sync-seats";
import db, { schema } from "../database";

/**
 * Accept every pending workspace invitation addressed to a user's email.
 *
 * Kaneo creates a `workspace_member` row in exactly one place: better-auth's
 * `POST /organization/accept-invitation`, which needs an authenticated session
 * plus an explicit invitation id — in practice a click in the web UI. An
 * employee who signs in through the company IdP and goes straight to MCP never
 * makes that click, so they end up with no workspace at all and every MCP call
 * fails on workspace access. `checkRegistrationAllowed` already *reads* the
 * matching invitation to let the signup through, but it discards it; this
 * closes that gap.
 *
 * Only call this for identities whose email the identity provider asserted
 * (the OAuth callback path). On the password-signup path the address is not
 * verified at user-create time, so joining a workspace on an email match would
 * let anyone type a colleague's address and walk in.
 *
 * Returns the workspace ids actually joined.
 */
export async function acceptPendingInvitationsForUser(user: {
  id: string;
  email: string;
}): Promise<string[]> {
  const email = user.email?.trim().toLowerCase();
  if (!email) return [];

  const pending = await db
    .select({
      id: schema.invitationTable.id,
      workspaceId: schema.invitationTable.workspaceId,
      role: schema.invitationTable.role,
    })
    .from(schema.invitationTable)
    .where(
      and(
        eq(schema.invitationTable.email, email),
        eq(schema.invitationTable.status, "pending"),
        gt(schema.invitationTable.expiresAt, new Date()),
      ),
    )
    .orderBy(schema.invitationTable.createdAt);

  const joinedWorkspaceIds: string[] = [];

  for (const invitation of pending) {
    let joined = false;
    try {
      joined = await db.transaction(async (tx) => {
        // Claim the invitation first, with `status = 'pending'` in the WHERE.
        // That UPDATE is the mutex: a concurrent accept (the web UI click, or a
        // second sign-in) matches zero rows and backs out instead of inserting a
        // second member row. `workspace_member` has no unique constraint on
        // (workspace_id, user_id), so there is nothing else to lean on.
        const claimed = await tx
          .update(schema.invitationTable)
          .set({ status: "accepted" })
          .where(
            and(
              eq(schema.invitationTable.id, invitation.id),
              eq(schema.invitationTable.status, "pending"),
            ),
          )
          .returning({ id: schema.invitationTable.id });
        if (claimed.length === 0) return false;

        const [existingMembership] = await tx
          .select({ id: schema.workspaceUserTable.id })
          .from(schema.workspaceUserTable)
          .where(
            and(
              eq(schema.workspaceUserTable.workspaceId, invitation.workspaceId),
              eq(schema.workspaceUserTable.userId, user.id),
            ),
          )
          .limit(1);
        if (existingMembership) return false;

        await tx.insert(schema.workspaceUserTable).values({
          workspaceId: invitation.workspaceId,
          userId: user.id,
          role: invitation.role ?? "member",
          joinedAt: new Date(),
        });
        return true;
      });
    } catch (error) {
      // One bad invitation must not stop the others, nor the seat sync for
      // workspaces already joined above.
      console.error(
        "Invitation auto-accept failed for invitation",
        invitation.id,
        error,
      );
      continue;
    }

    if (joined) joinedWorkspaceIds.push(invitation.workspaceId);
  }

  // Mirror organizationHooks.afterAddMember in auth.ts: better-auth's own
  // accept path syncs seats, and this path bypasses it.
  for (const workspaceId of joinedWorkspaceIds) {
    void syncWorkspaceSeats(workspaceId).catch((error) => {
      console.error(
        "Seat sync after invitation auto-accept failed:",
        workspaceId,
        error,
      );
    });
  }

  return joinedWorkspaceIds;
}
