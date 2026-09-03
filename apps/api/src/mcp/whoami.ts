import type { McpToolRegistrar } from "./tools";

/**
 * `whoami` guard — fork only.
 *
 * Upstream's `whoami` (tools.ts) returns `/api/auth/get-session` verbatim,
 * which includes `session.token`: the very bearer credential the MCP client is
 * already holding, plus IP/user-agent and every user column. An MCP client
 * (and anything that logs its tool output) must never see that. Both MCP
 * servers throw on a duplicate tool name, so the tool is not re-registered;
 * instead the registrar handed to `registerMcpTools` is wrapped and the
 * `whoami` callback is replaced with one that projects the response onto an
 * explicit allowlist. Anything that is not on the list is dropped, and a
 * payload that cannot be projected is turned into an error rather than
 * passed through.
 */

export type SafeWhoami = {
  user: {
    id: string;
    name: string | null;
    email: string | null;
    role: string | null;
  };
  session: { id: string | null; expiresAt: string | null } | null;
};

type McpToolResult = {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function optionalString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function optionalIso(value: unknown): string | null {
  if (value instanceof Date) return value.toISOString();
  return typeof value === "string" ? value : null;
}

export function sanitizeWhoami(payload: unknown): SafeWhoami | null {
  if (!isRecord(payload) || !isRecord(payload.user)) return null;
  const { user } = payload;
  if (typeof user.id !== "string" || user.id.length === 0) return null;

  const session = isRecord(payload.session) ? payload.session : null;

  return {
    user: {
      id: user.id,
      name: optionalString(user.name),
      email: optionalString(user.email),
      role: optionalString(user.role),
    },
    session: session
      ? {
          id: optionalString(session.id),
          expiresAt: optionalIso(session.expiresAt),
        }
      : null,
  };
}

function errorResult(message: string): McpToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify({ error: message }) }],
    isError: true,
  };
}

function sanitizeWhoamiResult(result: McpToolResult): McpToolResult {
  if (result.isError) return result;

  let parsed: unknown;
  try {
    parsed = JSON.parse(result.content[0]?.text ?? "");
  } catch {
    return errorResult("whoami: unexpected session payload");
  }

  const safe = sanitizeWhoami(parsed);
  if (!safe) return errorResult("whoami: no active session");
  return { content: [{ type: "text", text: JSON.stringify(safe, null, 2) }] };
}

export function withSanitizedWhoami(
  registrar: McpToolRegistrar,
): McpToolRegistrar {
  return {
    registerTool: (name, config, callback) =>
      registrar.registerTool(
        name,
        name === "whoami"
          ? {
              ...config,
              description:
                "Return the signed-in user (id, name, email, role) and the session id and expiry. The session token is never returned.",
            }
          : config,
        name === "whoami"
          ? async (args) => sanitizeWhoamiResult(await callback(args))
          : callback,
      ),
  };
}
