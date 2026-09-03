import { z } from "zod";
import {
  ALLOWED_ARTIFACT_CONTENT_TYPES,
  hasPathSeparator,
  MAX_ARTIFACT_BYTES,
  MAX_ARTIFACT_NAME_LENGTH,
  MAX_TEXT_ARTIFACT_BYTES,
  TEXT_ARTIFACT_CONTENT_TYPES,
} from "../agent-artifact/policy";
import {
  MAX_DOCUMENT_BODY_BYTES,
  SLUG_PATTERN,
} from "../agent-document/schema";
import {
  DOMAIN_SLUG_PATTERN,
  MAX_DOMAIN_BODY_BYTES,
  MAX_DOMAIN_TITLE_LENGTH,
} from "../agent-domain/schema";
import { parseSlugPath, resolveSlugPath } from "../agent-domain/slug-path";
import {
  presignArtifactAsAgent,
  putDocumentAsAgent,
  putDomainAsAgent,
  putTextArtifactAsAgent,
} from "./agent-direct";
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
type DocumentSummary = { slug: string; title: string; updatedAt: string };
type DocumentDetail = {
  id: string;
  slug: string;
  title: string;
  taskId: string | null;
  updatedBy: string | null;
  actorId: string | null;
  updatedAt: string;
  body: string;
};

type DomainNode = {
  id: string;
  parentId: string | null;
  slug: string;
  title: string;
};
type DomainPage = DomainNode & {
  body: string;
  updatedAt: string;
  author: { userId: string; name: string } | null;
  actor: { model: string } | null;
  ancestors: DomainNode[];
  children: DomainNode[];
  terms: Array<{ canonical: string }>;
  projects: Array<{ id: string; name: string }>;
  documents: Array<{ projectId: string; slug: string; title: string }>;
};
type ProjectSettings = { domains?: Array<{ id: string; title: string }> };

const BRIEF_TASK_CAP = 20;
const BRIEF_DOCUMENT_CAP = 20;
const BRIEF_DOMAIN_CAP = 10;
const DOMAIN_LIST_CAP = 200;
const DOMAIN_LINK_CAP = 20;

/**
 * The HTTP listing is uncapped and slug-ordered; a booting session instead
 * wants the freshest reports first, and a bounded number of them.
 */
function shapeDocuments(documents: DocumentSummary[]) {
  const sorted = [...documents].sort(
    (a, b) =>
      b.updatedAt.localeCompare(a.updatedAt) || a.slug.localeCompare(b.slug),
  );
  return {
    documents: sorted.slice(0, BRIEF_DOCUMENT_CAP).map((d) => ({
      slug: d.slug,
      title: d.title,
      updatedAt: d.updatedAt,
    })),
    documentsTotal: documents.length,
    documentsTruncated: documents.length > BRIEF_DOCUMENT_CAP,
  };
}

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

/**
 * The page's links as names. A booting session needs to know what is filed
 * here, not to page through it; ids come back only where the name alone
 * cannot be acted on (a document needs its project and slug to be read).
 */
function shapeDomainPage(page: DomainPage, offset: number) {
  const cap = <T>(items: T[]) => items.slice(0, DOMAIN_LINK_CAP);
  return {
    id: page.id,
    parentId: page.parentId,
    slug: page.slug,
    path: [...page.ancestors.map((a) => a.slug), page.slug].join("/"),
    title: page.title,
    author: page.author?.name ?? null,
    actor: page.actor?.model ?? null,
    updatedAt: page.updatedAt,
    ...sliceBody(page.body, offset),
    children: cap(page.children).map((c) => ({
      id: c.id,
      slug: c.slug,
      title: c.title,
    })),
    terms: cap(page.terms).map((t) => t.canonical),
    projects: cap(page.projects).map((p) => ({ id: p.id, name: p.name })),
    documents: cap(page.documents).map((d) => ({
      projectId: d.projectId,
      slug: d.slug,
      title: d.title,
    })),
    linksTotal: {
      children: page.children.length,
      terms: page.terms.length,
      projects: page.projects.length,
      documents: page.documents.length,
    },
  };
}

const DOC_GET_CHUNK_BYTES = 8 * 1024;

/**
 * A byte window over the body that never splits a UTF-8 sequence: the start
 * is moved forward and the end backward off continuation bytes (10xxxxxx).
 * `nextOffset` is therefore always a valid `offset` for the next call.
 */
function sliceBody(body: string, requestedOffset: number) {
  const bytes = Buffer.from(body, "utf8");
  const total = bytes.length;
  let start = Math.min(requestedOffset, total);
  const isContinuation = (i: number) => ((bytes[i] ?? 0) & 0xc0) === 0x80;
  while (start < total && isContinuation(start)) start += 1;
  let end = Math.min(start + DOC_GET_CHUNK_BYTES, total);
  while (end < total && end > start && isContinuation(end)) end -= 1;
  return {
    body: bytes.subarray(start, end).toString("utf8"),
    bodyBytes: total,
    offset: start,
    nextOffset: end < total ? end : null,
    truncated: end < total,
  };
}

/** Bytes, not characters — the same budget the HTTP schema enforces. */
const utf8String = (max: number, label: string) =>
  z.string().refine((value) => Buffer.byteLength(value, "utf8") <= max, {
    message: `${label} must be at most ${max / 1024}KB`,
  });

const artifactName = z
  .string()
  .min(1)
  .max(MAX_ARTIFACT_NAME_LENGTH)
  .refine((v) => v.trim().length > 0 && !hasPathSeparator(v), {
    message: "name must be non-blank and contain no path separators",
  });

/** Who the write is attributed to; identity is (workspace, user, model). */
const agentIdentity = {
  provider: z.string(),
  model: z.string(),
  sessionId: z.string().nullable().optional(),
};

/* -------------------------------------------------------------------------- */

export function registerAgentTools(
  server: McpToolRegistrar,
  baseUrl: string,
  token: string,
  userId: string,
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
        "Boot a session on a project in ONE call: open tasks (title/status only), recent ledger entries (deleted ones hidden), live claims, the 20 most recently updated document titles (slug/title/updatedAt — deliverables, not a knowledge base; judge them by author and age; documentsTotal shows what was cut), and the project's linked domain pages (`domains`, read them with agent_domain_get). Replaces the list_workspaces -> list_projects -> list_tasks -> ... sequence.",
      inputSchema: z.object({
        projectId: z.string(),
        entries: z.number().int().min(1).max(20).default(5),
      }),
    },
    (args) =>
      guard(async () => {
        // Fetched in parallel, then shaped. The cost the caller pays is the
        // shaped size, not the sum of the three responses.
        const [board, log, leases, docs, settings] = await Promise.all([
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
          api
            .json<{ documents?: DocumentSummary[] }>(
              `/api/agent-document/${encodeURIComponent(args.projectId)}`,
            )
            .catch(() => ({ documents: [] })),
          api
            .json<ProjectSettings>(
              `/api/agent-project/${encodeURIComponent(args.projectId)}`,
            )
            .catch(() => ({}) as ProjectSettings),
        ]);

        return {
          project: board.data?.name ?? args.projectId,
          tasks: shapeBoard(board),
          recentEntries: log.entries ?? [],
          liveClaims: leases.leases ?? [],
          // Titles only; bodies are up to 200KB each and go through doc_get
          // (Phase 1c). `updatedAt` is there so a stale report looks stale.
          ...shapeDocuments(docs.documents ?? []),
          // Where the project's meaning lives; titles only, the page itself
          // is one agent_domain_get away.
          domains: (settings.domains ?? [])
            .slice(0, BRIEF_DOMAIN_CAP)
            .map((d) => ({ id: d.id, title: d.title })),
        };
      }),
  );

  reg(
    "agent_log_append",
    {
      description:
        "Append one ledger entry as this agent (provider/model required here; humans post to the same stream from the UI and show up as `author`). Use this for progress, not a task comment, so the task page stays bounded. Record `decision.why` and `decision.rejected`: code keeps only what was chosen. If git was involved, set `refs.branch` (and `refs.repo`). Pass `effort`, `agentLabel` and harness-supplied `usage` so cost is attributable per appearance.",
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
            repo: z.string().max(200).optional(),
            branch: z.string().max(200).optional(),
            commits: z.array(z.string().max(64)).max(100).optional(),
            prs: z.array(z.string().max(200)).max(50).optional(),
            files: z.array(z.string().max(300)).max(200).optional(),
          })
          .nullable()
          .optional(),
        provider: z.string(),
        model: z.string(),
        sessionId: z.string().nullable().optional(),
        effort: z
          .enum(["low", "medium", "high", "xhigh", "max"])
          .nullable()
          .optional(),
        agentLabel: z.string().max(64).nullable().optional(),
        usage: z
          .object({
            inputTokens: z.number().int().min(0).optional(),
            outputTokens: z.number().int().min(0).optional(),
            totalTokens: z.number().int().min(0).optional(),
            cacheReadTokens: z.number().int().min(0).optional(),
          })
          .nullable()
          .optional(),
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
        "Recent ledger entries, newest first, human and agent interleaved (`author` = human, `actor` = agent); entries a person deleted are hidden. Summaries only — call agent_entry_get for a specific entry's body and decision. To page, pass the previous result's nextBefore as `before`.",
      inputSchema: z.object({
        projectId: z.string(),
        limit: z.number().int().min(1).max(50).default(10),
        before: z
          .string()
          .optional()
          .describe("Opaque cursor: nextBefore from the previous page"),
        taskId: z
          .string()
          .optional()
          .describe("Exact task id, or `none` for entries with no task"),
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
        "One ledger entry in full, including body and decision. Deliberately one at a time — this is where the expensive fields live. A deleted entry reads as not found.",
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
        "Propose a term for the lexicon. It is stored as `proposed` and a human must confirm it — never assume a proposal is authoritative. Pass `provider`/`model` so the proposal records which model wrote it; a reviewer weighs a proposal by its author.",
      inputSchema: z.object({
        workspaceId: z.string(),
        provider: z.string(),
        model: z.string(),
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
        domainId: z
          .string()
          .nullable()
          .optional()
          .describe("Domain page to file the term under"),
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

  reg(
    "agent_doc_get",
    {
      description:
        "One document: meta plus up to 8KB of body from byte `offset`. If `truncated`, call again with offset=nextOffset.",
      inputSchema: z.object({
        projectId: z.string(),
        slug: z.string(),
        offset: z.number().int().min(0).default(0),
      }),
    },
    (args) =>
      guard(async () => {
        const doc = await api.json<DocumentDetail>(
          `/api/agent-document/${encodeURIComponent(args.projectId)}/${encodeURIComponent(args.slug)}`,
        );
        return {
          id: doc.id,
          slug: doc.slug,
          title: doc.title,
          taskId: doc.taskId,
          updatedBy: doc.updatedBy,
          actorId: doc.actorId,
          updatedAt: doc.updatedAt,
          ...sliceBody(doc.body, args.offset),
        };
      }),
  );

  reg(
    "agent_doc_put",
    {
      description:
        "Create or replace the document at (project, slug) as this agent. The deliverable path for reports and design packets: markdown body <=200KB, full overwrite, no lease needed.",
      inputSchema: z.object({
        projectId: z.string(),
        slug: z.string().regex(SLUG_PATTERN),
        title: z.string().min(1).max(200),
        body: utf8String(MAX_DOCUMENT_BODY_BYTES, "body"),
        taskId: z.string().nullable().optional(),
        domainId: z
          .string()
          .nullable()
          .optional()
          .describe("Domain page to file it under"),
        ...agentIdentity,
      }),
    },
    (args) =>
      guard(async () => {
        const doc = await putDocumentAsAgent({ ...args, userId });
        // Not the body: the caller just sent it.
        return {
          id: doc.id,
          slug: doc.slug,
          title: doc.title,
          taskId: doc.taskId,
          actorId: doc.actorId,
          updatedAt: doc.updatedAt,
        };
      }),
  );

  reg(
    "agent_domain_list",
    {
      description:
        "The workspace's domain knowledge pages as a flat tree (id/parentId/slug/title, up to 200): where business meaning, flows and vocabulary are written down. Read a page with agent_domain_get.",
      inputSchema: z.object({ workspaceId: z.string() }),
    },
    (args) =>
      guard(async () => {
        const { domains } = await api.json<{ domains: DomainNode[] }>(
          `/api/agent-domain/${encodeURIComponent(args.workspaceId)}`,
        );
        return {
          domains: domains.slice(0, DOMAIN_LIST_CAP).map((d) => ({
            id: d.id,
            parentId: d.parentId,
            slug: d.slug,
            title: d.title,
          })),
          domainsTotal: domains.length,
          truncated: domains.length > DOMAIN_LIST_CAP,
        };
      }),
  );

  reg(
    "agent_domain_get",
    {
      description:
        "One domain page by `domainId` or `slugPath` (root-to-child slugs, e.g. `billing/refunds`): meta, up to 8KB of body from byte `offset` (call again with offset=nextOffset while `truncated`), children, and the terms, projects and documents filed under it (names, 20 each).",
      inputSchema: z
        .object({
          workspaceId: z.string(),
          domainId: z.string().optional(),
          slugPath: z.string().optional(),
          offset: z.number().int().min(0).default(0),
        })
        .refine((v) => Boolean(v.domainId) !== Boolean(v.slugPath), {
          message: "Pass exactly one of domainId or slugPath",
        }),
    },
    (args) =>
      guard(async () => {
        const ws = encodeURIComponent(args.workspaceId);
        let domainId = args.domainId;
        if (!domainId) {
          const segments = parseSlugPath(args.slugPath ?? "");
          if (!segments) throw new Error("400 Invalid slugPath");
          const { domains } = await api.json<{ domains: DomainNode[] }>(
            `/api/agent-domain/${ws}`,
          );
          const found = resolveSlugPath(domains, segments);
          if (!found) throw new Error(`404 No page at ${segments.join("/")}`);
          domainId = found.id;
        }
        const page = await api.json<DomainPage>(
          `/api/agent-domain/${ws}/${encodeURIComponent(domainId)}`,
        );
        return shapeDomainPage(page, args.offset);
      }),
  );

  reg(
    "agent_domain_put",
    {
      description:
        "Write a domain page as this agent. With `domainId`: replace its title and body (full overwrite of the markdown, so read it first and merge). Without: create a page with `slug` under `parentId` (root when omitted). Domain pages are shared workspace knowledge, not session reports — keep them about the domain.",
      inputSchema: z
        .object({
          workspaceId: z.string(),
          domainId: z.string().optional(),
          parentId: z.string().nullable().optional(),
          slug: z.string().regex(DOMAIN_SLUG_PATTERN).optional(),
          title: z.string().min(1).max(MAX_DOMAIN_TITLE_LENGTH),
          body: utf8String(MAX_DOMAIN_BODY_BYTES, "body"),
          ...agentIdentity,
        })
        .refine((v) => Boolean(v.domainId) || Boolean(v.slug), {
          message: "slug is required when creating a page (no domainId)",
        }),
    },
    (args) =>
      guard(async () => {
        const page = await putDomainAsAgent({ ...args, userId });
        // Meta only: the caller just sent the body.
        return {
          id: page.id,
          parentId: page.parentId,
          slug: page.slug,
          title: page.title,
          actorId: page.actorId,
          updatedAt: page.updatedAt,
        };
      }),
  );

  reg(
    "agent_artifact_put_text",
    {
      description:
        "Store text (<=200KB) as a finalized artifact in one call; the server uploads it. For bigger or binary files use agent_artifact_presign.",
      inputSchema: z.object({
        projectId: z.string(),
        name: artifactName,
        contentType: z.enum(TEXT_ARTIFACT_CONTENT_TYPES),
        text: utf8String(MAX_TEXT_ARTIFACT_BYTES, "text"),
        taskId: z.string().nullable().optional(),
        ...agentIdentity,
      }),
    },
    (args) => guard(() => putTextArtifactAsAgent({ ...args, userId })),
  );

  reg(
    "agent_artifact_presign",
    {
      description:
        "Start an upload (<=10MiB): returns a presigned PUT URL. Upload the bytes yourself as shown in `howTo`, then call agent_artifact_finalize. The bytes never pass through MCP.",
      inputSchema: z.object({
        projectId: z.string(),
        name: artifactName,
        contentType: z.enum(ALLOWED_ARTIFACT_CONTENT_TYPES),
        size: z
          .number()
          .int()
          .min(1)
          .max(MAX_ARTIFACT_BYTES)
          .describe("Exact byte length; verified at finalize"),
        taskId: z.string().nullable().optional(),
        ...agentIdentity,
      }),
    },
    (args) =>
      guard(async () => {
        const presigned = await presignArtifactAsAgent({ ...args, userId });
        return {
          ...presigned,
          howTo: `curl -sS -f -T <file> -H 'Content-Type: ${args.contentType}' '${presigned.uploadUrl}' then agent_artifact_finalize({projectId, artifactId, storageKey}) before expiresAt`,
        };
      }),
  );

  reg(
    "agent_artifact_finalize",
    {
      description:
        "Verify the uploaded object and make the artifact visible. Idempotent. Pass artifactId and storageKey exactly as presign returned them.",
      inputSchema: z.object({
        projectId: z.string(),
        artifactId: z.string(),
        storageKey: z.string(),
      }),
    },
    (args) =>
      guard(() =>
        api.json(
          `/api/agent-artifact/${encodeURIComponent(args.projectId)}/finalize`,
          {
            method: "POST",
            body: JSON.stringify({
              artifactId: args.artifactId,
              storageKey: args.storageKey,
            }),
          },
        ),
      ),
  );
}
