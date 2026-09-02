import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const storage = vi.hoisted(() => ({
  createArtifactUploadUrl: vi.fn(),
  headArtifactObject: vi.fn(),
  createArtifactDownloadUrl: vi.fn(),
  deleteArtifactObject: vi.fn(),
}));

vi.mock("../../apps/api/src/agent-artifact/storage", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("../../apps/api/src/agent-artifact/storage")
    >();
  return { ...actual, ...storage };
});

import { ArtifactObjectMissingError } from "../../apps/api/src/agent-artifact/storage";
import db, { schema } from "../../apps/api/src/database";
import { agentArtifactTable } from "../../apps/api/src/database/schema-agent-layer";
import { createApp } from "../../apps/api/src/index";
import { mockAnonymousSession, mockAuthenticatedSession } from "./helpers/auth";
import { resetTestDatabase } from "./helpers/database";
import {
  createProjectFixture,
  createWorkspaceMember,
} from "./helpers/fixtures";

type Artifact = {
  id: string;
  projectId: string;
  taskId: string | null;
  name: string;
  contentType: string;
  size: number;
  uploadedBy: string | null;
  actorId: string | null;
  createdAt: string;
};

type Presign = {
  artifactId: string;
  uploadUrl: string;
  storageKey: string;
  expiresAt: string;
  headers: Record<string, string>;
};

const json = (body: unknown) => ({
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

async function seedTask(projectId: string, columnId: string, title = "task") {
  const [task] = await db
    .insert(schema.taskTable)
    .values({
      projectId,
      title,
      description: "",
      priority: "medium",
      status: "to-do",
      columnId,
      number: 1,
      position: 1,
    })
    .returning();
  return task;
}

async function addUser(workspaceId: string, role: string) {
  const id = `user-${randomUUID()}`;
  const [user] = await db
    .insert(schema.userTable)
    .values({
      id,
      email: `${id}@example.com`,
      emailVerified: true,
      name: role,
    })
    .returning();
  await db.insert(schema.workspaceUserTable).values({
    workspaceId,
    userId: user.id,
    role,
    joinedAt: new Date(),
  });
  return user;
}

async function presign(
  projectId: string,
  body: Record<string, unknown>,
  app = createApp().app,
) {
  return app.request(`/api/agent-artifact/${projectId}/presign`, json(body));
}

async function finalize(
  projectId: string,
  body: Record<string, unknown>,
  app = createApp().app,
) {
  return app.request(`/api/agent-artifact/${projectId}/finalize`, json(body));
}

/** presign + finalize with a matching mocked HeadObject. */
async function uploadArtifact(
  projectId: string,
  body: { name: string; contentType: string; size: number; taskId?: string },
) {
  const presigned = await presign(projectId, body);
  expect(presigned.status).toBe(200);
  const p = (await presigned.json()) as Presign;
  storage.headArtifactObject.mockResolvedValueOnce({
    contentLength: body.size,
    contentType: body.contentType.toLowerCase(),
  });
  const finalized = await finalize(projectId, {
    artifactId: p.artifactId,
    storageKey: p.storageKey,
  });
  expect(finalized.status).toBe(200);
  return (await finalized.json()) as Artifact;
}

describe("API integration: agent artifacts", () => {
  beforeEach(async () => {
    await resetTestDatabase();
    for (const fn of Object.values(storage)) fn.mockReset();
    storage.createArtifactUploadUrl.mockImplementation(
      async ({ storageKey }: { storageKey: string }) => ({
        uploadUrl: `https://storage.example.test/kaneo/${storageKey}?signed=put`,
        expiresAt: new Date(Date.now() + 300_000),
      }),
    );
    storage.createArtifactDownloadUrl.mockImplementation(
      async ({
        storageKey,
        disposition,
      }: {
        storageKey: string;
        disposition: string;
      }) => ({
        url: `https://storage.example.test/kaneo/${storageKey}?signed=get&disposition=${disposition}`,
        expiresAt: new Date(Date.now() + 60_000),
      }),
    );
    storage.deleteArtifactObject.mockResolvedValue(undefined);

    process.env.S3_ENDPOINT = "https://storage.example.test";
    process.env.S3_BUCKET = "kaneo";
    process.env.S3_ACCESS_KEY_ID = "test-access-key";
    process.env.S3_SECRET_ACCESS_KEY = "test-secret-key";
    delete process.env.S3_KEY_PREFIX;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("rejects anonymous callers, outsiders and unknown projects", async () => {
    const member = await createWorkspaceMember();
    const { project } = await createProjectFixture({
      workspaceId: member.workspace.id,
    });
    const body = { name: "r.html", contentType: "text/html", size: 10 };

    mockAnonymousSession();
    expect((await presign(project.id, body)).status).toBe(401);
    expect(
      (await createApp().app.request(`/api/agent-artifact/${project.id}`))
        .status,
    ).toBe(401);

    const outsider = await createWorkspaceMember();
    mockAuthenticatedSession(outsider.user);
    expect((await presign(project.id, body)).status).toBe(403);
    expect(
      (await createApp().app.request(`/api/agent-artifact/${project.id}`))
        .status,
    ).toBe(403);

    mockAuthenticatedSession(member.user);
    expect((await presign("project-missing", body)).status).toBe(400);
  });

  it("requires task:update to presign and finalize — viewer 403", async () => {
    const admin = await createWorkspaceMember({ role: "admin" });
    const { project } = await createProjectFixture({
      workspaceId: admin.workspace.id,
    });
    const viewer = await addUser(admin.workspace.id, "viewer");
    mockAuthenticatedSession(viewer);

    const p = await presign(project.id, {
      name: "r.html",
      contentType: "text/html",
      size: 10,
    });
    expect(p.status).toBe(403);
    const f = await finalize(project.id, { artifactId: "x", storageKey: "y" });
    expect(f.status).toBe(403);

    const list = await createApp().app.request(
      `/api/agent-artifact/${project.id}`,
    );
    expect(list.status).toBe(200);
    expect(await list.json()).toEqual({ artifacts: [] });
  });

  it("validates presign input: allowlist, size, name, taskId", async () => {
    const member = await createWorkspaceMember();
    const { project, columns } = await createProjectFixture({
      workspaceId: member.workspace.id,
    });
    const other = await createProjectFixture({
      workspaceId: member.workspace.id,
      name: "Other",
    });
    const foreignTask = await seedTask(other.project.id, other.columns.todo.id);
    mockAuthenticatedSession(member.user);

    const cases: Array<[Record<string, unknown>, string | RegExp]> = [
      [
        { name: "a.png", contentType: "image/png", size: 10 },
        "contentType is not allowed for artifacts",
      ],
      [
        { name: "a.html", contentType: "text/html; charset=utf-8", size: 10 },
        "contentType is not allowed for artifacts",
      ],
      [{ name: "a.html", contentType: "text/html", size: 0 }, /^size: /],
      [
        {
          name: "a.html",
          contentType: "text/html",
          size: 10 * 1024 * 1024 + 1,
        },
        /^size: /,
      ],
      [
        { name: "../a.html", contentType: "text/html", size: 10 },
        "name: name must not contain path separators",
      ],
      [
        { name: "a\\b.html", contentType: "text/html", size: 10 },
        "name: name must not contain path separators",
      ],
      [
        { name: "x".repeat(201), contentType: "text/html", size: 10 },
        /^name: /,
      ],
      [
        {
          name: "a.html",
          contentType: "text/html",
          size: 10,
          taskId: foreignTask.id,
        },
        "taskId does not belong to this project",
      ],
      [
        { name: "a.html", contentType: "text/html", size: 10, taskId: "nope" },
        "taskId does not belong to this project",
      ],
    ];
    for (const [body, message] of cases) {
      const response = await presign(project.id, body);
      expect(response.status, JSON.stringify(body)).toBe(400);
      const text = await response.text();
      if (typeof message === "string") expect(text).toBe(message);
      else expect(text).toMatch(message);
    }
    expect(storage.createArtifactUploadUrl).not.toHaveBeenCalled();
    // Nothing invalid leaves a row behind.
    expect(await db.select().from(agentArtifactTable)).toEqual([]);

    // Sanity: the same task in the right project is accepted.
    const task = await seedTask(project.id, columns.todo.id);
    const ok = await presign(project.id, {
      name: "a.html",
      contentType: "text/html",
      size: 10,
      taskId: task.id,
    });
    expect(ok.status).toBe(200);
  });

  it("presigns a pending row, then finalize verifies and activates it", async () => {
    const member = await createWorkspaceMember();
    const { project, columns } = await createProjectFixture({
      workspaceId: member.workspace.id,
    });
    const task = await seedTask(project.id, columns.todo.id);
    mockAuthenticatedSession(member.user);

    const presigned = await presign(project.id, {
      name: "Session Report.HTML",
      contentType: "TEXT/HTML",
      size: 2048,
      taskId: task.id,
    });
    expect(presigned.status).toBe(200);
    const p = (await presigned.json()) as Presign;
    expect(p.storageKey).toBe(
      `agent-artifacts/${member.workspace.id}/${project.id}/${p.artifactId}/Session-Report.HTML`,
    );
    expect(p.uploadUrl).toContain("signed=put");
    expect(p.headers).toEqual({ "Content-Type": "text/html" });
    expect(new Date(p.expiresAt).getTime()).toBeGreaterThan(Date.now());
    expect(storage.createArtifactUploadUrl).toHaveBeenCalledWith({
      storageKey: p.storageKey,
      contentType: "text/html",
    });

    // Pending: recorded, but invisible to list, url and tree.
    const [pending] = await db
      .select()
      .from(agentArtifactTable)
      .where(eq(agentArtifactTable.id, p.artifactId));
    expect(pending).toMatchObject({
      workspaceId: member.workspace.id,
      projectId: project.id,
      taskId: task.id,
      name: "Session Report.HTML",
      contentType: "text/html",
      size: 2048,
      uploadedBy: member.user.id,
      actorId: null,
      finalizedAt: null,
    });
    const app = createApp().app;
    expect(
      await (await app.request(`/api/agent-artifact/${project.id}`)).json(),
    ).toEqual({ artifacts: [] });
    expect(
      (
        await app.request(
          `/api/agent-artifact/${project.id}/${p.artifactId}/url`,
        )
      ).status,
    ).toBe(404);

    storage.headArtifactObject.mockResolvedValueOnce({
      contentLength: 2048,
      contentType: "text/html",
    });
    const finalized = await finalize(project.id, {
      artifactId: p.artifactId,
      storageKey: p.storageKey,
    });
    expect(finalized.status).toBe(200);
    const artifact = (await finalized.json()) as Artifact;
    expect(artifact).toEqual({
      id: p.artifactId,
      projectId: project.id,
      taskId: task.id,
      name: "Session Report.HTML",
      contentType: "text/html",
      size: 2048,
      uploadedBy: member.user.id,
      actorId: null,
      createdAt: pending.createdAt.toISOString(),
    });
    expect(storage.headArtifactObject).toHaveBeenCalledWith(p.storageKey);
    // No storage internals leak through the public record.
    expect(artifact).not.toHaveProperty("storageKey");
    expect(artifact).not.toHaveProperty("finalizedAt");

    // Idempotent: a retry returns the same record without re-checking storage.
    const again = await finalize(project.id, {
      artifactId: p.artifactId,
      storageKey: p.storageKey,
    });
    expect(again.status).toBe(200);
    expect(await again.json()).toEqual(artifact);
    expect(storage.headArtifactObject).toHaveBeenCalledTimes(1);

    const listed = (await (
      await app.request(`/api/agent-artifact/${project.id}?taskId=${task.id}`)
    ).json()) as { artifacts: Artifact[] };
    expect(listed.artifacts).toEqual([artifact]);
  });

  it("finalize: 400 on mismatch or missing object, 503 on provider error, 404 elsewhere", async () => {
    const member = await createWorkspaceMember();
    const { project } = await createProjectFixture({
      workspaceId: member.workspace.id,
    });
    const other = await createProjectFixture({
      workspaceId: member.workspace.id,
      name: "Other",
    });
    mockAuthenticatedSession(member.user);

    const p = (await (
      await presign(project.id, {
        name: "bundle.zip",
        contentType: "application/zip",
        size: 500,
      })
    ).json()) as Presign;
    const body = { artifactId: p.artifactId, storageKey: p.storageKey };

    storage.headArtifactObject.mockResolvedValueOnce({
      contentLength: 501,
      contentType: "application/zip",
    });
    const sizeMismatch = await finalize(project.id, body);
    expect(sizeMismatch.status).toBe(400);
    await expect(sizeMismatch.text()).resolves.toBe(
      "Uploaded file does not match the finalize request.",
    );

    storage.headArtifactObject.mockResolvedValueOnce({
      contentLength: 500,
      contentType: "text/html",
    });
    expect((await finalize(project.id, body)).status).toBe(400);

    storage.headArtifactObject.mockRejectedValueOnce(
      new ArtifactObjectMissingError(),
    );
    const missing = await finalize(project.id, body);
    expect(missing.status).toBe(400);
    await expect(missing.text()).resolves.toBe(
      "Uploaded file does not match the finalize request.",
    );

    storage.headArtifactObject.mockRejectedValueOnce(
      Object.assign(new Error("bucket not found"), { name: "NoSuchBucket" }),
    );
    const unavailable = await finalize(project.id, body);
    expect(unavailable.status).toBe(503);
    await expect(unavailable.text()).resolves.toBe(
      "Unable to verify uploaded file.",
    );

    const wrongKey = await finalize(project.id, {
      artifactId: p.artifactId,
      storageKey: `${p.storageKey}.evil`,
    });
    expect(wrongKey.status).toBe(400);

    // Same id through another project the caller can also access: 404.
    expect((await finalize(other.project.id, body)).status).toBe(404);
    expect(
      (await finalize(project.id, { artifactId: "nope", storageKey: "k" }))
        .status,
    ).toBe(404);

    // Every failure above left the row pending, never finalized.
    const [row] = await db
      .select({ finalizedAt: agentArtifactTable.finalizedAt })
      .from(agentArtifactTable)
      .where(eq(agentArtifactTable.id, p.artifactId));
    expect(row.finalizedAt).toBeNull();

    // A later successful upload to the same URL still finalizes.
    storage.headArtifactObject.mockResolvedValueOnce({
      contentLength: 500,
      contentType: "application/zip",
    });
    expect((await finalize(project.id, body)).status).toBe(200);
  });

  it("returns 503 without a row when storage is not configured", async () => {
    const member = await createWorkspaceMember();
    const { project } = await createProjectFixture({
      workspaceId: member.workspace.id,
    });
    mockAuthenticatedSession(member.user);
    delete process.env.S3_BUCKET;

    const response = await presign(project.id, {
      name: "r.html",
      contentType: "text/html",
      size: 10,
    });
    expect(response.status).toBe(503);
    expect(await db.select().from(agentArtifactTable)).toEqual([]);
  });

  it("lists newest first, filtered by task, never across projects", async () => {
    const member = await createWorkspaceMember();
    const { project, columns } = await createProjectFixture({
      workspaceId: member.workspace.id,
    });
    const other = await createProjectFixture({
      workspaceId: member.workspace.id,
      name: "Other",
    });
    const task = await seedTask(project.id, columns.todo.id);
    mockAuthenticatedSession(member.user);

    const first = await uploadArtifact(project.id, {
      name: "first.md",
      contentType: "text/markdown",
      size: 1,
      taskId: task.id,
    });
    const second = await uploadArtifact(project.id, {
      name: "second.pdf",
      contentType: "application/pdf",
      size: 2,
    });
    await uploadArtifact(other.project.id, {
      name: "elsewhere.json",
      contentType: "application/json",
      size: 3,
    });
    // Force a deterministic order regardless of clock resolution.
    await db
      .update(agentArtifactTable)
      .set({ createdAt: new Date(Date.UTC(2026, 0, 1)) })
      .where(eq(agentArtifactTable.id, first.id));
    await db
      .update(agentArtifactTable)
      .set({ createdAt: new Date(Date.UTC(2026, 0, 2)) })
      .where(eq(agentArtifactTable.id, second.id));

    const app = createApp().app;
    const all = (await (
      await app.request(`/api/agent-artifact/${project.id}`)
    ).json()) as { artifacts: Artifact[] };
    expect(all.artifacts.map((a) => a.name)).toEqual([
      "second.pdf",
      "first.md",
    ]);

    const byTask = (await (
      await app.request(`/api/agent-artifact/${project.id}?taskId=${task.id}`)
    ).json()) as { artifacts: Artifact[] };
    expect(byTask.artifacts.map((a) => a.name)).toEqual(["first.md"]);
  });

  it("mints URLs with the disposition policy applied server-side", async () => {
    const member = await createWorkspaceMember();
    const { project } = await createProjectFixture({
      workspaceId: member.workspace.id,
    });
    const other = await createProjectFixture({
      workspaceId: member.workspace.id,
      name: "Other",
    });
    mockAuthenticatedSession(member.user);

    const html = await uploadArtifact(project.id, {
      name: "report.html",
      contentType: "text/html",
      size: 10,
    });
    const zip = await uploadArtifact(project.id, {
      name: "bundle.zip",
      contentType: "application/zip",
      size: 20,
    });
    const app = createApp().app;
    const url = (artifactId: string, query = "", projectId = project.id) =>
      app.request(`/api/agent-artifact/${projectId}/${artifactId}/url${query}`);

    const inline = await url(html.id, "?disposition=inline");
    expect(inline.status).toBe(200);
    const payload = (await inline.json()) as { url: string; expiresAt: string };
    expect(payload.url).toContain("disposition=inline");
    expect(new Date(payload.expiresAt).getTime()).toBeGreaterThan(Date.now());
    expect(storage.createArtifactDownloadUrl).toHaveBeenLastCalledWith({
      storageKey: `agent-artifacts/${member.workspace.id}/${project.id}/${html.id}/report.html`,
      contentType: "text/html",
      name: "report.html",
      disposition: "inline",
    });

    // Default is attachment.
    await url(html.id);
    expect(storage.createArtifactDownloadUrl).toHaveBeenLastCalledWith(
      expect.objectContaining({ disposition: "attachment" }),
    );

    // zip: inline is requested but never granted.
    const zipInline = await url(zip.id, "?disposition=inline");
    expect(zipInline.status).toBe(200);
    expect(storage.createArtifactDownloadUrl).toHaveBeenLastCalledWith(
      expect.objectContaining({
        contentType: "application/zip",
        disposition: "attachment",
      }),
    );

    expect((await url(html.id, "?disposition=download")).status).toBe(400);
    expect((await url(html.id, "", other.project.id)).status).toBe(404);
    expect((await url("missing")).status).toBe(404);

    // Viewers can read: URL minting needs workspace access only.
    const viewer = await addUser(member.workspace.id, "viewer");
    mockAuthenticatedSession(viewer);
    expect(
      (
        await createApp().app.request(
          `/api/agent-artifact/${project.id}/${html.id}/url`,
        )
      ).status,
    ).toBe(200);
  });

  it("delete: member 403, admin removes object then row, then 404; NotFound is ignored", async () => {
    const admin = await createWorkspaceMember({ role: "admin" });
    const { project } = await createProjectFixture({
      workspaceId: admin.workspace.id,
    });
    const other = await createProjectFixture({
      workspaceId: admin.workspace.id,
      name: "Other",
    });
    mockAuthenticatedSession(admin.user);
    const artifact = await uploadArtifact(project.id, {
      name: "report.html",
      contentType: "text/html",
      size: 10,
    });
    const storageKey = `agent-artifacts/${admin.workspace.id}/${project.id}/${artifact.id}/report.html`;

    const member = await addUser(admin.workspace.id, "member");
    mockAuthenticatedSession(member);
    const forbidden = await createApp().app.request(
      `/api/agent-artifact/${project.id}/${artifact.id}`,
      { method: "DELETE" },
    );
    expect(forbidden.status).toBe(403);

    mockAuthenticatedSession(admin.user);
    const app = createApp().app;
    // Cross-project id: 404 before any storage call.
    expect(
      (
        await app.request(
          `/api/agent-artifact/${other.project.id}/${artifact.id}`,
          { method: "DELETE" },
        )
      ).status,
    ).toBe(404);
    expect(storage.deleteArtifactObject).not.toHaveBeenCalled();

    // Storage failure keeps the row so the delete can be retried.
    storage.deleteArtifactObject.mockRejectedValueOnce(
      Object.assign(new Error("denied"), { name: "AccessDenied" }),
    );
    const failed = await app.request(
      `/api/agent-artifact/${project.id}/${artifact.id}`,
      { method: "DELETE" },
    );
    expect(failed.status).toBe(503);
    expect(
      await db
        .select({ id: agentArtifactTable.id })
        .from(agentArtifactTable)
        .where(eq(agentArtifactTable.id, artifact.id)),
    ).toHaveLength(1);

    const deleted = await app.request(
      `/api/agent-artifact/${project.id}/${artifact.id}`,
      { method: "DELETE" },
    );
    expect(deleted.status).toBe(200);
    expect(await deleted.json()).toEqual({ id: artifact.id });
    expect(storage.deleteArtifactObject).toHaveBeenLastCalledWith(storageKey);
    expect(
      await db
        .select()
        .from(agentArtifactTable)
        .where(eq(agentArtifactTable.id, artifact.id)),
    ).toEqual([]);

    const gone = await app.request(
      `/api/agent-artifact/${project.id}/${artifact.id}`,
      { method: "DELETE" },
    );
    expect(gone.status).toBe(404);
  });

  it("keeps the artifact when its task is deleted, detached from the task", async () => {
    const member = await createWorkspaceMember();
    const { project, columns } = await createProjectFixture({
      workspaceId: member.workspace.id,
    });
    const task = await seedTask(project.id, columns.todo.id);
    mockAuthenticatedSession(member.user);
    const artifact = await uploadArtifact(project.id, {
      name: "report.html",
      contentType: "text/html",
      size: 10,
      taskId: task.id,
    });

    await db.delete(schema.taskTable).where(eq(schema.taskTable.id, task.id));

    const listed = (await (
      await createApp().app.request(`/api/agent-artifact/${project.id}`)
    ).json()) as { artifacts: Artifact[] };
    expect(listed.artifacts).toEqual([{ ...artifact, taskId: null }]);
  });

  it("documents the routes in OpenAPI", async () => {
    const { app } = createApp();
    const spec = (await (await app.request("/api/openapi")).json()) as {
      paths: Record<string, Record<string, unknown>>;
      components: { schemas: Record<string, unknown> };
    };
    expect(
      Object.keys(spec.paths["/agent-artifact/{projectId}/presign"]),
    ).toEqual(["post"]);
    expect(
      Object.keys(spec.paths["/agent-artifact/{projectId}/finalize"]),
    ).toEqual(["post"]);
    expect(Object.keys(spec.paths["/agent-artifact/{projectId}"])).toEqual([
      "get",
    ]);
    expect(
      Object.keys(spec.paths["/agent-artifact/{projectId}/{artifactId}/url"]),
    ).toEqual(["get"]);
    expect(
      Object.keys(spec.paths["/agent-artifact/{projectId}/{artifactId}"]),
    ).toEqual(["delete"]);
    expect(spec.components.schemas).toHaveProperty("AgentArtifact");
    expect(spec.components.schemas).toHaveProperty("AgentArtifactPresign");
  });
});
