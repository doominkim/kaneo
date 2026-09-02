import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
  registerAgentTools(registrar, "http://api.test", "test-token");
  return tools;
}

const tools = collectTools();

async function call(name: string, args: unknown = {}) {
  const tool = tools.get(name);
  if (!tool) throw new Error(`Tool ${name} is not registered`);
  const result = await tool(args);
  return JSON.parse(result.content[0].text);
}

let apiFetch: ReturnType<typeof vi.fn>;

beforeEach(() => {
  apiFetch = vi.fn(async () => Response.json({}));
  vi.stubGlobal("fetch", apiFetch);
});

afterEach(() => {
  vi.unstubAllGlobals();
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
