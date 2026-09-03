import { describe, expect, it, vi } from "vitest";

vi.mock("../../apps/api/src/mcp/agent-direct", () => ({
  putDocumentAsAgent: vi.fn(),
  putDomainAsAgent: vi.fn(),
  presignArtifactAsAgent: vi.fn(),
  putTextArtifactAsAgent: vi.fn(),
}));

import { createModernMcpHandler } from "../../apps/api/src/mcp/modern";

/**
 * DESIGN.md §5.2: the agent tool surface is budgeted by definition size as the
 * client sees it in `tools/list`, not by tool count. Measured through the real
 * handler so the JSON Schema conversion is included.
 *
 * Per-tool cap is 2.5KB, not the 2KB draft: `agent_log_append`'s schema alone
 * is ~1600 bytes (13 fields, three nested objects) before any description, and
 * the description is where `decision.why`/`rejected` get explained. Measured
 * 2026-09-03 after dropping the client `coreChanged` input and capping the
 * `refs` arrays: largest 2154,
 * total 9264 for 13 tools.
 */
const MAX_BYTES_PER_TOOL = 2560;
const MAX_BYTES_TOTAL = 12288;

const protocolVersion = "2026-07-28";

type ToolDefinition = {
  name: string;
  description?: string;
  inputSchema: unknown;
};

async function listTools(): Promise<ToolDefinition[]> {
  const handler = createModernMcpHandler(
    "test-token",
    "http://api.test",
    "test-user",
  );
  const response = await handler.fetch(
    new Request("http://mcp.test/mcp", {
      method: "POST",
      headers: {
        accept: "application/json, text/event-stream",
        authorization: "Bearer test-token",
        "content-type": "application/json",
        "mcp-method": "tools/list",
        "mcp-protocol-version": protocolVersion,
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/list",
        params: {
          _meta: {
            "io.modelcontextprotocol/protocolVersion": protocolVersion,
            "io.modelcontextprotocol/clientInfo": {
              name: "kaneo-budget-test",
              version: "1.0.0",
            },
            "io.modelcontextprotocol/clientCapabilities": {},
          },
        },
      }),
    }),
  );
  expect(response.status).toBe(200);
  const text = await response.text();
  const data = text
    .split("\n")
    .find((line) => line.startsWith("data: "))
    ?.slice(6);
  const body = JSON.parse(data ?? text) as {
    result: { tools: ToolDefinition[] };
  };
  return body.result.tools;
}

function definitionBytes(tool: ToolDefinition) {
  return Buffer.byteLength(
    JSON.stringify({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema,
    }),
    "utf8",
  );
}

describe("agent_* tool definition budget (tools/list)", () => {
  it("keeps every agent tool under 2560 bytes and the set under 12288 bytes", async () => {
    const tools = await listTools();
    const agentTools = tools.filter((tool) => tool.name.startsWith("agent_"));
    expect(agentTools.map((t) => t.name).sort()).toEqual([
      "agent_artifact_finalize",
      "agent_artifact_presign",
      "agent_artifact_put_text",
      "agent_brief",
      "agent_doc_get",
      "agent_doc_put",
      "agent_domain_get",
      "agent_domain_list",
      "agent_domain_put",
      "agent_entry_get",
      "agent_lease_acquire",
      "agent_lease_release",
      "agent_log_append",
      "agent_log_tail",
      "agent_term_propose",
      "agent_term_resolve",
    ]);

    const sizes = agentTools
      .map((tool) => ({ name: tool.name, bytes: definitionBytes(tool) }))
      .sort((a, b) => b.bytes - a.bytes);
    const total = sizes.reduce((sum, { bytes }) => sum + bytes, 0);
    const upstreamTotal = tools
      .filter((tool) => !tool.name.startsWith("agent_"))
      .reduce((sum, tool) => sum + definitionBytes(tool), 0);

    console.log(
      [
        "agent_* tool definition sizes (bytes, tools/list JSON):",
        ...sizes.map(({ name, bytes }) => `  ${name.padEnd(26)} ${bytes}`),
        `  ${"TOTAL".padEnd(26)} ${total} (budget ${MAX_BYTES_TOTAL})`,
        `  upstream ${tools.length - sizes.length} tools: ${upstreamTotal}`,
      ].join("\n"),
    );

    for (const { name, bytes } of sizes) {
      expect(
        bytes,
        `${name} exceeds ${MAX_BYTES_PER_TOOL} bytes`,
      ).toBeLessThanOrEqual(MAX_BYTES_PER_TOOL);
    }
    expect(total, "agent_* total exceeds budget").toBeLessThanOrEqual(
      MAX_BYTES_TOTAL,
    );
  });
});
