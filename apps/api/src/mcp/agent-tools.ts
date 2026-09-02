import { z } from "zod";
import type { McpToolRegistrar } from "./tools";

/**
 * Agent Layer MCP tools — fork only.
 *
 * These live beside the upstream catalogue rather than inside it; `tools.ts` is
 * not modified. The difference is not which endpoints are exposed but what
 * comes back:
 *
 * Upstream wraps `run(() => client.json(path))` and returns the API response
 * verbatim. Measured on a 20-task project that is 18.5KB (~6,200 tokens) for a
 * single `list_tasks`, because every task's full description rides along. Here
 * every tool passes through a shaping function, so the response size is a
 * property of the tool rather than of the data.
 */

type McpToolResult = {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
};

function ok(data: unknown): McpToolResult {
  return { content: [{ type: "text", text: JSON.stringify(data) }] };
}

function fail(message: string): McpToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify({ error: message }) }],
    isError: true,
  };
}

class Api {
  constructor(
    private readonly baseUrl: string,
    private readonly token: string,
  ) {}

  async json<T = unknown>(path: string, init?: RequestInit): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.token}`,
        ...(init?.headers ?? {}),
      },
    });
    if (!res.ok) {
      throw new Error(`${res.status} ${await res.text()}`);
    }
    return (await res.json()) as T;
  }
}

async function guard(fn: () => Promise<unknown>): Promise<McpToolResult> {
  try {
    return ok(await fn());
  } catch (e) {
    return fail(e instanceof Error ? e.message : String(e));
  }
}

/* -------------------------------------------------------------------------- */
/* Shaping — the actual response budget                                        */
/* -------------------------------------------------------------------------- */

type BoardTask = {
  id: string;
  number?: number;
  title: string;
  priority?: string;
};
type BoardColumn = { slug?: string; name?: string; tasks?: BoardTask[] };
type BoardResponse = {
  data?: { columns?: BoardColumn[]; name?: string };
};

const BRIEF_TASK_CAP = 20;

/**
 * Flattens the board to id/number/title/status and drops everything else.
 *
 * `description` is the reason upstream's listing is expensive, and a booting
 * session does not need it — it needs to know what exists and can ask for one
 * task's detail afterwards.
 */
function shapeBoard(board: BoardResponse) {
  const columns = board.data?.columns ?? [];
  const open: Array<{ id: string; n?: number; title: string; status: string }> =
    [];
  let done = 0;

  for (const col of columns) {
    const status = col.slug ?? col.name ?? "unknown";
    for (const t of col.tasks ?? []) {
      if (status === "done" || status === "archived") {
        done += 1;
        continue;
      }
      open.push({ id: t.id, n: t.number, title: t.title, status });
    }
  }

  return {
    open: open.slice(0, BRIEF_TASK_CAP),
    openTotal: open.length,
    doneCount: done,
    truncated: open.length > BRIEF_TASK_CAP,
  };
}

/* -------------------------------------------------------------------------- */

export function registerAgentTools(
  server: McpToolRegistrar,
  baseUrl: string,
  token: string,
): void {
  const api = new Api(baseUrl, token);
  const reg = <S extends z.ZodObject>(
    name: string,
    config: { description: string; inputSchema: S },
    cb: (args: z.output<S>) => Promise<McpToolResult>,
  ) =>
    server.registerTool(name, config, async (args) => {
      const parsed = config.inputSchema.safeParse(args);
      if (!parsed.success) {
        return fail(parsed.error.issues.map((i) => i.message).join("; "));
      }
      return cb(parsed.data);
    });

  reg(
    "agent_brief",
    {
      description:
        "Boot a session on a project in ONE call: open tasks (title/status only), recent ledger entries, and live claims. Replaces the list_workspaces -> list_projects -> list_tasks -> ... sequence.",
      inputSchema: z.object({
        projectId: z.string(),
        entries: z.number().int().min(1).max(20).default(5),
      }),
    },
    (args) =>
      guard(async () => {
        // Fetched in parallel, then shaped. The cost the caller pays is the
        // shaped size, not the sum of the three responses.
        const [board, log, leases] = await Promise.all([
          api
            .json<BoardResponse>(
              `/api/task/tasks/${encodeURIComponent(args.projectId)}`,
            )
            .catch(() => ({}) as BoardResponse),
          api
            .json<{ entries?: unknown[] }>(
              `/api/agent-entry/${encodeURIComponent(args.projectId)}?limit=${args.entries}`,
            )
            .catch(() => ({ entries: [] })),
          api
            .json<{ leases?: unknown[] }>(
              `/api/agent-lease/${encodeURIComponent(args.projectId)}`,
            )
            .catch(() => ({ leases: [] })),
        ]);

        return {
          project: board.data?.name ?? args.projectId,
          tasks: shapeBoard(board),
          recentEntries: log.entries ?? [],
          liveClaims: leases.leases ?? [],
        };
      }),
  );

  reg(
    "agent_log_append",
    {
      description:
        "Append one ledger entry. Use this instead of a task comment — comments are the human surface and an agent writing there is what makes a task page unreadable. Record `decision.why` and `decision.rejected`: code keeps only what was chosen.",
      inputSchema: z.object({
        projectId: z.string(),
        taskId: z.string().nullable().optional(),
        kind: z
          .enum(["work", "investigation", "decision", "handoff"])
          .default("work"),
        summary: z.string().max(200),
        body: z.string().nullable().optional(),
        decision: z
          .object({
            what: z.string(),
            why: z.string(),
            rejected: z.string().nullable().optional(),
            reversible: z.boolean().optional(),
          })
          .nullable()
          .optional(),
        refs: z
          .object({
            commits: z.array(z.string()).optional(),
            prs: z.array(z.string()).optional(),
            files: z.array(z.string()).optional(),
          })
          .nullable()
          .optional(),
        coreChanged: z.array(z.string()).nullable().optional(),
        provider: z.string(),
        model: z.string(),
        sessionId: z.string().nullable().optional(),
      }),
    },
    (args) =>
      guard(() =>
        api.json("/api/agent-entry", {
          method: "POST",
          body: JSON.stringify(args),
        }),
      ),
  );

  reg(
    "agent_log_tail",
    {
      description:
        "Recent ledger entries, newest first. Summaries only — call agent_entry_get for a specific entry's body and decision. To page, pass the previous result's nextBefore as `before`.",
      inputSchema: z.object({
        projectId: z.string(),
        limit: z.number().int().min(1).max(50).default(10),
        before: z
          .string()
          .optional()
          .describe("Opaque cursor: nextBefore from the previous page"),
        taskId: z.string().optional(),
        kind: z
          .enum(["work", "investigation", "decision", "handoff"])
          .optional(),
      }),
    },
    (args) =>
      guard(() => {
        const q = new URLSearchParams({ limit: String(args.limit) });
        if (args.before) q.set("before", args.before);
        if (args.taskId) q.set("taskId", args.taskId);
        if (args.kind) q.set("kind", args.kind);
        return api.json(
          `/api/agent-entry/${encodeURIComponent(args.projectId)}?${q}`,
        );
      }),
  );

  reg(
    "agent_entry_get",
    {
      description:
        "One ledger entry in full, including body and decision. Deliberately one at a time — this is where the expensive fields live.",
      inputSchema: z.object({ projectId: z.string(), entryId: z.string() }),
    },
    (args) =>
      guard(() =>
        api.json(
          `/api/agent-entry/${encodeURIComponent(args.projectId)}/${encodeURIComponent(args.entryId)}`,
        ),
      ),
  );

  reg(
    "agent_term_resolve",
    {
      description:
        "Resolve a term to its canonical name, aliases, DB/code anchors, and what it must NOT be confused with. Deterministic: same input, same answer, no inference. Ask this BEFORE searching the codebase for an unfamiliar word.",
      inputSchema: z.object({ workspaceId: z.string(), term: z.string() }),
    },
    (args) =>
      guard(() =>
        api.json(
          `/api/agent-term/${encodeURIComponent(args.workspaceId)}/resolve?term=${encodeURIComponent(args.term)}`,
        ),
      ),
  );

  reg(
    "agent_term_propose",
    {
      description:
        "Propose a term for the lexicon. It is stored as `proposed` and a human must confirm it — never assume a proposal is authoritative.",
      inputSchema: z.object({
        workspaceId: z.string(),
        canonical: z.string(),
        definition: z.string().nullable().optional(),
        aliases: z.array(z.string()).default([]),
        notToConfuseWith: z.array(z.string()).default([]),
        anchors: z
          .array(
            z.object({
              kind: z.enum(["db", "code", "doc"]),
              table: z.string().optional(),
              column: z.string().optional(),
              repo: z.string().optional(),
              path: z.string().optional(),
              symbol: z.string().optional(),
              url: z.string().optional(),
            }),
          )
          .default([]),
        sourceEntryId: z.string().nullable().optional(),
      }),
    },
    (args) =>
      guard(() =>
        api.json("/api/agent-term", {
          method: "POST",
          body: JSON.stringify(args),
        }),
      ),
  );

  reg(
    "agent_lease_acquire",
    {
      description:
        "Claim a task before working on it. Returns acquired=false with the current holder when another live session has it — do not proceed in that case.",
      inputSchema: z.object({
        taskId: z.string(),
        provider: z.string(),
        model: z.string(),
        sessionId: z.string(),
        ttlMinutes: z.number().int().min(1).max(480).default(60),
      }),
    },
    (args) =>
      guard(() =>
        api.json("/api/agent-lease/acquire", {
          method: "POST",
          body: JSON.stringify(args),
        }),
      ),
  );

  reg(
    "agent_lease_release",
    {
      description:
        "Release your claim when done. Only the holding session may release.",
      inputSchema: z.object({ taskId: z.string(), sessionId: z.string() }),
    },
    (args) =>
      guard(() =>
        api.json("/api/agent-lease/release", {
          method: "POST",
          body: JSON.stringify(args),
        }),
      ),
  );
}
