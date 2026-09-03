import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { agentProjectTable } from "../../apps/api/src/database/schema-agent-layer";
import { createApp } from "../../apps/api/src/index";
import { mockAnonymousSession, mockAuthenticatedSession } from "./helpers/auth";
import { resetTestDatabase } from "./helpers/database";
import {
  createProjectFixture,
  createWorkspaceMember,
} from "./helpers/fixtures";

type Settings = {
  projectId: string;
  corePaths: string[];
  activeTaskThreshold: number;
  doneArchiveDays: number;
  configured: boolean;
  updatedBy: string | null;
  updatedAt: string | null;
};

const DEFAULTS = {
  corePaths: [],
  activeTaskThreshold: 20,
  doneArchiveDays: 30,
  configured: false,
  updatedBy: null,
  updatedAt: null,
};

function validBody(overrides: Record<string, unknown> = {}) {
  return JSON.stringify({
    corePaths: ["src/domain/**", "**/migrations/**"],
    activeTaskThreshold: 10,
    doneArchiveDays: 14,
    ...overrides,
  });
}

async function addUser(workspaceId: string, role: string) {
  const id = `user-${randomUUID()}`;
  const [user] = await db
    .insert(schema.userTable)
    .values({ id, email: `${id}@example.com`, emailVerified: true, name: role })
    .returning();
  await db.insert(schema.workspaceUserTable).values({
    workspaceId,
    userId: user.id,
    role,
    joinedAt: new Date(),
  });
  return user;
}

function getSettings(projectId: string) {
  return createApp().app.request(`/api/agent-project/${projectId}`);
}

function putSettings(projectId: string, body: string) {
  return createApp().app.request(`/api/agent-project/${projectId}`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body,
  });
}

describe("API integration: agent project settings", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  it("rejects anonymous callers, outsiders and unknown projects", async () => {
    const admin = await createWorkspaceMember({ role: "admin" });
    const { project } = await createProjectFixture({
      workspaceId: admin.workspace.id,
    });

    mockAnonymousSession();
    expect((await getSettings(project.id)).status).toBe(401);
    expect((await putSettings(project.id, validBody())).status).toBe(401);

    const outsider = await createWorkspaceMember({ role: "admin" });
    mockAuthenticatedSession(outsider.user);
    expect((await getSettings(project.id)).status).toBe(403);
    expect((await putSettings(project.id, validBody())).status).toBe(403);

    mockAuthenticatedSession(admin.user);
    expect((await getSettings("project-missing")).status).toBe(400);
    expect((await putSettings("project-missing", validBody())).status).toBe(
      400,
    );
    expect(await db.select().from(agentProjectTable)).toHaveLength(0);
  });

  it("returns defaults with configured=false and creates no row on read", async () => {
    const member = await createWorkspaceMember();
    const { project } = await createProjectFixture({
      workspaceId: member.workspace.id,
    });

    mockAuthenticatedSession(member.user);
    const response = await getSettings(project.id);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      projectId: project.id,
      ...DEFAULTS,
    });
    expect(await db.select().from(agentProjectTable)).toHaveLength(0);
  });

  it("upserts as admin: creates, normalizes patterns, then replaces in place", async () => {
    const admin = await createWorkspaceMember({ role: "admin" });
    const { project } = await createProjectFixture({
      workspaceId: admin.workspace.id,
    });

    mockAuthenticatedSession(admin.user);
    const created = await putSettings(
      project.id,
      validBody({
        corePaths: [
          "./src/domain/**",
          "src/domain/**",
          " **/migrations/** ",
          ".github/**",
        ],
      }),
    );

    expect(created.status).toBe(200);
    const first = (await created.json()) as Settings;
    expect(first).toMatchObject({
      projectId: project.id,
      // leading ./ stripped, whitespace trimmed, duplicates collapsed
      corePaths: ["src/domain/**", "**/migrations/**", ".github/**"],
      activeTaskThreshold: 10,
      doneArchiveDays: 14,
      configured: true,
      updatedBy: admin.user.id,
    });
    expect(first.updatedAt).toEqual(expect.any(String));

    const read = await getSettings(project.id);
    expect(await read.json()).toEqual(first);

    const [row] = await db
      .select()
      .from(agentProjectTable)
      .where(eq(agentProjectTable.projectId, project.id));
    expect(row).toMatchObject({
      workspaceId: admin.workspace.id,
      corePaths: ["src/domain/**", "**/migrations/**", ".github/**"],
    });
    const createdAt = row?.createdAt;

    const replaced = await putSettings(
      project.id,
      validBody({ corePaths: [], activeTaskThreshold: 3, doneArchiveDays: 1 }),
    );
    expect(replaced.status).toBe(200);
    expect(await replaced.json()).toMatchObject({
      corePaths: [],
      activeTaskThreshold: 3,
      doneArchiveDays: 1,
      configured: true,
    });

    const rows = await db.select().from(agentProjectTable);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.createdAt).toEqual(createdAt);
    expect(rows[0]?.updatedAt.getTime()).toBeGreaterThanOrEqual(
      createdAt?.getTime() ?? Number.POSITIVE_INFINITY,
    );
  });

  it("requires project:update to write — member and viewer 403, both can read", async () => {
    const admin = await createWorkspaceMember({ role: "admin" });
    const { project } = await createProjectFixture({
      workspaceId: admin.workspace.id,
    });
    const member = await addUser(admin.workspace.id, "member");
    const viewer = await addUser(admin.workspace.id, "viewer");

    for (const user of [member, viewer]) {
      mockAuthenticatedSession(user);
      expect((await getSettings(project.id)).status).toBe(200);
      expect((await putSettings(project.id, validBody())).status).toBe(403);
    }
    expect(await db.select().from(agentProjectTable)).toHaveLength(0);
  });

  it("validates the body", async () => {
    const admin = await createWorkspaceMember({ role: "admin" });
    const { project } = await createProjectFixture({
      workspaceId: admin.workspace.id,
    });
    mockAuthenticatedSession(admin.user);

    const rejected: Array<[string, Record<string, unknown>]> = [
      ["absolute pattern", { corePaths: ["/etc/**"] }],
      ["windows absolute pattern", { corePaths: ["C:\\repo\\**"] }],
      ["leading ..", { corePaths: ["../src/**"] }],
      ["inner ..", { corePaths: ["src/../etc/**"] }],
      ["empty pattern", { corePaths: [""] }],
      ["blank pattern", { corePaths: ["   "] }],
      ["bare ./", { corePaths: ["./"] }],
      ["too long pattern", { corePaths: ["a".repeat(201)] }],
      [
        "too many patterns",
        { corePaths: Array.from({ length: 51 }, (_, i) => `p${i}/**`) },
      ],
      ["threshold 0", { activeTaskThreshold: 0 }],
      ["threshold 501", { activeTaskThreshold: 501 }],
      ["threshold float", { activeTaskThreshold: 2.5 }],
      ["archive 0", { doneArchiveDays: 0 }],
      ["archive 366", { doneArchiveDays: 366 }],
      ["corePaths not array", { corePaths: "src/**" }],
    ];
    for (const [label, overrides] of rejected) {
      const response = await putSettings(project.id, validBody(overrides));
      expect(response.status, label).toBe(400);
    }

    // Each field is required: PUT is a full replacement, not a patch.
    for (const key of ["corePaths", "activeTaskThreshold", "doneArchiveDays"]) {
      const body = JSON.parse(validBody()) as Record<string, unknown>;
      delete body[key];
      const response = await putSettings(project.id, JSON.stringify(body));
      expect(response.status, `missing ${key}`).toBe(400);
    }

    // Boundaries are inclusive.
    const ok = await putSettings(
      project.id,
      validBody({
        corePaths: Array.from({ length: 50 }, (_, i) => `p${i}/**`),
        activeTaskThreshold: 500,
        doneArchiveDays: 365,
      }),
    );
    expect(ok.status).toBe(200);
    const okLong = await putSettings(
      project.id,
      validBody({ corePaths: ["a".repeat(200)] }),
    );
    expect(okLong.status).toBe(200);
    // Unknown keys are stripped, not rejected.
    const extra = await putSettings(project.id, validBody({ bogus: true }));
    expect(extra.status).toBe(200);
    expect(await extra.json()).not.toHaveProperty("bogus");
  });

  it("keeps settings per project and per workspace", async () => {
    const admin = await createWorkspaceMember({ role: "admin" });
    const { project: a } = await createProjectFixture({
      workspaceId: admin.workspace.id,
      slug: "a",
    });
    const { project: b } = await createProjectFixture({
      workspaceId: admin.workspace.id,
      slug: "b",
    });
    const other = await createWorkspaceMember({ role: "admin" });
    const { project: foreign } = await createProjectFixture({
      workspaceId: other.workspace.id,
    });

    mockAuthenticatedSession(admin.user);
    expect(
      (await putSettings(a.id, validBody({ activeTaskThreshold: 5 }))).status,
    ).toBe(200);

    const bSettings = (await (await getSettings(b.id)).json()) as Settings;
    expect(bSettings).toEqual({ projectId: b.id, ...DEFAULTS });

    // Admin of workspace A has no say over workspace B's project.
    expect((await getSettings(foreign.id)).status).toBe(403);
    expect((await putSettings(foreign.id, validBody())).status).toBe(403);

    // Deleting the project takes its settings with it.
    await db
      .delete(schema.projectTable)
      .where(eq(schema.projectTable.id, a.id));
    expect(await db.select().from(agentProjectTable)).toHaveLength(0);
  });

  it("documents both routes and the settings component", async () => {
    const { app } = createApp();
    const spec = (await (await app.request("/api/openapi")).json()) as {
      paths: Record<string, Record<string, { operationId?: string }>>;
      components: {
        schemas: Record<string, { properties?: Record<string, unknown> }>;
      };
    };

    const path = spec.paths["/agent-project/{projectId}"];
    expect(path?.get?.operationId).toBe("getAgentProjectSettings");
    expect(path?.put?.operationId).toBe("putAgentProjectSettings");
    expect(spec.paths).toHaveProperty("/agent-project/{projectId}/tree");
    expect(
      Object.keys(
        spec.components.schemas.AgentProjectSettings?.properties ?? {},
      ),
    ).toEqual([
      "projectId",
      "corePaths",
      "activeTaskThreshold",
      "doneArchiveDays",
      "configured",
      "updatedBy",
      "updatedAt",
    ]);
  });
});
