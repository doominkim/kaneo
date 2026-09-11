import { and, asc, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import {
  agentActorTable,
  agentDecisionTable,
  agentDecisionTaskTable,
  agentEntryTable,
} from "../../apps/api/src/database/schema-agent-layer";
import { createApp } from "../../apps/api/src/index";
import moveTask from "../../apps/api/src/task/controllers/move-task";
import { mockAuthenticatedSession } from "./helpers/auth";
import { resetTestDatabase } from "./helpers/database";
import {
  createProjectFixture,
  createWorkspaceMember,
} from "./helpers/fixtures";

type Decision = {
  id: string;
  workspaceId: string;
  projectId: string;
  number: number;
  title: string;
  context: string;
  decision: string;
  alternatives: string | null;
  consequences: string | null;
  sourceNote: string | null;
  status: "draft" | "accepted" | "superseded";
  sourceEntryId: string | null;
  supersedesDecisionId: string | null;
  tasks: Array<{ id: string; number: number | null; title: string }>;
  createdBy: string | null;
  createdAuthor: { userId: string; name: string } | null;
  createdActor: { id: string; provider: string; model: string } | null;
  updatedBy: string | null;
  updatedAuthor: { userId: string; name: string } | null;
  acceptedBy: string | null;
  acceptor: { userId: string; name: string } | null;
  updatedAt: string;
};

async function seedTask(projectId: string, columnId: string, number: number) {
  const [task] = await db
    .insert(schema.taskTable)
    .values({
      projectId,
      title: `ADR linked task ${number}`,
      description: "",
      priority: "medium",
      status: "to-do",
      columnId,
      number,
      position: number,
    })
    .returning();
  if (!task) throw new Error("Failed to seed task");
  return task;
}

async function createDecision(
  app: ReturnType<typeof createApp>["app"],
  projectId: string,
  overrides: Record<string, unknown> = {},
) {
  return app.request("/api/agent-decision", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      projectId,
      title: "Adopt an append-only decision history",
      context: "Edits would erase the reason a choice was made.",
      decision: "Record lifecycle changes as new ledger entries.",
      alternatives: "Overwrite the previous entry.",
      consequences: "The timeline grows with each accepted transition.",
      reversible: true,
      taskIds: [],
      ...overrides,
    }),
  });
}

async function jsonDecision(response: Response) {
  expect(response.status, await response.clone().text()).toBe(200);
  return (await response.json()) as Decision;
}

describe("API integration: ADR", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  it("프로젝트 번호를 원자적으로 배정하고 같은 프로젝트의 작업만 연결한다", async () => {
    const member = await createWorkspaceMember({ userName: "ADR Author" });
    const firstProject = await createProjectFixture({
      workspaceId: member.workspace.id,
    });
    const secondProject = await createProjectFixture({
      workspaceId: member.workspace.id,
    });
    const linkedTask = await seedTask(
      firstProject.project.id,
      firstProject.columns.todo.id,
      7,
    );
    const foreignTask = await seedTask(
      secondProject.project.id,
      secondProject.columns.todo.id,
      1,
    );
    mockAuthenticatedSession(member.user);
    const { app } = createApp();

    const responses = await Promise.all(
      Array.from({ length: 6 }, (_, index) =>
        createDecision(app, firstProject.project.id, {
          title: `Concurrent ADR ${index + 1}`,
          taskIds: index === 0 ? [linkedTask.id] : [],
          ...(index === 1 ? { provider: "openai", model: "gpt-6" } : {}),
        }),
      ),
    );
    const decisions = await Promise.all(responses.map(jsonDecision));

    expect(decisions.map((decision) => decision.number).sort()).toEqual([
      1, 2, 3, 4, 5, 6,
    ]);
    expect(decisions[0]?.tasks).toEqual([
      { id: linkedTask.id, number: 7, title: linkedTask.title },
    ]);
    expect(decisions[0]?.createdAuthor).toEqual({
      userId: member.user.id,
      name: "ADR Author",
    });
    expect(decisions[1]?.createdBy).toBeNull();
    expect(decisions[1]?.createdActor).toMatchObject({
      provider: "openai",
      model: "gpt-6",
    });

    const invalid = await createDecision(app, firstProject.project.id, {
      taskIds: [foreignTask.id],
    });
    expect(invalid.status).toBe(400);

    const persisted = await db
      .select({ number: agentDecisionTable.number })
      .from(agentDecisionTable)
      .where(eq(agentDecisionTable.projectId, firstProject.project.id))
      .orderBy(asc(agentDecisionTable.number));
    expect(persisted.map((row) => row.number)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it("첫 에이전트 작성이 동시에 와도 actor를 재사용하고 provider가 다르면 구분한다", async () => {
    const member = await createWorkspaceMember();
    const { project } = await createProjectFixture({
      workspaceId: member.workspace.id,
    });
    mockAuthenticatedSession(member.user);
    const { app } = createApp();

    const concurrent = await Promise.all(
      Array.from({ length: 4 }, (_, index) =>
        createDecision(app, project.id, {
          title: `Agent ADR ${index}`,
          provider: "anthropic",
          model: "shared-model-name",
        }),
      ),
    );
    const decisions = await Promise.all(concurrent.map(jsonDecision));
    expect(
      new Set(decisions.map((decision) => decision.createdActor?.id)).size,
    ).toBe(1);

    const otherProvider = await jsonDecision(
      await createDecision(app, project.id, {
        title: "Same model name from another provider",
        provider: "openai",
        model: "shared-model-name",
      }),
    );
    expect(otherProvider.createdActor?.id).not.toBe(
      decisions[0]?.createdActor?.id,
    );

    const actors = await db
      .select()
      .from(agentActorTable)
      .where(eq(agentActorTable.workspaceId, member.workspace.id));
    expect(actors).toHaveLength(2);
    expect(actors.map((actor) => actor.provider).sort()).toEqual([
      "anthropic",
      "openai",
    ]);
  });

  it("초안 편집은 낙관적 잠금을 적용하고 승인 뒤 본문을 바꾸지 못한다", async () => {
    const member = await createWorkspaceMember({
      userName: "ADR Maintainer",
      role: "admin",
    });
    const { project } = await createProjectFixture({
      workspaceId: member.workspace.id,
    });
    mockAuthenticatedSession(member.user);
    const { app } = createApp();
    const created = await jsonDecision(await createDecision(app, project.id));

    const editedResponse = await app.request(
      `/api/agent-decision/${project.id}/${created.id}`,
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          expectedUpdatedAt: created.updatedAt,
          decision:
            "Keep lifecycle events append-only and link them to the ADR.",
        }),
      },
    );
    const edited = await jsonDecision(editedResponse);
    expect(edited.updatedAt).not.toBe(created.updatedAt);
    expect(edited.updatedAuthor).toEqual({
      userId: member.user.id,
      name: "ADR Maintainer",
    });

    const staleEdit = await app.request(
      `/api/agent-decision/${project.id}/${created.id}`,
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          expectedUpdatedAt: created.updatedAt,
          title: "Stale title",
        }),
      },
    );
    expect(staleEdit.status).toBe(409);

    const accepted = await jsonDecision(
      await app.request(
        `/api/agent-decision/${project.id}/${created.id}/accept`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ expectedUpdatedAt: edited.updatedAt }),
        },
      ),
    );
    expect(accepted).toMatchObject({
      status: "accepted",
      acceptedBy: member.user.id,
      acceptor: { userId: member.user.id, name: "ADR Maintainer" },
    });

    const immutable = await app.request(
      `/api/agent-decision/${project.id}/${created.id}`,
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          expectedUpdatedAt: accepted.updatedAt,
          decision: "Rewrite accepted content",
        }),
      },
    );
    expect(immutable.status).toBe(409);
  });

  it("기존 결정 항목을 원문 의미를 바꾸지 않고 한 번만 초안으로 승격한다", async () => {
    const member = await createWorkspaceMember({ userName: "Promoter" });
    const { project, columns } = await createProjectFixture({
      workspaceId: member.workspace.id,
    });
    const task = await seedTask(project.id, columns.todo.id, 3);
    const [entry] = await db
      .insert(agentEntryTable)
      .values({
        workspaceId: member.workspace.id,
        projectId: project.id,
        taskId: task.id,
        createdBy: member.user.id,
        kind: "decision",
        summary: "Use a durable queue",
        body: "Investigation notes with uncertain historical details.",
        decision: {
          what: "Persist jobs before acknowledging them.",
          why: "Restarts must not lose work.",
          rejected: "Keep jobs only in process memory.",
          reversible: false,
        },
        refs: { files: ["apps/api/src/jobs.ts"] },
      })
      .returning();
    if (!entry) throw new Error("Failed to seed source entry");
    mockAuthenticatedSession(member.user);
    const { app } = createApp();

    const first = await jsonDecision(
      await app.request(
        `/api/agent-decision/${project.id}/from-entry/${entry.id}`,
        { method: "POST" },
      ),
    );
    const second = await jsonDecision(
      await app.request(
        `/api/agent-decision/${project.id}/from-entry/${entry.id}`,
        { method: "POST" },
      ),
    );

    expect(second.id).toBe(first.id);
    expect(first).toMatchObject({
      title: "Use a durable queue",
      context: "Restarts must not lose work.",
      decision: "Persist jobs before acknowledging them.",
      alternatives: "Keep jobs only in process memory.",
      consequences: null,
      sourceNote: "Investigation notes with uncertain historical details.",
      sourceEntryId: entry.id,
      tasks: [{ id: task.id }],
    });

    const [preserved] = await db
      .select()
      .from(agentEntryTable)
      .where(eq(agentEntryTable.id, entry.id));
    expect(preserved).toMatchObject({
      body: "Investigation notes with uncertain historical details.",
      decision: entry.decision,
      deletedAt: null,
    });
  });

  it("승인과 대체를 한 트랜잭션에서 처리하고 추적 가능한 타임라인을 덧붙인다", async () => {
    const member = await createWorkspaceMember({
      userName: "Reviewer",
      role: "admin",
    });
    const { project } = await createProjectFixture({
      workspaceId: member.workspace.id,
    });
    mockAuthenticatedSession(member.user);
    const { app } = createApp();
    const previousDraft = await jsonDecision(
      await createDecision(app, project.id, { title: "ADR one" }),
    );
    const previous = await jsonDecision(
      await app.request(
        `/api/agent-decision/${project.id}/${previousDraft.id}/accept`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            expectedUpdatedAt: previousDraft.updatedAt,
          }),
        },
      ),
    );
    const firstReplacement = await jsonDecision(
      await createDecision(app, project.id, { title: "ADR two" }),
    );
    const secondReplacement = await jsonDecision(
      await createDecision(app, project.id, { title: "ADR three" }),
    );

    const replacementResponses = await Promise.all(
      [firstReplacement, secondReplacement].map((replacement) =>
        app.request(
          `/api/agent-decision/${project.id}/${replacement.id}/accept`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              expectedUpdatedAt: replacement.updatedAt,
              supersedesDecisionId: previous.id,
            }),
          },
        ),
      ),
    );
    expect(
      replacementResponses.map((response) => response.status).sort(),
    ).toEqual([200, 409]);

    const rows = await db
      .select()
      .from(agentDecisionTable)
      .where(eq(agentDecisionTable.projectId, project.id));
    expect(rows.find((row) => row.id === previous.id)?.status).toBe(
      "superseded",
    );
    const acceptedReplacement = rows.find(
      (row) => row.supersedesDecisionId === previous.id,
    );
    expect(acceptedReplacement?.status).toBe("accepted");
    expect(rows.filter((row) => row.status === "draft")).toHaveLength(1);

    const timeline = await db
      .select({ decision: agentEntryTable.decision })
      .from(agentEntryTable)
      .where(
        and(
          eq(agentEntryTable.projectId, project.id),
          eq(agentEntryTable.kind, "decision"),
        ),
      );
    expect(timeline).toHaveLength(3);
    expect(timeline.map((row) => row.decision)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          adr: expect.objectContaining({
            decisionId: previous.id,
            status: "superseded",
            supersededByDecisionId: acceptedReplacement?.id,
          }),
        }),
        expect.objectContaining({
          adr: expect.objectContaining({
            decisionId: acceptedReplacement?.id,
            status: "accepted",
            supersedesDecisionId: previous.id,
          }),
        }),
      ]),
    );

    const entryList = await app.request(`/api/agent-entry/${project.id}`);
    expect(entryList.status).toBe(200);
    const entryPayload = (await entryList.json()) as {
      entries: Array<Record<string, unknown>>;
    };
    expect(entryPayload.entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          adrDecisionId: acceptedReplacement?.id,
          adrStatus: "accepted",
        }),
      ]),
    );
    const acceptedEntry = entryPayload.entries.find(
      (entry) => entry.adrDecisionId === acceptedReplacement?.id,
    );
    const entryDetail = await app.request(
      `/api/agent-entry/${project.id}/${String(acceptedEntry?.id)}`,
    );
    expect(entryDetail.status).toBe(200);
    await expect(entryDetail.json()).resolves.toMatchObject({
      id: acceptedEntry?.id,
      adrDecisionId: acceptedReplacement?.id,
      adrNumber: acceptedReplacement?.number,
      adrStatus: "accepted",
    });
  });

  it("목록은 상태·검색·작업·커서로 제한하고 일반 구성원은 승인하지 못한다", async () => {
    const member = await createWorkspaceMember({ userName: "Member" });
    const { project, columns } = await createProjectFixture({
      workspaceId: member.workspace.id,
    });
    const task = await seedTask(project.id, columns.todo.id, 11);
    mockAuthenticatedSession(member.user);
    const { app } = createApp();
    const first = await jsonDecision(
      await createDecision(app, project.id, {
        title: "Postgres queue",
        context: "Need durable delivery",
        taskIds: [task.id],
      }),
    );
    await jsonDecision(
      await createDecision(app, project.id, { title: "Object storage" }),
    );

    const forbidden = await app.request(
      `/api/agent-decision/${project.id}/${first.id}/accept`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ expectedUpdatedAt: first.updatedAt }),
      },
    );
    expect(forbidden.status).toBe(403);

    const searched = await app.request(
      `/api/agent-decision/${project.id}?q=durable&taskId=${task.id}&status=draft`,
    );
    expect(searched.status).toBe(200);
    const searchedPayload = (await searched.json()) as {
      decisions: Array<Record<string, unknown>>;
      nextBefore: string | null;
    };
    expect(searchedPayload.decisions).toHaveLength(1);
    expect(searchedPayload.decisions[0]).toMatchObject({
      id: first.id,
      contextPreview: "Need durable delivery",
    });
    expect(searchedPayload.decisions[0]).not.toHaveProperty("context");
    expect(searchedPayload.decisions[0]).not.toHaveProperty("decision");

    const firstPage = await app.request(
      `/api/agent-decision/${project.id}?status=all&limit=1`,
    );
    const firstPagePayload = (await firstPage.json()) as {
      decisions: Array<{ id: string }>;
      nextBefore: string | null;
    };
    expect(firstPagePayload.decisions).toHaveLength(1);
    expect(firstPagePayload.nextBefore).toBe(firstPagePayload.decisions[0]?.id);
    const secondPage = await app.request(
      `/api/agent-decision/${project.id}?status=all&limit=1&before=${firstPagePayload.nextBefore}`,
    );
    const secondPagePayload = (await secondPage.json()) as {
      decisions: Array<{ id: string }>;
    };
    expect(secondPagePayload.decisions).toHaveLength(1);
    expect(secondPagePayload.decisions[0]?.id).not.toBe(
      firstPagePayload.decisions[0]?.id,
    );
  });

  it("다른 워크스페이스 사용자는 모든 ADR 경로에서 내용을 읽거나 바꾸지 못한다", async () => {
    const owner = await createWorkspaceMember({ role: "admin" });
    const outsider = await createWorkspaceMember({ role: "admin" });
    const { project } = await createProjectFixture({
      workspaceId: owner.workspace.id,
    });
    const [decision] = await db
      .insert(agentDecisionTable)
      .values({
        workspaceId: owner.workspace.id,
        projectId: project.id,
        number: 1,
        title: "Private architecture",
        context: "Private context",
        decision: "Private decision",
        createdBy: owner.user.id,
        updatedBy: owner.user.id,
      })
      .returning();
    const [entry] = await db
      .insert(agentEntryTable)
      .values({
        workspaceId: owner.workspace.id,
        projectId: project.id,
        createdBy: owner.user.id,
        kind: "decision",
        summary: "Private legacy decision",
        decision: { what: "Private", why: "Private reason" },
      })
      .returning();
    if (!decision || !entry) throw new Error("Failed to seed private ADR");
    mockAuthenticatedSession(outsider.user);
    const { app } = createApp();

    const requests = await Promise.all([
      app.request(`/api/agent-decision/${project.id}`),
      app.request(`/api/agent-decision/${project.id}/${decision.id}`),
      createDecision(app, project.id, { title: "Unauthorized draft" }),
      app.request(`/api/agent-decision/${project.id}/${decision.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          expectedUpdatedAt: decision.updatedAt.toISOString(),
          title: "Unauthorized edit",
        }),
      }),
      app.request(`/api/agent-decision/${project.id}/from-entry/${entry.id}`, {
        method: "POST",
      }),
      app.request(`/api/agent-decision/${project.id}/${decision.id}/accept`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          expectedUpdatedAt: decision.updatedAt.toISOString(),
        }),
      }),
    ]);

    expect(requests.map((response) => response.status)).toEqual([
      403, 403, 403, 403, 403, 403,
    ]);
    const responseBodies = await Promise.all(
      requests.map((response) => response.text()),
    );
    expect(responseBodies.join("\n")).not.toContain("Private architecture");
    expect(responseBodies.join("\n")).not.toContain("Private context");
    expect(responseBodies.join("\n")).not.toContain("Private decision");

    const [preserved] = await db
      .select()
      .from(agentDecisionTable)
      .where(eq(agentDecisionTable.id, decision.id));
    expect(preserved).toMatchObject({
      title: "Private architecture",
      status: "draft",
      updatedAt: decision.updatedAt,
    });
    expect(
      await db
        .select()
        .from(agentDecisionTable)
        .where(eq(agentDecisionTable.projectId, project.id)),
    ).toHaveLength(1);
  });

  it("연결된 작업을 옮기면 같은 트랜잭션에서 ADR 연결을 끊고 읽기에서도 숨긴다", async () => {
    const member = await createWorkspaceMember();
    const source = await createProjectFixture({
      workspaceId: member.workspace.id,
    });
    const destination = await createProjectFixture({
      workspaceId: member.workspace.id,
    });
    const task = await seedTask(source.project.id, source.columns.todo.id, 20);
    mockAuthenticatedSession(member.user);
    const { app } = createApp();
    const decision = await jsonDecision(
      await createDecision(app, source.project.id, { taskIds: [task.id] }),
    );

    await moveTask({
      taskId: task.id,
      destinationProjectId: destination.project.id,
      currentUserId: member.user.id,
    });

    expect(
      await db
        .select()
        .from(agentDecisionTaskTable)
        .where(eq(agentDecisionTaskTable.taskId, task.id)),
    ).toEqual([]);

    // Even a stale link inserted outside the API cannot leak a task from the
    // destination project into this project's ADR reads.
    await db.insert(agentDecisionTaskTable).values({
      decisionId: decision.id,
      taskId: task.id,
    });
    const detail = await jsonDecision(
      await app.request(
        `/api/agent-decision/${source.project.id}/${decision.id}`,
      ),
    );
    expect(detail.tasks).toEqual([]);
    const filtered = await app.request(
      `/api/agent-decision/${source.project.id}?taskId=${task.id}`,
    );
    expect(filtered.status).toBe(200);
    await expect(filtered.json()).resolves.toMatchObject({ decisions: [] });

    const racingTask = await seedTask(
      source.project.id,
      source.columns.todo.id,
      21,
    );
    const [createResult, moveResult] = await Promise.all([
      createDecision(app, source.project.id, {
        title: "Concurrent link",
        taskIds: [racingTask.id],
      }),
      moveTask({
        taskId: racingTask.id,
        destinationProjectId: destination.project.id,
        currentUserId: member.user.id,
      }),
    ]);
    expect([200, 400]).toContain(createResult.status);
    expect(moveResult.task.projectId).toBe(destination.project.id);
    expect(
      await db
        .select()
        .from(agentDecisionTaskTable)
        .where(eq(agentDecisionTaskTable.taskId, racingTask.id)),
    ).toEqual([]);
  });

  it("대체 연결이 있어도 프로젝트와 워크스페이스 삭제가 연쇄되고 무관한 행은 남는다", async () => {
    const member = await createWorkspaceMember({ role: "admin" });
    const deletedProject = await createProjectFixture({
      workspaceId: member.workspace.id,
    });
    const workspaceProject = await createProjectFixture({
      workspaceId: member.workspace.id,
    });
    const unrelated = await createWorkspaceMember();
    const unrelatedProject = await createProjectFixture({
      workspaceId: unrelated.workspace.id,
    });
    mockAuthenticatedSession(member.user);
    const { app } = createApp();

    async function seedAcceptedChain(projectId: string) {
      const previousDraft = await jsonDecision(
        await createDecision(app, projectId, { title: "Previous ADR" }),
      );
      const previous = await jsonDecision(
        await app.request(
          `/api/agent-decision/${projectId}/${previousDraft.id}/accept`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              expectedUpdatedAt: previousDraft.updatedAt,
            }),
          },
        ),
      );
      const replacementDraft = await jsonDecision(
        await createDecision(app, projectId, { title: "Replacement ADR" }),
      );
      return jsonDecision(
        await app.request(
          `/api/agent-decision/${projectId}/${replacementDraft.id}/accept`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              expectedUpdatedAt: replacementDraft.updatedAt,
              supersedesDecisionId: previous.id,
            }),
          },
        ),
      );
    }

    await seedAcceptedChain(deletedProject.project.id);
    await seedAcceptedChain(workspaceProject.project.id);
    const [unrelatedPrevious] = await db
      .insert(agentDecisionTable)
      .values({
        workspaceId: unrelated.workspace.id,
        projectId: unrelatedProject.project.id,
        number: 1,
        title: "Unrelated previous",
        context: "Unrelated context",
        decision: "Unrelated decision",
        status: "superseded",
      })
      .returning();
    if (!unrelatedPrevious) throw new Error("Failed to seed unrelated ADR");
    await db.insert(agentDecisionTable).values({
      workspaceId: unrelated.workspace.id,
      projectId: unrelatedProject.project.id,
      number: 2,
      title: "Unrelated replacement",
      context: "Unrelated context",
      decision: "Unrelated decision",
      status: "accepted",
      supersedesDecisionId: unrelatedPrevious.id,
    });

    await expect(
      db
        .delete(schema.projectTable)
        .where(eq(schema.projectTable.id, deletedProject.project.id)),
    ).resolves.toBeDefined();
    expect(
      await db
        .select()
        .from(agentDecisionTable)
        .where(eq(agentDecisionTable.projectId, deletedProject.project.id)),
    ).toEqual([]);
    expect(
      await db
        .select()
        .from(agentDecisionTable)
        .where(eq(agentDecisionTable.projectId, workspaceProject.project.id)),
    ).toHaveLength(2);

    await expect(
      db
        .delete(schema.workspaceTable)
        .where(eq(schema.workspaceTable.id, member.workspace.id)),
    ).resolves.toBeDefined();
    expect(
      await db
        .select()
        .from(agentDecisionTable)
        .where(eq(agentDecisionTable.workspaceId, member.workspace.id)),
    ).toEqual([]);
    expect(
      await db
        .select()
        .from(agentDecisionTable)
        .where(eq(agentDecisionTable.workspaceId, unrelated.workspace.id)),
    ).toHaveLength(2);
  });
});
