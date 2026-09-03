import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The in-process write path talks to the database; the tools are tested
// against its contract, the path itself is covered by integration tests.
const direct = vi.hoisted(() => ({
  putDocumentAsAgent: vi.fn(),
  presignArtifactAsAgent: vi.fn(),
  putTextArtifactAsAgent: vi.fn(),
}));
vi.mock("../../apps/api/src/mcp/agent-direct", () => direct);

import { registerAgentTools } from "../../apps/api/src/mcp/agent-tools";
import type { McpToolRegistrar } from "../../apps/api/src/mcp/tools";

type ToolCallback = (args: unknown) => Promise<{
  content: Array<{ text: string }>;
  isError?: boolean;
}>;

function collectTools() {
  const tools = new Map<string, ToolCallback>();
  const registrar: McpToolRegistrar = {
    registerTool: (name, _config, callback) => tools.set(name, callback),
  };
  registerAgentTools(registrar, "http://api.test", "test-token", "user-1");
  return tools;
}

const tools = collectTools();

async function callRaw(name: string, args: unknown = {}) {
  const tool = tools.get(name);
  if (!tool) throw new Error(`Tool ${name} is not registered`);
  return tool(args);
}

async function call(name: string, args: unknown = {}) {
  const result = await callRaw(name, args);
  return JSON.parse(result.content[0].text);
}

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

let apiFetch: ReturnType<typeof vi.fn>;

beforeEach(() => {
  apiFetch = vi.fn(async () => Response.json({}));
  vi.stubGlobal("fetch", apiFetch);
});

afterEach(() => {
  vi.unstubAllGlobals();
  for (const fn of Object.values(direct)) fn.mockReset();
});

function documentRows(count: number) {
  return Array.from({ length: count }, (_, i) => ({
    id: `doc-${i}`,
    slug: `doc-${String(i).padStart(2, "0")}`,
    title: `Document ${i}`,
    taskId: null,
    updatedBy: "user-1",
    actorId: null,
    // Older index = older document, so the newest is the last one.
    updatedAt: new Date(Date.UTC(2026, 0, 1, 0, i)).toISOString(),
  }));
}

describe("agent_brief documents", () => {
  it("caps to the 20 most recently updated and reports the total", async () => {
    const rows = documentRows(25);
    apiFetch.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/agent-document/")) {
        return Response.json({ documents: rows });
      }
      return Response.json({});
    });

    const brief = await call("agent_brief", { projectId: "p1" });

    expect(brief.documentsTotal).toBe(25);
    expect(brief.documentsTruncated).toBe(true);
    expect(brief.documents).toHaveLength(20);
    // Newest first: index 24 down to 5.
    expect(brief.documents[0].slug).toBe("doc-24");
    expect(brief.documents[19].slug).toBe("doc-05");
    expect(brief.documents[0]).toEqual({
      slug: "doc-24",
      title: "Document 24",
      updatedAt: rows[24].updatedAt,
    });
  });

  it("breaks updatedAt ties by slug and does not flag truncation under the cap", async () => {
    const sameStamp = new Date(Date.UTC(2026, 0, 1)).toISOString();
    apiFetch.mockImplementation(async (input: RequestInfo | URL) => {
      if (String(input).includes("/api/agent-document/")) {
        return Response.json({
          documents: [
            { slug: "zeta", title: "Z", updatedAt: sameStamp },
            { slug: "alpha", title: "A", updatedAt: sameStamp },
          ],
        });
      }
      return Response.json({});
    });

    const brief = await call("agent_brief", { projectId: "p1" });

    expect(brief.documents.map((d: { slug: string }) => d.slug)).toEqual([
      "alpha",
      "zeta",
    ]);
    expect(brief.documentsTotal).toBe(2);
    expect(brief.documentsTruncated).toBe(false);
  });

  it("degrades to an empty list when the document endpoint fails", async () => {
    apiFetch.mockImplementation(async (input: RequestInfo | URL) => {
      if (String(input).includes("/api/agent-document/")) {
        return new Response("boom", { status: 500 });
      }
      return Response.json({});
    });

    const brief = await call("agent_brief", { projectId: "p1" });

    expect(brief.documents).toEqual([]);
    expect(brief.documentsTotal).toBe(0);
    expect(brief.documentsTruncated).toBe(false);
  });
});

const identity = { provider: "anthropic", model: "claude-opus-5" };

function documentDetail(body: string) {
  return {
    id: "doc-1",
    workspaceId: "ws-1",
    projectId: "p1",
    slug: "report",
    title: "Report",
    taskId: null,
    updatedBy: null,
    actorId: "actor-1",
    body,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-02T00:00:00.000Z",
  };
}

describe("agent_doc_get", () => {
  it("returns meta and a whole small body without truncation", async () => {
    apiFetch.mockImplementation(async () =>
      Response.json(documentDetail("# hi\n")),
    );

    const result = await call("agent_doc_get", {
      projectId: "p1",
      slug: "report",
    });

    expect(lastRequest()).toMatchObject({
      url: "http://api.test/api/agent-document/p1/report",
      method: "GET",
      auth: "Bearer test-token",
    });
    expect(result).toEqual({
      id: "doc-1",
      slug: "report",
      title: "Report",
      taskId: null,
      updatedBy: null,
      actorId: "actor-1",
      updatedAt: "2026-01-02T00:00:00.000Z",
      body: "# hi\n",
      bodyBytes: 5,
      offset: 0,
      nextOffset: null,
      truncated: false,
    });
    // Never the whole record: workspace/project are known to the caller.
    expect(result).not.toHaveProperty("workspaceId");
  });

  it("windows the body to 8KB and pages by byte offset", async () => {
    const body = "x".repeat(20_000);
    apiFetch.mockImplementation(async () =>
      Response.json(documentDetail(body)),
    );

    const first = await call("agent_doc_get", {
      projectId: "p1",
      slug: "report",
    });
    expect(first.body).toHaveLength(8192);
    expect(first).toMatchObject({
      bodyBytes: 20_000,
      offset: 0,
      nextOffset: 8192,
      truncated: true,
    });

    const second = await call("agent_doc_get", {
      projectId: "p1",
      slug: "report",
      offset: first.nextOffset,
    });
    expect(second).toMatchObject({
      offset: 8192,
      nextOffset: 16_384,
      truncated: true,
    });

    const third = await call("agent_doc_get", {
      projectId: "p1",
      slug: "report",
      offset: second.nextOffset,
    });
    expect(third.body).toHaveLength(20_000 - 16_384);
    expect(third).toMatchObject({ nextOffset: null, truncated: false });

    const past = await call("agent_doc_get", {
      projectId: "p1",
      slug: "report",
      offset: 99_999,
    });
    expect(past).toMatchObject({
      body: "",
      offset: 20_000,
      nextOffset: null,
      truncated: false,
    });
  });

  it("never splits a multi-byte character at either edge of the window", async () => {
    // 3 bytes each; 8192 is not a multiple of 3, so the cut falls mid-character.
    const body = "가".repeat(4000);
    apiFetch.mockImplementation(async () =>
      Response.json(documentDetail(body)),
    );

    const first = await call("agent_doc_get", {
      projectId: "p1",
      slug: "report",
    });
    expect(first.nextOffset).toBe(8190);
    expect(first.body).toBe("가".repeat(2730));
    expect(first.body).not.toContain("\uFFFD");

    // A caller-supplied offset inside a character is moved to its end.
    const inside = await call("agent_doc_get", {
      projectId: "p1",
      slug: "report",
      offset: 1,
    });
    expect(inside.offset).toBe(3);
    expect(inside.body.startsWith("가")).toBe(true);
    expect(inside.body).not.toContain("\uFFFD");
  });

  it("surfaces an HTTP failure as a tool error", async () => {
    apiFetch.mockImplementation(
      async () => new Response("Document not found", { status: 404 }),
    );
    const result = await callRaw("agent_doc_get", {
      projectId: "p1",
      slug: "nope",
    });
    expect(result.isError).toBe(true);
    expect(JSON.parse(result.content[0].text)).toEqual({
      error: "404 Document not found",
    });
  });
});

describe("agent_doc_put", () => {
  it("writes through the in-process path as the session user and echoes meta only", async () => {
    direct.putDocumentAsAgent.mockResolvedValue({
      ...documentDetail("body"),
      taskId: "t1",
    });

    const result = await call("agent_doc_put", {
      projectId: "p1",
      slug: "report",
      title: "Report",
      body: "body",
      taskId: "t1",
      ...identity,
      sessionId: "s1",
    });

    expect(direct.putDocumentAsAgent).toHaveBeenCalledWith({
      userId: "user-1",
      projectId: "p1",
      slug: "report",
      title: "Report",
      body: "body",
      taskId: "t1",
      provider: "anthropic",
      model: "claude-opus-5",
      sessionId: "s1",
    });
    expect(result).toEqual({
      id: "doc-1",
      slug: "report",
      title: "Report",
      taskId: "t1",
      actorId: "actor-1",
      updatedAt: "2026-01-02T00:00:00.000Z",
    });
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it("validates slug, title and the 200KB byte budget before touching the API", async () => {
    const base = { projectId: "p1", title: "T", body: "b", ...identity };
    for (const bad of [
      { ...base, slug: "Bad_Slug" },
      { ...base, slug: "report", title: "" },
      { ...base, slug: "report", body: "x".repeat(200 * 1024 + 1) },
      { ...base, slug: "report", body: "가".repeat(70 * 1024) },
      { projectId: "p1", slug: "report", title: "T", body: "b" },
    ]) {
      const result = await callRaw("agent_doc_put", bad);
      expect(result.isError, JSON.stringify(bad).slice(0, 80)).toBe(true);
    }
    expect(direct.putDocumentAsAgent).not.toHaveBeenCalled();

    direct.putDocumentAsAgent.mockResolvedValue(documentDetail("x"));
    const atLimit = await callRaw("agent_doc_put", {
      ...base,
      slug: "report",
      body: "x".repeat(200 * 1024),
    });
    expect(atLimit.isError).toBeUndefined();
  });

  it("relays a rejection from the write path", async () => {
    direct.putDocumentAsAgent.mockRejectedValue(
      new Error("403 Insufficient permissions"),
    );
    const result = await callRaw("agent_doc_put", {
      projectId: "p1",
      slug: "report",
      title: "T",
      body: "b",
      ...identity,
    });
    expect(result.isError).toBe(true);
    expect(JSON.parse(result.content[0].text)).toEqual({
      error: "403 Insufficient permissions",
    });
  });
});

describe("agent_artifact_put_text", () => {
  const record = {
    id: "art-1",
    projectId: "p1",
    taskId: null,
    name: "report.html",
    contentType: "text/html",
    size: 11,
    uploadedBy: null,
    actorId: "actor-1",
    createdAt: "2026-01-01T00:00:00.000Z",
  };

  it("hands the text to the in-process writer and returns the record", async () => {
    direct.putTextArtifactAsAgent.mockResolvedValue(record);

    const result = await call("agent_artifact_put_text", {
      projectId: "p1",
      name: "report.html",
      contentType: "text/html",
      text: "<p>hi</p>\n",
      ...identity,
    });

    expect(direct.putTextArtifactAsAgent).toHaveBeenCalledWith({
      userId: "user-1",
      projectId: "p1",
      name: "report.html",
      contentType: "text/html",
      text: "<p>hi</p>\n",
      provider: "anthropic",
      model: "claude-opus-5",
    });
    expect(result).toEqual(record);
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it("accepts only the four text types, a safe name and <=200KB", async () => {
    const base = { projectId: "p1", name: "a.html", text: "x", ...identity };
    for (const bad of [
      { ...base, contentType: "application/pdf" },
      { ...base, contentType: "application/zip" },
      { ...base, contentType: "text/html; charset=utf-8" },
      { ...base, contentType: "text/html", name: "../a.html" },
      { ...base, contentType: "text/html", name: "   " },
      { ...base, contentType: "text/html", text: "x".repeat(200 * 1024 + 1) },
    ]) {
      const result = await callRaw("agent_artifact_put_text", bad);
      expect(result.isError, JSON.stringify(bad).slice(0, 80)).toBe(true);
    }
    expect(direct.putTextArtifactAsAgent).not.toHaveBeenCalled();
  });
});

describe("agent_artifact_presign", () => {
  it("returns the presign result with a curl recipe for the upload", async () => {
    direct.presignArtifactAsAgent.mockResolvedValue({
      artifactId: "art-1",
      uploadUrl: "https://storage.example.test/kaneo/k?X-Amz-Signature=abc&x=1",
      storageKey: "agent-artifacts/ws/p1/art-1/bundle.zip",
      expiresAt: "2026-01-01T00:05:00.000Z",
      headers: { "Content-Type": "application/zip" },
    });

    const result = await call("agent_artifact_presign", {
      projectId: "p1",
      name: "bundle.zip",
      contentType: "application/zip",
      size: 1234,
      taskId: "t1",
      ...identity,
    });

    expect(direct.presignArtifactAsAgent).toHaveBeenCalledWith({
      userId: "user-1",
      projectId: "p1",
      name: "bundle.zip",
      contentType: "application/zip",
      size: 1234,
      taskId: "t1",
      provider: "anthropic",
      model: "claude-opus-5",
    });
    expect(result).toMatchObject({
      artifactId: "art-1",
      storageKey: "agent-artifacts/ws/p1/art-1/bundle.zip",
      headers: { "Content-Type": "application/zip" },
    });
    expect(result.howTo).toBe(
      "curl -sS -f -T <file> -H 'Content-Type: application/zip' 'https://storage.example.test/kaneo/k?X-Amz-Signature=abc&x=1' then agent_artifact_finalize({projectId, artifactId, storageKey}) before expiresAt",
    );
  });

  it("rejects disallowed types and sizes outside 1..10MiB", async () => {
    const base = { projectId: "p1", name: "a.bin", ...identity };
    for (const bad of [
      { ...base, contentType: "image/png", size: 1 },
      { ...base, contentType: "application/pdf", size: 0 },
      { ...base, contentType: "application/pdf", size: 10 * 1024 * 1024 + 1 },
      { ...base, contentType: "application/pdf", size: 1.5 },
    ]) {
      const result = await callRaw("agent_artifact_presign", bad);
      expect(result.isError, JSON.stringify(bad)).toBe(true);
    }
    expect(direct.presignArtifactAsAgent).not.toHaveBeenCalled();
  });
});

describe("agent_artifact_finalize", () => {
  it("posts to the HTTP finalize route with the caller's bearer", async () => {
    apiFetch.mockImplementation(async () =>
      Response.json({ id: "art-1", actorId: "actor-1" }),
    );

    const result = await call("agent_artifact_finalize", {
      projectId: "p 1",
      artifactId: "art-1",
      storageKey: "agent-artifacts/ws/p1/art-1/bundle.zip",
    });

    expect(lastRequest()).toEqual({
      url: "http://api.test/api/agent-artifact/p%201/finalize",
      method: "POST",
      body: {
        artifactId: "art-1",
        storageKey: "agent-artifacts/ws/p1/art-1/bundle.zip",
      },
      auth: "Bearer test-token",
    });
    expect(result).toEqual({ id: "art-1", actorId: "actor-1" });
  });

  it("relays a 400 from finalize as a tool error", async () => {
    apiFetch.mockImplementation(
      async () =>
        new Response("Uploaded file does not match the finalize request.", {
          status: 400,
        }),
    );
    const result = await callRaw("agent_artifact_finalize", {
      projectId: "p1",
      artifactId: "art-1",
      storageKey: "k",
    });
    expect(result.isError).toBe(true);
    expect(JSON.parse(result.content[0].text).error).toBe(
      "400 Uploaded file does not match the finalize request.",
    );
  });
});
