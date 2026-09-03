import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  type McpToolRegistrar,
  registerMcpTools,
} from "../../apps/api/src/mcp/tools";
import { withSanitizedWhoami } from "../../apps/api/src/mcp/whoami";

type ToolCallback = (args: unknown) => Promise<{
  content: Array<{ text: string }>;
  isError?: boolean;
}>;

function collectTools(options: { sanitizeWhoami?: boolean } = {}) {
  const tools = new Map<string, ToolCallback>();
  const registrar: McpToolRegistrar = {
    registerTool: (name, _config, callback) => tools.set(name, callback),
  };
  registerMcpTools(
    options.sanitizeWhoami ? withSanitizedWhoami(registrar) : registrar,
    "http://api.test",
    "test-token",
  );
  return tools;
}

const tools = collectTools();
// The API wires the upstream catalogue through the fork's whoami guard
// (modern.ts and index.ts); this map mirrors that wiring.
const guardedTools = collectTools({ sanitizeWhoami: true });

function call(name: string, args: unknown = {}) {
  const tool = tools.get(name);
  if (!tool) throw new Error(`Tool ${name} is not registered`);
  return tool(args);
}

function callGuarded(name: string, args: unknown = {}) {
  const tool = guardedTools.get(name);
  if (!tool) throw new Error(`Tool ${name} is not registered`);
  return tool(args);
}

let apiFetch: ReturnType<typeof vi.fn>;

beforeEach(() => {
  apiFetch = vi.fn(async () => Response.json({ ok: true }));
  vi.stubGlobal("fetch", apiFetch);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function lastRequest() {
  const [input, init] = apiFetch.mock.calls.at(-1) as [
    RequestInfo | URL,
    RequestInit | undefined,
  ];
  return {
    url: String(input),
    method: init?.method ?? "GET",
    body: init?.body ? JSON.parse(String(init.body)) : undefined,
    auth: new Headers(init?.headers).get("authorization"),
  };
}

describe("MCP tool catalog", () => {
  it("resolves workspace members", async () => {
    await call("list_workspace_members", { workspaceId: "ws 1" });

    const request = lastRequest();
    expect(request.url).toBe("http://api.test/api/workspace/ws%201/members");
    expect(request.auth).toBe("Bearer test-token");
  });

  it("passes only the search filters that were supplied", async () => {
    await call("search", { q: "login bug" });
    expect(lastRequest().url).toBe("http://api.test/api/search?q=login+bug");

    await call("search", {
      q: "login bug",
      type: "tasks",
      projectId: "p1",
      limit: 5,
    });
    const url = new URL(lastRequest().url);
    expect(Object.fromEntries(url.searchParams)).toEqual({
      q: "login bug",
      type: "tasks",
      projectId: "p1",
      limit: "5",
    });
  });

  it("rejects a search limit above the API maximum", async () => {
    const result = await call("search", { q: "x", limit: 500 });

    expect(result.isError).toBe(true);
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it("lists the columns whose slugs are valid task statuses", async () => {
    await call("list_project_columns", { projectId: "p1" });

    expect(lastRequest().url).toBe("http://api.test/api/column/p1");
  });

  it("deletes a task", async () => {
    await call("delete_task", { taskId: "t1" });

    expect(lastRequest()).toMatchObject({
      url: "http://api.test/api/task/t1",
      method: "DELETE",
    });
  });

  it("assigns and unassigns a task", async () => {
    await call("update_task_assignee", { taskId: "t1", userId: "u1" });
    expect(lastRequest()).toMatchObject({
      url: "http://api.test/api/task/assignee/t1",
      method: "PUT",
      body: { userId: "u1" },
    });

    await call("update_task_assignee", { taskId: "t1", userId: null });
    expect(lastRequest().body).toEqual({ userId: null });
  });

  it("rejects an empty assignee id rather than sending it", async () => {
    const result = await call("update_task_assignee", {
      taskId: "t1",
      userId: "",
    });

    expect(result.isError).toBe(true);
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it("sets and clears a due date", async () => {
    await call("update_task_due_date", {
      taskId: "t1",
      dueDate: "2026-09-01T10:00:00Z",
    });
    expect(lastRequest()).toMatchObject({
      url: "http://api.test/api/task/due-date/t1",
      method: "PUT",
      body: { dueDate: "2026-09-01T10:00:00Z" },
    });

    await call("update_task_due_date", { taskId: "t1" });
    expect(lastRequest().body).toEqual({});
  });

  it("rejects a due date that is not an ISO date-time", async () => {
    const result = await call("update_task_due_date", {
      taskId: "t1",
      dueDate: "next tuesday",
    });

    expect(result.isError).toBe(true);
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it("reads time entries for a task and by id", async () => {
    await call("list_task_time_entries", { taskId: "t1" });
    expect(lastRequest().url).toBe("http://api.test/api/time-entry/task/t1");

    await call("get_time_entry", { id: "te1" });
    expect(lastRequest().url).toBe("http://api.test/api/time-entry/te1");
  });

  it("creates a running time entry when endTime is omitted", async () => {
    await call("create_time_entry", {
      taskId: "t1",
      startTime: "2026-08-10T09:00:00Z",
    });

    expect(lastRequest()).toMatchObject({
      url: "http://api.test/api/time-entry",
      method: "POST",
      body: { taskId: "t1", startTime: "2026-08-10T09:00:00Z" },
    });
    expect(lastRequest().body).not.toHaveProperty("endTime");
  });

  it("updates a time entry", async () => {
    await call("update_time_entry", {
      id: "te1",
      startTime: "2026-08-10T09:00:00Z",
      endTime: "2026-08-10T10:30:00Z",
      description: "pairing",
    });

    expect(lastRequest()).toMatchObject({
      url: "http://api.test/api/time-entry/te1",
      method: "PUT",
      body: {
        startTime: "2026-08-10T09:00:00Z",
        endTime: "2026-08-10T10:30:00Z",
        description: "pairing",
      },
    });
  });

  it("reads task activity and notifications", async () => {
    await call("list_task_activity", { taskId: "t1" });
    expect(lastRequest().url).toBe("http://api.test/api/activity/t1");

    await call("list_notifications");
    expect(lastRequest().url).toBe("http://api.test/api/notification");
  });

  it("surfaces an API failure as a tool error", async () => {
    apiFetch.mockResolvedValueOnce(
      Response.json({ message: "Task not found" }, { status: 404 }),
    );

    const result = await call("delete_task", { taskId: "missing" });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Task not found");
  });
});

const fullSession = {
  session: {
    id: "sess-1",
    token: "secret-bearer-session-token",
    userId: "u1",
    expiresAt: "2026-10-01T00:00:00.000Z",
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-01T00:00:00.000Z",
    ipAddress: "203.0.113.7",
    userAgent: "curl/8",
    activeOrganizationId: "ws-1",
  },
  user: {
    id: "u1",
    name: "Ada",
    email: "ada@example.com",
    role: "admin",
    emailVerified: true,
    image: null,
    banned: false,
    banReason: null,
    banExpires: null,
    isAnonymous: false,
    locale: "en-US",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  },
};

describe("whoami guard", () => {
  it("upstream whoami leaks the session token (the reason the guard exists)", async () => {
    apiFetch.mockResolvedValueOnce(Response.json(fullSession));

    const result = await call("whoami");

    expect(lastRequest().url).toBe("http://api.test/api/auth/get-session");
    expect(result.content[0].text).toContain("secret-bearer-session-token");
  });

  it("returns only the allowlisted user and session fields", async () => {
    apiFetch.mockResolvedValueOnce(Response.json(fullSession));

    const result = await callGuarded("whoami");

    expect(result.isError).toBeFalsy();
    expect(JSON.parse(result.content[0].text)).toEqual({
      user: { id: "u1", name: "Ada", email: "ada@example.com", role: "admin" },
      session: { id: "sess-1", expiresAt: "2026-10-01T00:00:00.000Z" },
    });
    expect(result.content[0].text).not.toContain("secret-bearer-session-token");
    expect(result.content[0].text).not.toContain("203.0.113.7");
    expect(result.content[0].text).not.toContain("curl/8");
  });

  it("nulls absent optional fields instead of inventing them", async () => {
    apiFetch.mockResolvedValueOnce(
      Response.json({ user: { id: "u2" }, session: { token: "t" } }),
    );

    const result = await callGuarded("whoami");

    expect(JSON.parse(result.content[0].text)).toEqual({
      user: { id: "u2", name: null, email: null, role: null },
      session: { id: null, expiresAt: null },
    });
  });

  it("reports no active session rather than echoing a null payload", async () => {
    apiFetch.mockResolvedValueOnce(Response.json(null));

    const result = await callGuarded("whoami");

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("no active session");
  });

  it("passes upstream API failures through unchanged", async () => {
    apiFetch.mockResolvedValueOnce(
      Response.json({ message: "Unauthorized" }, { status: 401 }),
    );

    const result = await callGuarded("whoami");

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Unauthorized");
  });

  it("leaves every other tool untouched", async () => {
    apiFetch.mockResolvedValueOnce(Response.json({ token: "not-a-session" }));

    const result = await callGuarded("list_workspaces");

    expect(result.isError).toBeFalsy();
    expect(JSON.parse(result.content[0].text)).toEqual({
      token: "not-a-session",
    });
  });
});
