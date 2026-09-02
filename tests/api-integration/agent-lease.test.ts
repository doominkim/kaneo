import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { agentLeaseTable } from "../../apps/api/src/database/schema-agent-layer";
import { createApp } from "../../apps/api/src/index";
import { mockAnonymousSession, mockAuthenticatedSession } from "./helpers/auth";
import { resetTestDatabase } from "./helpers/database";
import {
  createProjectFixture,
  createWorkspaceMember,
} from "./helpers/fixtures";

type Lease = {
  id: string;
  taskId: string;
  sessionId: string;
  acquiredAt: string;
  expiresAt: string;
  actor: {
    id: string;
    provider: string;
    model: string;
    onBehalfOf: string | null;
  } | null;
};

type AcquireResult = { acquired: boolean; lease: Lease | null };
type LeaseList = { leases: Lease[] };

async function seedTask(projectId: string, columnId: string, number: number) {
  const [task] = await db
    .insert(schema.taskTable)
    .values({
      projectId,
      title: `Seeded task ${number}`,
      description: "",
      priority: "medium",
      status: "to-do",
      columnId,
      number,
      position: number,
    })
    .returning();
  return task;
}

function acquire(
  app: ReturnType<typeof createApp>["app"],
  body: Record<string, unknown>,
) {
  return app.request("/api/agent-lease/acquire", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      provider: "anthropic",
      model: "claude-opus-5",
      ...body,
    }),
  });
}

function release(
  app: ReturnType<typeof createApp>["app"],
  body: Record<string, unknown>,
) {
  return app.request("/api/agent-lease/release", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("API integration: agent leases", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  it("rejects unauthenticated acquisition", async () => {
    mockAnonymousSession();
    const { app } = createApp();

    const response = await acquire(app, {
      taskId: "task-missing",
      sessionId: "session-1",
    });

    expect(response.status).toBe(401);
  });

  it("acquires a lease for a member and persists it with an expiry", async () => {
    const member = await createWorkspaceMember();
    const { project, columns } = await createProjectFixture({
      workspaceId: member.workspace.id,
    });
    const task = await seedTask(project.id, columns.todo.id, 1);

    mockAuthenticatedSession(member.user);
    const { app } = createApp();

    const response = await acquire(app, {
      taskId: task.id,
      sessionId: "session-1",
      ttlMinutes: 30,
    });

    expect(response.status).toBe(200);
    const payload = (await response.json()) as AcquireResult;

    expect(payload.acquired).toBe(true);
    expect(payload.lease).toMatchObject({
      taskId: task.id,
      sessionId: "session-1",
    });
    expect(payload.lease?.actor).toMatchObject({
      provider: "anthropic",
      model: "claude-opus-5",
      onBehalfOf: member.user.id,
    });

    const acquiredAt = new Date(payload.lease?.acquiredAt ?? 0).getTime();
    const expiresAt = new Date(payload.lease?.expiresAt ?? 0).getTime();
    expect(expiresAt - acquiredAt).toBe(30 * 60_000);
    expect(expiresAt).toBeGreaterThan(Date.now());

    const [persisted] = await db
      .select()
      .from(agentLeaseTable)
      .where(eq(agentLeaseTable.taskId, task.id));

    expect(persisted).toMatchObject({
      id: payload.lease?.id,
      workspaceId: member.workspace.id,
      taskId: task.id,
      sessionId: "session-1",
    });
  });

  it("refuses a second session and reports the current holder", async () => {
    const member = await createWorkspaceMember();
    const { project, columns } = await createProjectFixture({
      workspaceId: member.workspace.id,
    });
    const task = await seedTask(project.id, columns.todo.id, 1);

    const other = await createWorkspaceMember({ userName: "Second member" });
    await db.insert(schema.workspaceUserTable).values({
      workspaceId: member.workspace.id,
      userId: other.user.id,
      role: "member",
      joinedAt: new Date(),
    });

    mockAuthenticatedSession(member.user);
    const holderResponse = await acquire(createApp().app, {
      taskId: task.id,
      sessionId: "session-holder",
    });
    const holder = (await holderResponse.json()) as AcquireResult;
    expect(holder.acquired).toBe(true);

    mockAuthenticatedSession(other.user);
    const contenderResponse = await acquire(createApp().app, {
      taskId: task.id,
      sessionId: "session-contender",
      provider: "openai",
      model: "gpt-5.6",
    });

    // Refusal is a 200 with acquired=false, not a 409: the caller is told who
    // holds the task rather than getting a bare error.
    expect(contenderResponse.status).toBe(200);
    const contender = (await contenderResponse.json()) as AcquireResult;

    expect(contender.acquired).toBe(false);
    expect(contender.lease).toMatchObject({
      id: holder.lease?.id,
      taskId: task.id,
      sessionId: "session-holder",
    });
    expect(contender.lease?.actor).toMatchObject({
      model: "claude-opus-5",
      onBehalfOf: member.user.id,
    });

    const rows = await db
      .select()
      .from(agentLeaseTable)
      .where(eq(agentLeaseTable.taskId, task.id));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.sessionId).toBe("session-holder");
  });

  // Re-acquiring from the holding session is the heartbeat path: it must
  // extend the TTL rather than refuse, or a long-running agent silently loses
  // its claim at expiry. `acquiredAt` is kept, since the holder never changed.
  it("renews the lease when the holding session re-acquires", async () => {
    const member = await createWorkspaceMember();
    const { project, columns } = await createProjectFixture({
      workspaceId: member.workspace.id,
    });
    const task = await seedTask(project.id, columns.todo.id, 1);

    mockAuthenticatedSession(member.user);
    const { app } = createApp();

    const first = (await (
      await acquire(app, {
        taskId: task.id,
        sessionId: "session-1",
        ttlMinutes: 30,
      })
    ).json()) as AcquireResult;

    const second = (await (
      await acquire(app, {
        taskId: task.id,
        sessionId: "session-1",
        ttlMinutes: 60,
      })
    ).json()) as AcquireResult;

    expect(second.acquired).toBe(true);
    expect(second.lease?.id).toBe(first.lease?.id);
    expect(second.lease?.sessionId).toBe("session-1");
    expect(second.lease?.acquiredAt).toBe(first.lease?.acquiredAt);
    expect(new Date(second.lease?.expiresAt ?? 0).getTime()).toBeGreaterThan(
      new Date(first.lease?.expiresAt ?? 0).getTime(),
    );
  });

  it("takes over a lease whose expiry has passed", async () => {
    const member = await createWorkspaceMember();
    const { project, columns } = await createProjectFixture({
      workspaceId: member.workspace.id,
    });
    const task = await seedTask(project.id, columns.todo.id, 1);

    mockAuthenticatedSession(member.user);
    const { app } = createApp();

    await acquire(app, { taskId: task.id, sessionId: "session-dead" });
    await db
      .update(agentLeaseTable)
      .set({ expiresAt: new Date(Date.now() - 60_000) })
      .where(eq(agentLeaseTable.taskId, task.id));

    const response = await acquire(app, {
      taskId: task.id,
      sessionId: "session-fresh",
    });

    expect(response.status).toBe(200);
    const payload = (await response.json()) as AcquireResult;

    expect(payload.acquired).toBe(true);
    expect(payload.lease?.sessionId).toBe("session-fresh");

    const rows = await db
      .select()
      .from(agentLeaseTable)
      .where(eq(agentLeaseTable.taskId, task.id));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.sessionId).toBe("session-fresh");
  });

  it("releases only for the holding session", async () => {
    const member = await createWorkspaceMember();
    const { project, columns } = await createProjectFixture({
      workspaceId: member.workspace.id,
    });
    const task = await seedTask(project.id, columns.todo.id, 1);

    mockAuthenticatedSession(member.user);
    const { app } = createApp();

    await acquire(app, { taskId: task.id, sessionId: "session-holder" });

    const wrongSession = await release(app, {
      taskId: task.id,
      sessionId: "session-thief",
    });
    expect(wrongSession.status).toBe(200);
    expect(await wrongSession.json()).toEqual({ released: false });

    const stillHeld = await db
      .select()
      .from(agentLeaseTable)
      .where(eq(agentLeaseTable.taskId, task.id));
    expect(stillHeld).toHaveLength(1);

    const holderRelease = await release(app, {
      taskId: task.id,
      sessionId: "session-holder",
    });
    expect(holderRelease.status).toBe(200);
    expect(await holderRelease.json()).toEqual({ released: true });

    const gone = await db
      .select()
      .from(agentLeaseTable)
      .where(eq(agentLeaseTable.taskId, task.id));
    expect(gone).toHaveLength(0);

    const list = (await (
      await app.request(`/api/agent-lease/${project.id}`)
    ).json()) as LeaseList;
    expect(list.leases).toEqual([]);
  });

  it("lists only live leases for the project", async () => {
    const member = await createWorkspaceMember();
    const { project, columns } = await createProjectFixture({
      workspaceId: member.workspace.id,
    });
    const otherProject = await createProjectFixture({
      workspaceId: member.workspace.id,
      name: "Other project",
    });

    const liveTask = await seedTask(project.id, columns.todo.id, 1);
    const expiredTask = await seedTask(project.id, columns.todo.id, 2);
    const otherTask = await seedTask(
      otherProject.project.id,
      otherProject.columns.todo.id,
      1,
    );

    mockAuthenticatedSession(member.user);
    const { app } = createApp();

    await acquire(app, { taskId: liveTask.id, sessionId: "session-live" });
    await acquire(app, { taskId: expiredTask.id, sessionId: "session-old" });
    await acquire(app, { taskId: otherTask.id, sessionId: "session-other" });

    await db
      .update(agentLeaseTable)
      .set({ expiresAt: new Date(Date.now() - 60_000) })
      .where(eq(agentLeaseTable.taskId, expiredTask.id));

    const response = await app.request(`/api/agent-lease/${project.id}`);
    expect(response.status).toBe(200);

    const payload = (await response.json()) as LeaseList;
    expect(payload.leases).toHaveLength(1);
    expect(payload.leases[0]).toMatchObject({
      taskId: liveTask.id,
      sessionId: "session-live",
    });
    expect(payload.leases[0]?.actor).toMatchObject({
      provider: "anthropic",
      model: "claude-opus-5",
      onBehalfOf: member.user.id,
    });
  });

  it("rejects acquisition when the task does not exist", async () => {
    const member = await createWorkspaceMember();

    mockAuthenticatedSession(member.user);
    const { app } = createApp();

    const response = await acquire(app, {
      taskId: "task-does-not-exist",
      sessionId: "session-1",
    });

    expect(response.status).toBe(400);
    await expect(response.text()).resolves.toBe(
      "Workspace ID could not be determined",
    );
  });

  it("rejects a ttlMinutes above the cap", async () => {
    const member = await createWorkspaceMember();
    const { project, columns } = await createProjectFixture({
      workspaceId: member.workspace.id,
    });
    const task = await seedTask(project.id, columns.todo.id, 1);

    mockAuthenticatedSession(member.user);
    const { app } = createApp();

    const response = await acquire(app, {
      taskId: task.id,
      sessionId: "session-1",
      ttlMinutes: 481,
    });

    expect(response.status).toBe(400);
  });

  it("rejects an empty sessionId", async () => {
    const member = await createWorkspaceMember();
    const { project, columns } = await createProjectFixture({
      workspaceId: member.workspace.id,
    });
    const task = await seedTask(project.id, columns.todo.id, 1);

    mockAuthenticatedSession(member.user);
    const { app } = createApp();

    const response = await acquire(app, { taskId: task.id, sessionId: "" });
    expect(response.status).toBe(400);
  });

  it("blocks a viewer from acquiring a lease", async () => {
    const member = await createWorkspaceMember({ role: "viewer" });
    const { project, columns } = await createProjectFixture({
      workspaceId: member.workspace.id,
    });
    const task = await seedTask(project.id, columns.todo.id, 1);

    mockAuthenticatedSession(member.user);
    const { app } = createApp();

    const response = await acquire(app, {
      taskId: task.id,
      sessionId: "session-1",
    });

    expect(response.status).toBe(403);
    await expect(response.text()).resolves.toBe("Insufficient permissions");

    const rows = await db
      .select()
      .from(agentLeaseTable)
      .where(eq(agentLeaseTable.taskId, task.id));
    expect(rows).toHaveLength(0);
  });

  it("rejects lease access from users outside the workspace", async () => {
    const member = await createWorkspaceMember();
    const { project, columns } = await createProjectFixture({
      workspaceId: member.workspace.id,
    });
    const task = await seedTask(project.id, columns.todo.id, 1);

    const outsiderId = `user-${randomUUID()}`;
    const [outsider] = await db
      .insert(schema.userTable)
      .values({
        id: outsiderId,
        email: `${outsiderId}@example.com`,
        emailVerified: true,
        name: "Lease Outsider",
      })
      .returning();

    mockAuthenticatedSession(outsider);
    const { app } = createApp();

    const acquired = await acquire(app, {
      taskId: task.id,
      sessionId: "session-1",
    });
    expect(acquired.status).toBe(403);
    await expect(acquired.text()).resolves.toBe(
      "You don't have access to this workspace",
    );

    const listed = await app.request(`/api/agent-lease/${project.id}`);
    expect(listed.status).toBe(403);
    await expect(listed.text()).resolves.toBe(
      "You don't have access to this workspace",
    );
  });
});
