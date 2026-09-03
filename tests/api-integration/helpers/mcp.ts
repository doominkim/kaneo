import { expect } from "vitest";
import type { createApp } from "../../../apps/api/src/index";

const protocolVersion = "2026-07-28";

type ToolResult = {
  content: Array<{ type: string; text: string }>;
  isError?: boolean;
};

/**
 * One stateless (2026 protocol) `tools/call` through the real `/api/mcp`
 * route, so the bearer check, the user id plumbing into the handler and the
 * tool itself all run. Auth is whatever `mockAuthenticatedSession` set.
 */
export async function mcpToolCall(
  app: ReturnType<typeof createApp>["app"],
  name: string,
  args: Record<string, unknown>,
): Promise<ToolResult> {
  const response = await app.request("/api/mcp", {
    method: "POST",
    headers: {
      accept: "application/json, text/event-stream",
      authorization: "Bearer mcp-test-token",
      "content-type": "application/json",
      "mcp-method": "tools/call",
      "mcp-name": name,
      "mcp-protocol-version": protocolVersion,
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: {
        name,
        arguments: args,
        _meta: {
          "io.modelcontextprotocol/protocolVersion": protocolVersion,
          "io.modelcontextprotocol/clientInfo": {
            name: "kaneo-integration-test",
            version: "1.0.0",
          },
          "io.modelcontextprotocol/clientCapabilities": {},
        },
      },
    }),
  });
  expect(response.status, await response.clone().text()).toBe(200);
  const text = await response.text();
  const data = text
    .split("\n")
    .find((line) => line.startsWith("data: "))
    ?.slice(6);
  const body = JSON.parse(data ?? text) as {
    result?: ToolResult;
    error?: { message: string };
  };
  if (!body.result) {
    throw new Error(`MCP error: ${JSON.stringify(body.error)}`);
  }
  return body.result;
}

/** Parses the JSON text payload of a tool result. */
export function toolJson<T = Record<string, unknown>>(result: ToolResult): T {
  return JSON.parse(result.content[0]?.text ?? "null") as T;
}
