import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The in-process write path talks to the database; the tools are tested
// against its contract, the path itself is covered by integration tests.
const direct = vi.hoisted(() => ({
  putDocumentAsAgent: vi.fn(),
  putDomainAsAgent: vi.fn(),
  presignArtifactAsAgent: vi.fn(),
  putTextArtifactAsAgent: vi.fn(),
  putRequirementSetAsAgent: vi.fn(),
  putDesignAsAgent: vi.fn(),
  putTaskLinksAsAgent: vi.fn(),
  putRequirementCoverageAsAgent: vi.fn(),
  createDecisionAsAgent: vi.fn(),
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

describe("agent_log_append", () => {
  it("rejects oversized refs arrays before any request is made", async () => {
    const calls = apiFetch.mock.calls.length;
    const result = await callRaw("agent_log_append", {
      projectId: "p1",
      summary: "too many files",
      provider: "anthropic",
      model: "m",
      refs: { files: Array.from({ length: 201 }, () => "a.ts") },
    });
    expect(result.isError).toBe(true);
    expect(apiFetch.mock.calls.length).toBe(calls);
  });
});

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

function domainNodes() {
  return [
    { id: "a", parentId: null, slug: "billing", title: "Billing" },
    { id: "b", parentId: "a", slug: "refunds", title: "Refunds" },
    { id: "e", parentId: null, slug: "refunds", title: "Root refunds" },
  ];
}

function domainPage(body: string) {
  return {
    id: "b",
    workspaceId: "ws-1",
    parentId: "a",
    slug: "refunds",
    title: "Refunds",
    body,
    position: 0,
    updatedBy: "user-1",
    actorId: null,
    author: { userId: "user-1", name: "Dominic" },
    actor: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-02T00:00:00.000Z",
    ancestors: [{ id: "a", slug: "billing", title: "Billing" }],
    children: Array.from({ length: 25 }, (_, i) => ({
      id: `c${i}`,
      slug: `child-${i}`,
      title: `Child ${i}`,
    })),
    // Mixed on purpose: the page must show only what agent_term_resolve would
    // answer with, or the model reads its own unreviewed proposal off the page.
    terms: [
      {
        id: "t1",
        canonical: "Refund",
        confidence: "confirmed",
        state: "active",
      },
      {
        id: "t2",
        canonical: "Chargeback",
        confidence: "proposed",
        state: "active",
      },
      {
        id: "t3",
        canonical: "Clawback",
        confidence: "disputed",
        state: "active",
      },
    ],
    projects: [{ id: "p1", name: "Billing v2", slug: "billing-v2" }],
    documents: [
      {
        id: "d1",
        projectId: "p1",
        slug: "refund-flow",
        title: "Refund flow",
        updatedAt: "2026-01-02T00:00:00.000Z",
      },
    ],
  };
}

describe("agent_brief domains", () => {
  it("lists the project's linked domain pages, id and title only, capped at 10", async () => {
    apiFetch.mockImplementation(async (input: RequestInfo | URL) => {
      if (String(input).endsWith("/api/agent-project/p1")) {
        return Response.json({
          projectId: "p1",
          domainIds: [],
          domains: Array.from({ length: 12 }, (_, i) => ({
            id: `dom-${i}`,
            slug: `dom-${i}`,
            title: `Domain ${i}`,
          })),
        });
      }
      return Response.json({});
    });

    const brief = await call("agent_brief", { projectId: "p1" });

    expect(brief.domains).toHaveLength(10);
    expect(brief.domains[0]).toEqual({ id: "dom-0", title: "Domain 0" });
  });

  it("degrades to an empty list when settings cannot be read", async () => {
    apiFetch.mockImplementation(async (input: RequestInfo | URL) => {
      if (String(input).includes("/api/agent-project/")) {
        return new Response("boom", { status: 500 });
      }
      return Response.json({});
    });
    const brief = await call("agent_brief", { projectId: "p1" });
    expect(brief.domains).toEqual([]);
  });
});

describe("agent_domain_list", () => {
  it("returns id/parentId/slug/title only and caps at 200", async () => {
    const many = Array.from({ length: 205 }, (_, i) => ({
      id: `d${i}`,
      parentId: null,
      slug: `d${i}`,
      title: `D${i}`,
      position: i,
      updatedAt: "2026-01-01T00:00:00.000Z",
      childCount: 0,
    }));
    apiFetch.mockImplementation(async () => Response.json({ domains: many }));

    const result = await call("agent_domain_list", { workspaceId: "ws 1" });

    expect(lastRequest()).toMatchObject({
      url: "http://api.test/api/agent-domain/ws%201",
      method: "GET",
      auth: "Bearer test-token",
    });
    expect(result.domains).toHaveLength(200);
    expect(result.domains[0]).toEqual({
      id: "d0",
      parentId: null,
      slug: "d0",
      title: "D0",
    });
    expect(result).toMatchObject({ domainsTotal: 205, truncated: true });
  });
});

describe("agent_domain_get", () => {
  it("resolves a slugPath against the tree, then fetches the page by id", async () => {
    apiFetch.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/api/agent-domain/ws-1")) {
        return Response.json({ domains: domainNodes() });
      }
      if (url.endsWith("/api/agent-domain/ws-1/b")) {
        return Response.json(domainPage("# Refunds\n"));
      }
      return new Response("Domain not found", { status: 404 });
    });

    const page = await call("agent_domain_get", {
      workspaceId: "ws-1",
      slugPath: "billing/refunds",
    });

    expect(apiFetch).toHaveBeenCalledTimes(2);
    expect(page).toEqual({
      id: "b",
      parentId: "a",
      slug: "refunds",
      path: "billing/refunds",
      title: "Refunds",
      author: "Dominic",
      actor: null,
      updatedAt: "2026-01-02T00:00:00.000Z",
      body: "# Refunds\n",
      bodyBytes: 10,
      offset: 0,
      nextOffset: null,
      truncated: false,
      children: Array.from({ length: 20 }, (_, i) => ({
        id: `c${i}`,
        slug: `child-${i}`,
        title: `Child ${i}`,
      })),
      terms: ["Refund"],
      projects: [{ id: "p1", name: "Billing v2" }],
      documents: [
        { projectId: "p1", slug: "refund-flow", title: "Refund flow" },
      ],
      linksTotal: { children: 25, terms: 1, projects: 1, documents: 1 },
    });
    expect(page).not.toHaveProperty("workspaceId");
    expect(page).not.toHaveProperty("ancestors");
  });

  it("shows only confirmed terms and counts the total after that filter", async () => {
    apiFetch.mockImplementation(async () =>
      Response.json(domainPage("# Refunds\n")),
    );

    const page = await call("agent_domain_get", {
      workspaceId: "ws-1",
      domainId: "b",
    });

    // "Chargeback" is proposed and "Clawback" is disputed; neither resolves, so
    // neither is listed here either.
    expect(page.terms).toEqual(["Refund"]);
    // The total counts what is reachable, not what is filed: advertising 3
    // would send the caller looking for two terms resolve refuses to answer.
    expect(page.linksTotal.terms).toBe(1);
  });

  it("caps the confirmed terms at 20 and totals them, ignoring the unreviewed ones", async () => {
    apiFetch.mockImplementation(async () =>
      Response.json({
        ...domainPage("body"),
        terms: [
          ...Array.from({ length: 25 }, (_, i) => ({
            id: `ok-${i}`,
            canonical: `Confirmed ${String(i).padStart(2, "0")}`,
            confidence: "confirmed",
            state: "active",
          })),
          ...Array.from({ length: 5 }, (_, i) => ({
            id: `no-${i}`,
            canonical: `Proposed ${i}`,
            confidence: "proposed",
            state: "active",
          })),
        ],
      }),
    );

    const page = await call("agent_domain_get", {
      workspaceId: "ws-1",
      domainId: "b",
    });

    expect(page.terms).toHaveLength(20);
    expect(page.terms[0]).toBe("Confirmed 00");
    expect(page.terms).not.toContain("Proposed 0");
    expect(page.linksTotal.terms).toBe(25);
  });

  it("fetches by domainId directly and windows the body at 8KB", async () => {
    apiFetch.mockImplementation(async () =>
      Response.json(domainPage("x".repeat(10_000))),
    );

    const page = await call("agent_domain_get", {
      workspaceId: "ws-1",
      domainId: "b",
      offset: 0,
    });

    expect(apiFetch).toHaveBeenCalledTimes(1);
    expect(lastRequest().url).toBe("http://api.test/api/agent-domain/ws-1/b");
    expect(page).toMatchObject({
      bodyBytes: 10_000,
      nextOffset: 8192,
      truncated: true,
    });
  });

  it("rejects neither/both selectors, an invalid slugPath, and an unresolved one", async () => {
    apiFetch.mockImplementation(async () =>
      Response.json({ domains: domainNodes() }),
    );

    for (const bad of [
      { workspaceId: "ws-1" },
      { workspaceId: "ws-1", domainId: "b", slugPath: "billing" },
    ]) {
      const result = await callRaw("agent_domain_get", bad);
      expect(result.isError, JSON.stringify(bad)).toBe(true);
    }
    expect(apiFetch).not.toHaveBeenCalled();

    const invalid = await callRaw("agent_domain_get", {
      workspaceId: "ws-1",
      slugPath: "Billing/Refunds",
    });
    expect(JSON.parse(invalid.content[0].text)).toEqual({
      error: "400 Invalid slugPath",
    });
    expect(apiFetch).not.toHaveBeenCalled();

    const missing = await callRaw("agent_domain_get", {
      workspaceId: "ws-1",
      slugPath: "refunds/partial",
    });
    expect(missing.isError).toBe(true);
    expect(JSON.parse(missing.content[0].text)).toEqual({
      error: "404 No page at refunds/partial",
    });
  });
});

describe("agent_domain_put", () => {
  const saved = {
    ...domainPage("body"),
    actorId: "actor-1",
    updatedBy: null,
  };

  it("creates through the in-process path as the session user and echoes meta only", async () => {
    direct.putDomainAsAgent.mockResolvedValue(saved);

    const result = await call("agent_domain_put", {
      workspaceId: "ws-1",
      parentId: "a",
      slug: "refunds",
      title: "Refunds",
      body: "body",
      ...identity,
    });

    expect(direct.putDomainAsAgent).toHaveBeenCalledWith({
      userId: "user-1",
      workspaceId: "ws-1",
      parentId: "a",
      slug: "refunds",
      title: "Refunds",
      body: "body",
      provider: "anthropic",
      model: "claude-opus-5",
    });
    expect(result).toEqual({
      id: "b",
      parentId: "a",
      slug: "refunds",
      title: "Refunds",
      actorId: "actor-1",
      updatedAt: "2026-01-02T00:00:00.000Z",
    });
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it("updates when domainId is given, without requiring a slug", async () => {
    direct.putDomainAsAgent.mockResolvedValue(saved);
    const result = await callRaw("agent_domain_put", {
      workspaceId: "ws-1",
      domainId: "b",
      title: "Refunds",
      body: "new body",
      ...identity,
    });
    expect(result.isError).toBeUndefined();
    expect(direct.putDomainAsAgent).toHaveBeenCalledWith(
      expect.objectContaining({ domainId: "b", body: "new body" }),
    );
  });

  it("validates slug presence on create, slug shape, title and the 200KB budget", async () => {
    const base = { workspaceId: "ws-1", title: "T", body: "b", ...identity };
    for (const bad of [
      { ...base },
      { ...base, slug: "Bad_Slug" },
      { ...base, slug: "ok", title: "" },
      { ...base, slug: "ok", body: "x".repeat(200 * 1024 + 1) },
      { workspaceId: "ws-1", slug: "ok", title: "T", body: "b" },
    ]) {
      const result = await callRaw("agent_domain_put", bad);
      expect(result.isError, JSON.stringify(bad).slice(0, 80)).toBe(true);
    }
    expect(direct.putDomainAsAgent).not.toHaveBeenCalled();
  });

  it("relays a rejection from the write path", async () => {
    direct.putDomainAsAgent.mockRejectedValue(
      new Error('409 A page with slug "refunds" already exists at this level'),
    );
    const result = await callRaw("agent_domain_put", {
      workspaceId: "ws-1",
      slug: "refunds",
      title: "T",
      body: "b",
      ...identity,
    });
    expect(result.isError).toBe(true);
    expect(JSON.parse(result.content[0].text).error).toContain("409");
  });
});

describe("agent_doc_put / agent_term_propose domainId", () => {
  it("passes domainId through to the document write path", async () => {
    direct.putDocumentAsAgent.mockResolvedValue(documentDetail("b"));
    await call("agent_doc_put", {
      projectId: "p1",
      slug: "report",
      title: "T",
      body: "b",
      domainId: "dom-1",
      ...identity,
    });
    expect(direct.putDocumentAsAgent).toHaveBeenCalledWith(
      expect.objectContaining({ domainId: "dom-1" }),
    );
  });

  it("posts domainId with the term proposal", async () => {
    await call("agent_term_propose", {
      workspaceId: "ws-1",
      canonical: "Refund",
      domainId: "dom-1",
      sourceEntryId: "entry-1",
      ...identity,
    });
    expect(lastRequest()).toMatchObject({
      url: "http://api.test/api/agent-term",
      method: "POST",
      body: expect.objectContaining({ domainId: "dom-1", canonical: "Refund" }),
    });
  });

  /**
   * The tool always sends provider/model, so every proposal it makes is an
   * agent proposal and the API refuses one with no ledger citation. Declaring
   * `sourceEntryId` optional made the tool contradict the endpoint it calls:
   * the caller was told the field could be left out and then got a 400 back.
   */
  it("refuses a term proposal with no sourceEntryId before it reaches the API", async () => {
    const result = await callRaw("agent_term_propose", {
      workspaceId: "ws-1",
      canonical: "Refund",
      ...identity,
    });
    expect(result.isError).toBe(true);
    expect(apiFetch).not.toHaveBeenCalled();
  });
});

describe("agent_term_resolve", () => {
  it("puts projectId on the query when given and omits it otherwise", async () => {
    await call("agent_term_resolve", { workspaceId: "ws-1", term: "Refund" });
    expect(lastRequest().url).toBe(
      "http://api.test/api/agent-term/ws-1/resolve?term=Refund",
    );

    await call("agent_term_resolve", {
      workspaceId: "ws-1",
      term: "Refund",
      projectId: "p1",
    });
    expect(lastRequest().url).toBe(
      "http://api.test/api/agent-term/ws-1/resolve?term=Refund&projectId=p1",
    );
  });

  it("encodes a term with reserved characters rather than splitting the query", async () => {
    await call("agent_term_resolve", {
      workspaceId: "ws/1",
      term: "a&b c",
      projectId: "p 1",
    });
    expect(lastRequest().url).toBe(
      "http://api.test/api/agent-term/ws%2F1/resolve?term=a%26b+c&projectId=p+1",
    );
  });
});

/* -------------------------------------------------------------------------- */
/* Spec tabs (KAN-19)                                                         */
/* -------------------------------------------------------------------------- */

describe("spec tab tools", () => {
  const specTools = [
    "agent_requirements_get",
    "agent_requirements_put",
    "agent_design_get",
    "agent_design_put",
    "agent_task_link",
    "agent_requirement_coverage_put",
  ];

  it("[REQ-SPEC-TABS-14] registers exactly the six spec tools and no approve tool", () => {
    for (const name of specTools) expect(tools.has(name), name).toBe(true);
    for (const name of [...tools.keys()]) {
      expect(name).not.toMatch(/approve|acknowledge/);
    }
  });

  it("[REQ-SPEC-TABS-14] agent_requirements_put writes through the agent path and echoes issued keys only", async () => {
    direct.putRequirementSetAsAgent.mockResolvedValue({
      id: "set-1",
      feature: "spec-tabs",
      status: "draft",
      updatedAt: "2026-09-13T00:00:00.000Z",
      body: "long body",
      items: [
        {
          key: "REQ-SPEC-TABS-1",
          status: "active",
          text: "x",
          updatedAt: "2026-09-13T00:00:00.000Z",
        },
      ],
    });
    const result = await call("agent_requirements_put", {
      projectId: "p1",
      feature: "spec-tabs",
      title: "Spec tabs",
      items: [{ text: "WHEN ... THE SYSTEM SHALL ..." }],
      ...identity,
    });
    expect(direct.putRequirementSetAsAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "user-1",
        projectId: "p1",
        feature: "spec-tabs",
        body: "",
        items: [{ text: "WHEN ... THE SYSTEM SHALL ..." }],
        provider: "anthropic",
        model: "claude-opus-5",
      }),
    );
    expect(result).toEqual({
      id: "set-1",
      feature: "spec-tabs",
      status: "draft",
      updatedAt: "2026-09-13T00:00:00.000Z",
      items: [
        {
          key: "REQ-SPEC-TABS-1",
          status: "active",
          updatedAt: "2026-09-13T00:00:00.000Z",
        },
      ],
    });
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it("[REQ-SPEC-TABS-16] rejects malformed keys and feature slugs before the write path", async () => {
    for (const bad of [
      { projectId: "p1", feature: "Spec Tabs", title: "T", ...identity },
      {
        projectId: "p1",
        feature: "spec-tabs",
        title: "T",
        items: [{ key: "SPEC-TABS-1", text: "x" }],
        ...identity,
      },
      { projectId: "p1", feature: "spec-tabs", title: "T" },
    ]) {
      const result = await callRaw("agent_requirements_put", bad);
      expect(result.isError, JSON.stringify(bad).slice(0, 80)).toBe(true);
    }
    expect(direct.putRequirementSetAsAgent).not.toHaveBeenCalled();
  });

  it("[REQ-SPEC-TABS-14] agent_requirements_get reads over HTTP and shapes items with a covered flag", async () => {
    apiFetch.mockResolvedValue(
      Response.json({
        id: "set-1",
        feature: "spec-tabs",
        title: "Spec tabs",
        body: "# body",
        status: "approved",
        approvedAt: "2026-09-13T00:00:00.000Z",
        sourceSlug: null,
        updatedAt: "2026-09-13T00:00:00.000Z",
        items: [
          {
            key: "REQ-SPEC-TABS-1",
            seq: 1,
            text: "x",
            layer: "api",
            status: "active",
            updatedAt: "2026-09-13T00:00:00.000Z",
            coverage: [{ repo: "r", testPath: "t.test.ts" }],
            designs: [{ feature: "spec-tabs" }],
            tasks: [{ id: "t1", number: 19 }],
          },
        ],
      }),
    );
    const result = await call("agent_requirements_get", {
      projectId: "p1",
      feature: "spec-tabs",
    });
    expect(lastRequest().url).toBe(
      "http://api.test/api/agent-requirement/p1/spec-tabs",
    );
    expect(result.items).toEqual([
      expect.objectContaining({
        key: "REQ-SPEC-TABS-1",
        covered: true,
        designs: ["spec-tabs"],
        tasks: [19],
      }),
    ]);
    expect(result.body).toBe("# body");
  });

  it("[REQ-SPEC-TABS-14] agent_design_put passes requirementKeys through and echoes covered keys", async () => {
    direct.putDesignAsAgent.mockResolvedValue({
      id: "d1",
      feature: "spec-tabs",
      status: "draft",
      updatedAt: "2026-09-13T00:00:00.000Z",
      body: "b",
      requirements: [{ key: "REQ-SPEC-TABS-1" }],
    });
    const result = await call("agent_design_put", {
      projectId: "p1",
      feature: "spec-tabs",
      title: "Design",
      body: "# design",
      requirementKeys: ["REQ-SPEC-TABS-1"],
      ...identity,
    });
    expect(direct.putDesignAsAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "user-1",
        requirementKeys: ["REQ-SPEC-TABS-1"],
      }),
    );
    expect(result).toEqual({
      id: "d1",
      feature: "spec-tabs",
      status: "draft",
      updatedAt: "2026-09-13T00:00:00.000Z",
      requirements: ["REQ-SPEC-TABS-1"],
    });
  });

  it("[REQ-SPEC-TABS-7] agent_task_link replaces links and returns keys, features and the stale verdict", async () => {
    direct.putTaskLinksAsAgent.mockResolvedValue({
      taskId: "t1",
      requirements: [{ key: "REQ-SPEC-TABS-2" }],
      designs: [{ feature: "spec-tabs" }],
      stale: { stale: false, causes: [] },
    });
    const result = await call("agent_task_link", {
      projectId: "p1",
      taskId: "t1",
      requirementKeys: ["REQ-SPEC-TABS-2"],
      designFeatures: ["spec-tabs"],
      ...identity,
    });
    expect(result).toEqual({
      taskId: "t1",
      requirements: ["REQ-SPEC-TABS-2"],
      designs: ["spec-tabs"],
      stale: { stale: false, causes: [] },
    });
  });

  it("[REQ-SPEC-TABS-17] agent_requirement_coverage_put relays the write-path result and its rejections", async () => {
    direct.putRequirementCoverageAsAgent.mockResolvedValue({
      feature: "spec-tabs",
      repo: "r",
      reported: 1,
    });
    const ok = await call("agent_requirement_coverage_put", {
      projectId: "p1",
      feature: "spec-tabs",
      repo: "r",
      entries: [{ key: "REQ-SPEC-TABS-1", testPath: "t.test.ts" }],
      ...identity,
    });
    expect(ok).toEqual({ feature: "spec-tabs", repo: "r", reported: 1 });

    direct.putRequirementCoverageAsAgent.mockRejectedValue(
      new Error("400 Unknown requirement keys: REQ-SPEC-TABS-99"),
    );
    const bad = await callRaw("agent_requirement_coverage_put", {
      projectId: "p1",
      feature: "spec-tabs",
      repo: "r",
      entries: [{ key: "REQ-SPEC-TABS-99", testPath: "t.test.ts" }],
      ...identity,
    });
    expect(bad.isError).toBe(true);
  });
});

describe("agent_brief features", () => {
  it("[REQ-FEATURE-HUB-17] boots with each feature's requirement/design status, task progress and stale count", async () => {
    apiFetch.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/agent-feature/")) {
        return Response.json({
          features: [
            {
              feature: "feature-hub",
              title: "Feature 허브",
              requirements: {
                status: "approved",
                itemCount: 26,
                activeCount: 25,
                coveredCount: 4,
              },
              design: { status: "approved", stale: true },
              tasks: { total: 8, done: 2, stale: 1 },
            },
            {
              feature: "beta",
              title: "Beta",
              requirements: null,
              design: { status: "draft", stale: false },
              tasks: { total: 0, done: 0, stale: 0 },
            },
          ],
        });
      }
      return Response.json({});
    });
    const result = await call("agent_brief", { projectId: "p1" });
    expect(result.features).toEqual([
      {
        feature: "feature-hub",
        requirements: "approved",
        design: "stale",
        tasks: "2/8",
        staleTasks: 1,
      },
      {
        feature: "beta",
        requirements: null,
        design: "draft",
        tasks: "0/0",
        staleTasks: 0,
      },
    ]);
    expect(
      apiFetch.mock.calls.some(
        (c) => String(c[0]) === "http://api.test/api/agent-feature/p1",
      ),
    ).toBe(true);
  });

  it("[REQ-FEATURE-HUB-17] degrades to an empty feature list when the endpoint fails", async () => {
    apiFetch.mockImplementation(async (input: RequestInfo | URL) =>
      String(input).includes("/api/agent-feature/")
        ? new Response("boom", { status: 500 })
        : Response.json({}),
    );
    const result = await call("agent_brief", { projectId: "p1" });
    expect(result.features).toEqual([]);
  });
});

/* -------------------------------------------------------------------------- */
/* agent-autoapply: ADR tools, agent acknowledgement, review marks            */
/* -------------------------------------------------------------------------- */

function decisionRow(number: number, overrides: Record<string, unknown> = {}) {
  return {
    id: `adr-${number}`,
    number,
    title: `ADR ${number}`,
    status: "accepted",
    contextPreview: `context ${number}`,
    reversible: true,
    sourceEntryId: null,
    supersedesDecisionId: null,
    refs: null,
    tasks: [],
    createdBy: null,
    createdAuthor: null,
    createdActor: {
      id: "actor-1",
      provider: "anthropic",
      model: "claude-opus-5",
      onBehalfOf: "user-1",
    },
    reviewed: false,
    reviewedAt: null,
    deletedAt: null,
    createdAt: "2026-09-14T00:00:00.000Z",
    updatedAt: "2026-09-14T00:00:00.000Z",
    ...overrides,
  };
}

/** Descending numbers `from` down to `to`, as the listing orders them. */
function decisionPage(
  from: number,
  to: number,
  nextBefore: string | null,
  unreviewedTotal = 0,
) {
  return {
    decisions: Array.from({ length: from - to + 1 }, (_, i) =>
      decisionRow(from - i),
    ),
    nextBefore,
    unreviewedTotal,
  };
}

function decisionDetail(overrides: Record<string, unknown> = {}) {
  const { contextPreview: _preview, ...summary } = decisionRow(3);
  return {
    ...summary,
    workspaceId: "ws-1",
    projectId: "p1",
    context: "Boards are read far more often than written.",
    decision: "Cache boards per project.",
    alternatives: "Query every time.",
    consequences: "Invalidation on every task event.",
    sourceNote: null,
    refs: { files: ["apps/api/src/board.ts"] },
    tasks: [{ id: "t1", number: 7, title: "Board cache" }],
    supersedes: { id: "adr-1", number: 1, title: "Old", status: "superseded" },
    supersededBy: null,
    ...overrides,
  };
}

describe("agent_decision_list", () => {
  it("[REQ-AGENT-AUTOAPPLY-32] lists accepted ADRs by default, 20 at a time, with number, title, reviewed and author", async () => {
    apiFetch.mockImplementation(async () =>
      Response.json({
        decisions: [
          decisionRow(2, { tasks: [{ id: "t1", number: 7, title: "x" }] }),
          decisionRow(1, {
            createdBy: "user-1",
            createdAuthor: { userId: "user-1", name: "Dominic" },
            createdActor: null,
            reviewed: true,
            tasks: [{ id: "t2", number: null, title: "y" }],
          }),
        ],
        nextBefore: null,
        unreviewedTotal: 1,
      }),
    );

    const result = await call("agent_decision_list", { projectId: "p 1" });

    expect(lastRequest()).toMatchObject({
      url: "http://api.test/api/agent-decision/p%201?limit=20&status=accepted",
      method: "GET",
      auth: "Bearer test-token",
    });
    expect(result).toEqual({
      decisions: [
        {
          id: "adr-2",
          number: 2,
          title: "ADR 2",
          status: "accepted",
          reviewed: false,
          author: "claude-opus-5",
          tasks: [7],
          contextPreview: "context 2",
        },
        {
          id: "adr-1",
          number: 1,
          title: "ADR 1",
          status: "accepted",
          reviewed: true,
          author: "Dominic",
          tasks: ["t2"],
          contextPreview: "context 1",
        },
      ],
      nextBefore: null,
      unreviewedTotal: 1,
    });
  });

  it("[REQ-AGENT-AUTOAPPLY-32] passes q, taskId, status, limit and the before cursor, and returns nextBefore", async () => {
    apiFetch.mockImplementation(async () =>
      Response.json(decisionPage(5, 4, "adr-4", 2)),
    );

    const result = await call("agent_decision_list", {
      projectId: "p1",
      q: "board cache",
      taskId: "t1",
      status: "all",
      limit: 2,
      before: "adr-6",
    });

    expect(lastRequest().url).toBe(
      "http://api.test/api/agent-decision/p1?limit=2&status=all&q=board+cache&taskId=t1&before=adr-6",
    );
    expect(result.decisions.map((d: { number: number }) => d.number)).toEqual([
      5, 4,
    ]);
    expect(result.nextBefore).toBe("adr-4");
  });

  it("[REQ-AGENT-AUTOAPPLY-32] keeps limit within 1..50 and never lists deleted ADRs, before any request", async () => {
    for (const bad of [
      { projectId: "p1", limit: 0 },
      { projectId: "p1", limit: 51 },
      { projectId: "p1", limit: 2.5 },
      { projectId: "p1", status: "deleted" },
      { projectId: "p1", q: "" },
    ]) {
      const result = await callRaw("agent_decision_list", bad);
      expect(result.isError, JSON.stringify(bad)).toBe(true);
    }
    expect(apiFetch).not.toHaveBeenCalled();
  });
});

describe("agent_decision_get", () => {
  it("[REQ-AGENT-AUTOAPPLY-33] reads one ADR by decisionId with its text, task ids, supersede numbers, author and review mark", async () => {
    apiFetch.mockImplementation(async () => Response.json(decisionDetail()));

    const result = await call("agent_decision_get", {
      projectId: "p1",
      decisionId: "adr-3",
    });

    expect(apiFetch).toHaveBeenCalledTimes(1);
    expect(lastRequest()).toMatchObject({
      url: "http://api.test/api/agent-decision/p1/adr-3",
      method: "GET",
    });
    expect(result).toEqual({
      id: "adr-3",
      number: 3,
      title: "ADR 3",
      status: "accepted",
      reviewed: false,
      author: "claude-opus-5",
      context: "Boards are read far more often than written.",
      decision: "Cache boards per project.",
      alternatives: "Query every time.",
      consequences: "Invalidation on every task event.",
      reversible: true,
      refs: { files: ["apps/api/src/board.ts"] },
      taskIds: ["t1"],
      supersedes: 1,
      supersededBy: null,
      createdAt: "2026-09-14T00:00:00.000Z",
    });

    apiFetch.mockImplementation(async () =>
      Response.json(
        decisionDetail({
          status: "superseded",
          createdAuthor: { userId: "user-1", name: "Dominic" },
          createdActor: null,
          reviewed: true,
          supersedes: null,
          supersededBy: {
            id: "adr-4",
            number: 4,
            title: "New",
            status: "accepted",
          },
        }),
      ),
    );
    const byPerson = await call("agent_decision_get", {
      projectId: "p1",
      decisionId: "adr-3",
    });
    expect(byPerson).toMatchObject({
      status: "superseded",
      author: "Dominic",
      reviewed: true,
      supersedes: null,
      supersededBy: 4,
    });
  });

  it("[REQ-AGENT-AUTOAPPLY-33] finds an ADR by number with one number-filtered list request, superseded ones included, then reads it", async () => {
    apiFetch.mockImplementation(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith("/adr-4200")) {
        return Response.json(decisionDetail({ id: "adr-4200", number: 4200 }));
      }
      return Response.json({
        decisions: [decisionRow(4200, { status: "superseded" })],
        nextBefore: "adr-4200",
        unreviewedTotal: 0,
        acceptedTotal: 0,
      });
    });

    const result = await call("agent_decision_get", {
      projectId: "p1",
      number: 4200,
    });

    // No paging and no cap: an old number costs the same as a new one.
    expect(apiFetch.mock.calls.map((c) => String(c[0]))).toEqual([
      "http://api.test/api/agent-decision/p1?number=4200&status=all&limit=1",
      "http://api.test/api/agent-decision/p1/adr-4200",
    ]);
    expect(result).toMatchObject({ id: "adr-4200", number: 4200 });
  });

  it("[REQ-AGENT-AUTOAPPLY-33] a number the filtered listing does not return, like a deleted ADR's, and a deleted id are 404s", async () => {
    apiFetch.mockImplementation(async () =>
      Response.json({
        decisions: [],
        nextBefore: null,
        unreviewedTotal: 0,
        acceptedTotal: 0,
      }),
    );
    const gap = await callRaw("agent_decision_get", {
      projectId: "p1",
      number: 8,
    });
    expect(JSON.parse(gap.content[0].text)).toEqual({
      error: "404 ADR 8 not found",
    });
    expect(apiFetch).toHaveBeenCalledTimes(1);

    apiFetch.mockImplementation(
      async () => new Response("ADR not found", { status: 404 }),
    );
    const deleted = await callRaw("agent_decision_get", {
      projectId: "p1",
      decisionId: "adr-8",
    });
    expect(JSON.parse(deleted.content[0].text)).toEqual({
      error: "404 ADR not found",
    });
  });

  it("[REQ-AGENT-AUTOAPPLY-33] requires exactly one of decisionId or number", async () => {
    for (const bad of [
      { projectId: "p1" },
      { projectId: "p1", decisionId: "adr-1", number: 1 },
      { projectId: "p1", number: 0 },
    ]) {
      const result = await callRaw("agent_decision_get", bad);
      expect(result.isError, JSON.stringify(bad)).toBe(true);
    }
    expect(apiFetch).not.toHaveBeenCalled();
  });
});

describe("agent_decision_put", () => {
  const base = {
    projectId: "p1",
    title: "Cache boards",
    context: "Boards are read far more often than written.",
    decision: "Cache boards per project.",
    ...identity,
  };

  it("[REQ-AGENT-AUTOAPPLY-34] writes an accepted ADR through the agent path as the calling model, supersede included, and echoes meta only", async () => {
    direct.createDecisionAsAgent.mockResolvedValue(
      decisionDetail({
        id: "adr-5",
        number: 5,
        title: "Cache boards",
        supersedes: {
          id: "adr-4",
          number: 4,
          title: "Old",
          status: "superseded",
        },
      }),
    );

    const result = await call("agent_decision_put", {
      ...base,
      refs: { files: ["apps/api/src/board.ts"] },
      taskIds: ["t1"],
      supersedesDecisionId: "adr-4",
      sessionId: "s1",
    });

    expect(direct.createDecisionAsAgent).toHaveBeenCalledWith({
      userId: "user-1",
      projectId: "p1",
      title: "Cache boards",
      context: "Boards are read far more often than written.",
      decision: "Cache boards per project.",
      refs: { files: ["apps/api/src/board.ts"] },
      taskIds: ["t1"],
      supersedesDecisionId: "adr-4",
      provider: "anthropic",
      model: "claude-opus-5",
      sessionId: "s1",
    });
    expect(result).toEqual({
      id: "adr-5",
      number: 5,
      title: "Cache boards",
      status: "accepted",
      reviewed: false,
      supersedes: 4,
      taskIds: ["t1"],
      createdAt: "2026-09-14T00:00:00.000Z",
    });
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it("[REQ-AGENT-AUTOAPPLY-34] requires provider/model and refuses blank text, duplicate or too many tasks and over-budget text before the write path", async () => {
    const { provider: _provider, model: _model, ...anonymous } = base;
    for (const bad of [
      anonymous,
      { ...base, provider: undefined },
      { ...base, title: "   " },
      { ...base, title: "x".repeat(201) },
      { ...base, context: "" },
      { ...base, decision: " " },
      { ...base, taskIds: ["t1", "t1"] },
      { ...base, taskIds: Array.from({ length: 51 }, (_, i) => `t${i}`) },
      { ...base, context: "x".repeat(200 * 1024), decision: "d" },
    ]) {
      const result = await callRaw("agent_decision_put", bad);
      expect(result.isError, JSON.stringify(bad).slice(0, 80)).toBe(true);
    }
    expect(direct.createDecisionAsAgent).not.toHaveBeenCalled();

    direct.createDecisionAsAgent.mockResolvedValue(decisionDetail());
    const atLimit = await callRaw("agent_decision_put", {
      ...base,
      context: "x".repeat(200 * 1024 - 1),
      decision: "d",
    });
    expect(atLimit.isError).toBeUndefined();
  });

  it("[REQ-AGENT-AUTOAPPLY-34] surfaces a missing supersede target as 404 and a superseded or deleted one as 409", async () => {
    direct.createDecisionAsAgent
      .mockRejectedValueOnce(
        new Error("404 The ADR to supersede was not found"),
      )
      .mockRejectedValueOnce(
        new Error(
          "409 Only an accepted, non-deleted ADR can be superseded, and this one no longer is",
        ),
      );
    const args = { ...base, supersedesDecisionId: "adr-4" };

    const missing = await callRaw("agent_decision_put", args);
    expect(missing.isError).toBe(true);
    expect(JSON.parse(missing.content[0].text)).toEqual({
      error: "404 The ADR to supersede was not found",
    });

    const conflict = await callRaw("agent_decision_put", args);
    expect(conflict.isError).toBe(true);
    expect(JSON.parse(conflict.content[0].text).error).toMatch(/^409 /);
  });
});

describe("agent_task_link acknowledge", () => {
  const links = {
    taskId: "t1",
    requirements: [{ key: "REQ-SPEC-TABS-1" }],
    designs: [],
    stale: { stale: false, causes: [] },
  };

  it("[REQ-AGENT-AUTOAPPLY-35] passes acknowledge and the session to the agent path and returns when it was acknowledged", async () => {
    direct.putTaskLinksAsAgent.mockResolvedValue({
      ...links,
      acknowledgedAt: "2026-09-14T01:00:00.000Z",
    });

    const result = await call("agent_task_link", {
      projectId: "p1",
      taskId: "t1",
      acknowledge: true,
      ...identity,
      sessionId: "s1",
    });

    expect(direct.putTaskLinksAsAgent).toHaveBeenCalledWith({
      userId: "user-1",
      projectId: "p1",
      taskId: "t1",
      acknowledge: true,
      provider: "anthropic",
      model: "claude-opus-5",
      sessionId: "s1",
    });
    expect(result).toEqual({
      taskId: "t1",
      requirements: ["REQ-SPEC-TABS-1"],
      designs: [],
      stale: { stale: false, causes: [] },
      acknowledgedAt: "2026-09-14T01:00:00.000Z",
    });
  });

  it("[REQ-AGENT-AUTOAPPLY-35] leaves acknowledgedAt out when the call did not acknowledge", async () => {
    direct.putTaskLinksAsAgent.mockResolvedValue({
      ...links,
      acknowledgedAt: null,
    });
    const result = await call("agent_task_link", {
      projectId: "p1",
      taskId: "t1",
      requirementKeys: ["REQ-SPEC-TABS-1"],
      ...identity,
    });
    expect(result).not.toHaveProperty("acknowledgedAt");
  });
});

describe("agent_term_resolve review marks", () => {
  it("[REQ-AGENT-AUTOAPPLY-36] relays reviewed on the match and on every ambiguous candidate", async () => {
    apiFetch.mockImplementation(async () =>
      Response.json({
        match: "alias",
        term: { id: "term-1", canonical: "Lease", reviewed: false },
        ambiguous: [
          { id: "term-1", canonical: "Lease", reviewed: false },
          { id: "term-2", canonical: "Claim", reviewed: true },
        ],
      }),
    );

    const result = await call("agent_term_resolve", {
      workspaceId: "ws-1",
      term: "hold",
    });

    expect(result.term).toMatchObject({ id: "term-1", reviewed: false });
    expect(
      result.ambiguous.map((t: { id: string; reviewed: boolean }) => [
        t.id,
        t.reviewed,
      ]),
    ).toEqual([
      ["term-1", false],
      ["term-2", true],
    ]);
  });
});

describe("agent_brief decisions", () => {
  it("[REQ-AGENT-AUTOAPPLY-37] takes accepted from acceptedTotal and unreviewed from unreviewedTotal in one list request", async () => {
    apiFetch.mockImplementation(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      if (!url.pathname.startsWith("/api/agent-decision/")) {
        return Response.json({});
      }
      return Response.json({
        decisions: [decisionRow(1500)],
        nextBefore: "adr-1500",
        unreviewedTotal: 7,
        acceptedTotal: 1234,
      });
    });

    const brief = await call("agent_brief", { projectId: "p1" });

    // Totals, not the page: no truncation however many ADRs there are.
    expect(brief.decisions).toEqual({ accepted: 1234, unreviewed: 7 });
    expect(
      apiFetch.mock.calls
        .map((c) => String(c[0]))
        .filter((url) => url.includes("/api/agent-decision/")),
    ).toEqual(["http://api.test/api/agent-decision/p1?limit=1"]);
  });

  it("[REQ-AGENT-AUTOAPPLY-37] reports zeros for a project without ADRs and null when the listing fails", async () => {
    apiFetch.mockImplementation(async (input: RequestInfo | URL) =>
      String(input).includes("/api/agent-decision/")
        ? Response.json({
            decisions: [],
            nextBefore: null,
            unreviewedTotal: 0,
            acceptedTotal: 0,
          })
        : Response.json({}),
    );
    expect((await call("agent_brief", { projectId: "p1" })).decisions).toEqual({
      accepted: 0,
      unreviewed: 0,
    });

    apiFetch.mockImplementation(async (input: RequestInfo | URL) =>
      String(input).includes("/api/agent-decision/")
        ? new Response("boom", { status: 500 })
        : Response.json({}),
    );
    expect(
      (await call("agent_brief", { projectId: "p1" })).decisions,
    ).toBeNull();
  });
});
