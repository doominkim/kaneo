import { createMcpHandler, McpServer } from "@modelcontextprotocol/server";
import { registerAgentTools } from "./agent-tools";
import { registerMcpTools, toMcpToolRegistrar } from "./tools";

/** Create a stateless MCP 2026 handler with a fresh server per request. */
export function createModernMcpHandler(token: string, apiUrl: string) {
  return createMcpHandler(
    () => {
      const server = new McpServer({
        name: "kaneo-mcp",
        version: "1.0.0",
      });
      const registrar = toMcpToolRegistrar(server);
      registerMcpTools(registrar, apiUrl, token);
      // Agent Layer tools (fork) — registered alongside, tools.ts untouched.
      registerAgentTools(registrar, apiUrl, token);
      return server;
    },
    { legacy: "reject" },
  );
}
