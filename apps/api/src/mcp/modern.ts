import { createMcpHandler, McpServer } from "@modelcontextprotocol/server";
import { registerAgentTools } from "./agent-tools";
import { registerMcpTools, toMcpToolRegistrar } from "./tools";
import { withSanitizedWhoami } from "./whoami";

/**
 * Create a stateless MCP 2026 handler with a fresh server per request.
 *
 * `userId` is the owner of `token` as resolved by the caller's bearer check;
 * the agent tools that write in-process (agent-direct) act as that user.
 */
export function createModernMcpHandler(
  token: string,
  apiUrl: string,
  userId: string,
) {
  return createMcpHandler(
    () => {
      const server = new McpServer({
        name: "kaneo-mcp",
        version: "1.0.0",
      });
      const registrar = toMcpToolRegistrar(server);
      registerMcpTools(withSanitizedWhoami(registrar), apiUrl, token);
      // Agent Layer tools (fork) — registered alongside, tools.ts untouched.
      registerAgentTools(registrar, apiUrl, token, userId);
      return server;
    },
    { legacy: "reject" },
  );
}
