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
  DECISION_TASK_LIMIT,
  DECISION_TEXT_BUDGET,
  DECISION_TITLE_MAX,
} from "../agent-decision/schema";
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
import { FEATURE_PATTERN, KEY_PATTERN } from "../agent-requirement/keys";
import {
  MAX_ITEM_TEXT_LENGTH,
  MAX_REQUIREMENT_BODY_BYTES,
} from "../agent-requirement/schema";
import {
  createDecisionAsAgent,
  presignArtifactAsAgent,
  putDesignAsAgent,
  putDocumentAsAgent,
  putDomainAsAgent,
  putRequirementCoverageAsAgent,
  putRequirementSetAsAgent,
  putTaskLinksAsAgent,
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

type FeatureSummaryOut = {
  feature: string;
  requirements: { status: string } | null;
  design: { status: string; stale: boolean } | null;
  tasks: { total: number; done: number; stale: number };
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
  terms: Array<{ canonical: string; confidence: string }>;
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
 *
 * Terms are filtered to the confirmed ones, matching what agent_term_resolve
 * will answer with: a disputed term never resolves, so the page must not
 * advertise it either. `linksTotal.terms` counts what is actually shown, so it
 * never advertises entries the caller cannot reach.
 */
function shapeDomainPage(page: DomainPage, offset: number) {
  const cap = <T>(items: T[]) => items.slice(0, DOMAIN_LINK_CAP);
  const terms = page.terms.filter((t) => t.confidence === "confirmed");
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
    terms: cap(terms).map((t) => t.canonical),
    projects: cap(page.projects).map((p) => ({ id: p.id, name: p.name })),
    documents: cap(page.documents).map((d) => ({
      projectId: d.projectId,
      slug: d.slug,
      title: d.title,
    })),
    linksTotal: {
      children: page.children.length,
      terms: terms.length,
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

/** Same limits as the HTTP `refsBody`; shared by the ledger and ADR writes. */
const refsInput = z
  .object({
    repo: z.string().max(200).optional(),
    branch: z.string().max(200).optional(),
    commits: z.array(z.string().max(64)).max(100).optional(),
    prs: z.array(z.string().max(200)).max(50).optional(),
    files: z.array(z.string().max(300)).max(200).optional(),
  })
  .nullable()
  .optional();

type DecisionAuthorOut = {
  createdAuthor: { userId: string; name: string } | null;
  createdActor: { model: string } | null;
};
type DecisionSummaryOut = DecisionAuthorOut & {
  id: string;
  number: number;
  title: string;
  status: string;
  contextPreview: string;
  reversible: boolean | null;
  reviewed: boolean;
  tasks: Array<{ id: string; number: number | null }>;
  createdAt: string;
};
type DecisionListOut = {
  decisions: DecisionSummaryOut[];
  nextBefore: string | null;
  unreviewedTotal: number;
  acceptedTotal: number;
};
type DecisionDetailOut = Omit<DecisionSummaryOut, "contextPreview"> & {
  context: string;
  decision: string;
  alternatives: string | null;
  consequences: string | null;
  refs: unknown;
  supersedes: { number: number } | null;
  supersededBy: { number: number } | null;
};

/** A person's name, or the model that wrote it. */
const decisionAuthor = (d: DecisionAuthorOut) =>
  d.createdAuthor?.name ?? d.createdActor?.model ?? null;

/**
 * Both project-wide totals ride on every list response, so one row is enough:
 * accepted = accepted, non-deleted ADRs; unreviewed = unreviewed, non-deleted.
 */
async function countDecisions(api: Api, projectId: string) {
  const list = await api.json<DecisionListOut>(
    `/api/agent-decision/${encodeURIComponent(projectId)}?limit=1`,
  );
  return { accepted: list.acceptedTotal, unreviewed: list.unreviewedTotal };
}

/** `status=all` still hides deleted ADRs, so a deleted ADR's number is not found. */
async function findDecisionIdByNumber(
  api: Api,
  projectId: string,
  number: number,
) {
  const q = new URLSearchParams({
    number: String(number),
    status: "all",
    limit: "1",
  });
  const { decisions } = await api.json<DecisionListOut>(
    `/api/agent-decision/${encodeURIComponent(projectId)}?${q}`,
  );
  const hit = decisions[0];
  if (!hit) throw new Error(`404 ADR ${number} not found`);
  return hit.id;
}

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
        "Boot a session on a project in ONE call: open tasks (title/status only), recent ledger entries (deleted ones hidden), live claims, the 20 most recently updated document titles (slug/title/updatedAt — deliverables, not a knowledge base; judge them by author and age; documentsTotal shows what was cut), and the project's linked domain pages (`domains`, read them with agent_domain_get), `features` (requirement/design status, task progress, stale count per feature), and `decisions` ({accepted, unreviewed} ADR counts; list them with agent_decision_list). Replaces the list_workspaces -> list_projects -> list_tasks -> ... sequence.",
      inputSchema: z.object({
        projectId: z.string(),
        entries: z.number().int().min(1).max(20).default(5),
      }),
    },
    (args) =>
      guard(async () => {
        // Fetched in parallel, then shaped. The cost the caller pays is the
        // shaped size, not the sum of the three responses.
        const [board, log, leases, docs, settings, features, decisions] =
          await Promise.all([
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
            api
              .json<{ features?: FeatureSummaryOut[] }>(
                `/api/agent-feature/${encodeURIComponent(args.projectId)}`,
              )
              .catch(() => ({ features: [] })),
            countDecisions(api, args.projectId).catch(() => null),
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
          // What is being built and how far along (REQ-FEATURE-HUB-17); the
          // documents themselves are one agent_requirements_get away.
          features: (features.features ?? []).map((f) => ({
            feature: f.feature,
            requirements: f.requirements?.status ?? null,
            design: f.design
              ? f.design.stale
                ? "stale"
                : f.design.status
              : null,
            tasks: `${f.tasks.done}/${f.tasks.total}`,
            staleTasks: f.tasks.stale,
          })),
          // Counts only (agent-autoapply); null when the listing failed, so a
          // failure never reads as "nothing unreviewed".
          decisions,
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
        refs: refsInput,
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
        "Resolve a term to its canonical name, aliases, DB/code anchors, and what it must NOT be confused with. Deterministic: same input, same answer, no inference. Ask this BEFORE searching the codebase for an unfamiliar word. Terms apply as soon as anyone writes them, agents included; each carries `reviewed` (false = no human has checked it yet, so weigh it). Deleted terms never come back; a miss means unknown, so read the code rather than guess. `projectId` narrows to that project's domain pages plus unfiled terms.",
      inputSchema: z.object({
        workspaceId: z.string(),
        term: z.string(),
        projectId: z.string().optional(),
      }),
    },
    (args) =>
      guard(() => {
        const q = new URLSearchParams({ term: args.term });
        if (args.projectId) q.set("projectId", args.projectId);
        return api.json(
          `/api/agent-term/${encodeURIComponent(args.workspaceId)}/resolve?${q}`,
        );
      }),
  );

  reg(
    "agent_term_propose",
    {
      description:
        "Add a term to the lexicon as this agent. Applies immediately: agent_term_resolve returns it at once with `reviewed: false` until a human reviews it, and humans may delete it. A name that already exists, even deleted, fails with 409. `sourceEntryId` is the ledger entry the definition came out of; append one with agent_log_append first. A reviewer weighs a term by its author.",
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
        sourceEntryId: z.string(),
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

  /* ---------------------------------------------------------------------- */
  /* Spec tabs (KAN-19) — requirements / design / task links / coverage      */
  /* ---------------------------------------------------------------------- */

  type RequirementItemOut = {
    key: string;
    seq: number;
    text: string;
    layer: string | null;
    status: string;
    updatedAt: string;
    coverage: Array<{ repo: string; testPath: string }>;
    designs: Array<{ feature: string }>;
    tasks: Array<{ id: string; number: number | null }>;
  };
  type RequirementSetOut = {
    id: string;
    feature: string;
    title: string;
    body: string;
    status: string;
    approvedAt: string | null;
    sourceSlug: string | null;
    updatedAt: string;
    items: RequirementItemOut[];
  };
  const shapeRequirementSet = (set: RequirementSetOut, offset: number) => ({
    id: set.id,
    feature: set.feature,
    title: set.title,
    status: set.status,
    approvedAt: set.approvedAt,
    sourceSlug: set.sourceSlug,
    updatedAt: set.updatedAt,
    items: set.items.map((item) => ({
      key: item.key,
      text: item.text,
      layer: item.layer,
      status: item.status,
      updatedAt: item.updatedAt,
      covered: item.coverage.length > 0,
      designs: item.designs.map((d) => d.feature),
      tasks: item.tasks.map((t) => t.number ?? t.id),
    })),
    ...sliceBody(set.body, offset),
  });

  reg(
    "agent_requirements_get",
    {
      description:
        "Requirement set for `feature`: items (key, text, status, covered, designs, tasks) plus a body slice. Omit `feature` to list sets.",
      inputSchema: z.object({
        projectId: z.string(),
        feature: z.string().regex(FEATURE_PATTERN).optional(),
        offset: z.number().int().min(0).default(0),
      }),
    },
    (args) =>
      guard(async () => {
        if (!args.feature) {
          const { sets } = await api.json<{ sets: unknown[] }>(
            `/api/agent-requirement/${encodeURIComponent(args.projectId)}`,
          );
          return { sets };
        }
        const set = await api.json<RequirementSetOut>(
          `/api/agent-requirement/${encodeURIComponent(args.projectId)}/${encodeURIComponent(args.feature)}`,
        );
        return shapeRequirementSet(set, args.offset);
      }),
  );

  reg(
    "agent_requirements_put",
    {
      description:
        "Upsert the requirement set for `feature` as this agent. Applies immediately; humans review it and may delete it, and writing to a deleted set fails with 409. Send the document in `body`: `## story` headings, criteria as `n. <sentence> `unit|api|e2e` [REQ-key]`; keys are issued and written back, `~~line~~` = dropped, missing badge = 400. `items` is the legacy row mode and is ignored when the body has criteria. Text changes make dependent designs/tasks stale. Returns the keys.",
      inputSchema: z.object({
        projectId: z.string(),
        feature: z.string().regex(FEATURE_PATTERN),
        title: z.string().min(1).max(200),
        body: utf8String(MAX_REQUIREMENT_BODY_BYTES, "body").default(""),
        items: z
          .array(
            z.object({
              key: z.string().regex(KEY_PATTERN).optional(),
              text: z.string().min(1).max(MAX_ITEM_TEXT_LENGTH),
              layer: z.string().max(64).nullable().optional(),
              status: z.enum(["active", "deferred", "dropped"]).optional(),
            }),
          )
          .max(500)
          .default([]),
        sourceSlug: z.string().max(64).nullable().optional(),
        ...agentIdentity,
      }),
    },
    (args) =>
      guard(async () => {
        const set = await putRequirementSetAsAgent({ ...args, userId });
        return {
          id: set.id,
          feature: set.feature,
          status: set.status,
          updatedAt: set.updatedAt,
          items: set.items.map((item) => ({
            key: item.key,
            status: item.status,
            updatedAt: item.updatedAt,
          })),
        };
      }),
  );

  type DesignOut = {
    id: string;
    feature: string;
    title: string;
    body: string;
    status: string;
    approvedAt: string | null;
    updatedAt: string;
    stale: { stale: boolean; causes: unknown[] };
    requirements: Array<{
      key: string;
      status: string;
      changedSinceRevision: boolean;
    }>;
    tasks: Array<{ id: string; number: number | null }>;
  };

  reg(
    "agent_design_get",
    {
      description:
        "Design for `feature`: stale verdict, covered requirement keys, derived tasks, body slice. Omit `feature` to list designs.",
      inputSchema: z.object({
        projectId: z.string(),
        feature: z.string().regex(FEATURE_PATTERN).optional(),
        offset: z.number().int().min(0).default(0),
      }),
    },
    (args) =>
      guard(async () => {
        if (!args.feature) {
          const { designs } = await api.json<{ designs: unknown[] }>(
            `/api/agent-design/${encodeURIComponent(args.projectId)}`,
          );
          return { designs };
        }
        const design = await api.json<DesignOut>(
          `/api/agent-design/${encodeURIComponent(args.projectId)}/${encodeURIComponent(args.feature)}`,
        );
        return {
          id: design.id,
          feature: design.feature,
          title: design.title,
          status: design.status,
          approvedAt: design.approvedAt,
          updatedAt: design.updatedAt,
          stale: design.stale,
          requirements: design.requirements,
          tasks: design.tasks.map((t) => t.number ?? t.id),
          ...sliceBody(design.body, args.offset),
        };
      }),
  );

  reg(
    "agent_design_put",
    {
      description:
        "Upsert the design for `feature` as this agent. Applies immediately; humans review it and may delete it, and writing to a deleted design fails with 409. `requirementKeys` replaces the covered items; unknown keys fail.",
      inputSchema: z.object({
        projectId: z.string(),
        feature: z.string().regex(FEATURE_PATTERN),
        title: z.string().min(1).max(200),
        body: utf8String(MAX_REQUIREMENT_BODY_BYTES, "body"),
        requirementKeys: z
          .array(z.string().regex(KEY_PATTERN))
          .max(500)
          .optional(),
        sourceSlug: z.string().max(64).nullable().optional(),
        ...agentIdentity,
      }),
    },
    (args) =>
      guard(async () => {
        const design = await putDesignAsAgent({ ...args, userId });
        return {
          id: design.id,
          feature: design.feature,
          status: design.status,
          updatedAt: design.updatedAt,
          requirements: design.requirements.map((r) => r.key),
        };
      }),
  );

  reg(
    "agent_task_link",
    {
      description:
        "Bind a task to the requirement keys / design features it implements (each list sent is replaced). Upstream changes then flag the task stale. `acknowledge: true` (applied after any list update) clears stale as this agent: your model is recorded on the links and the timeline, unreviewed until a human reviews it.",
      inputSchema: z.object({
        projectId: z.string(),
        taskId: z.string(),
        requirementKeys: z
          .array(z.string().regex(KEY_PATTERN))
          .max(200)
          .optional(),
        designFeatures: z
          .array(z.string().regex(FEATURE_PATTERN))
          .max(50)
          .optional(),
        acknowledge: z.boolean().optional(),
        ...agentIdentity,
      }),
    },
    (args) =>
      guard(async () => {
        const links = await putTaskLinksAsAgent({ ...args, userId });
        return {
          taskId: links.taskId,
          requirements: links.requirements.map((r) => r.key),
          designs: links.designs.map((d) => d.feature),
          stale: links.stale,
          ...(links.acknowledgedAt
            ? { acknowledgedAt: links.acknowledgedAt }
            : {}),
        };
      }),
  );

  reg(
    "agent_requirement_coverage_put",
    {
      description:
        "Report which tests cite which requirement keys for one repo (spec-check output). Replaces that repo's coverage for the feature; unknown keys fail.",
      inputSchema: z.object({
        projectId: z.string(),
        feature: z.string().regex(FEATURE_PATTERN),
        repo: z.string().min(1).max(200),
        entries: z
          .array(
            z.object({
              key: z.string().regex(KEY_PATTERN),
              testPath: z.string().min(1).max(300),
              testName: z.string().max(300).nullable().optional(),
            }),
          )
          .max(2000),
        ...agentIdentity,
      }),
    },
    (args) => guard(() => putRequirementCoverageAsAgent({ ...args, userId })),
  );

  /* ---------------------------------------------------------------------- */
  /* ADRs (agent-autoapply): accepted on write, reviewed by people           */
  /* ---------------------------------------------------------------------- */

  const nonBlank = (label: string, max?: number) =>
    (max ? z.string().max(max) : z.string()).refine((v) => v.trim() !== "", {
      message: `${label} must not be blank`,
    });

  reg(
    "agent_decision_list",
    {
      description:
        "Project ADRs (architecture decision records), newest first: accepted by default, `status: all` adds superseded; deleted ADRs never show. Rows: id, number, title, status, reviewed (false = no human has read it yet), author (person or model), task numbers, context preview. Filter by `q` (title/context/decision text) or `taskId`; page with nextBefore. Check here before writing an ADR; read one with agent_decision_get.",
      inputSchema: z.object({
        projectId: z.string(),
        status: z.enum(["accepted", "all"]).default("accepted"),
        q: z.string().min(1).max(200).optional(),
        taskId: z.string().optional(),
        limit: z.number().int().min(1).max(50).default(20),
        before: z
          .string()
          .optional()
          .describe("Opaque cursor: nextBefore from the previous page"),
      }),
    },
    (args) =>
      guard(async () => {
        const q = new URLSearchParams({
          limit: String(args.limit),
          status: args.status,
        });
        if (args.q) q.set("q", args.q);
        if (args.taskId) q.set("taskId", args.taskId);
        if (args.before) q.set("before", args.before);
        const list = await api.json<DecisionListOut>(
          `/api/agent-decision/${encodeURIComponent(args.projectId)}?${q}`,
        );
        return {
          decisions: list.decisions.map((d) => ({
            id: d.id,
            number: d.number,
            title: d.title,
            status: d.status,
            reviewed: d.reviewed,
            author: decisionAuthor(d),
            tasks: d.tasks.map((t) => t.number ?? t.id),
            contextPreview: d.contextPreview,
          })),
          nextBefore: list.nextBefore,
          unreviewedTotal: list.unreviewedTotal,
        };
      }),
  );

  reg(
    "agent_decision_get",
    {
      description:
        "One ADR by `decisionId` or `number`: context, decision, alternatives, consequences, reversible, refs, taskIds, `supersedes`/`supersededBy` (ADR numbers), author (person name or model) and reviewed. A deleted ADR is not found.",
      inputSchema: z
        .object({
          projectId: z.string(),
          decisionId: z.string().optional(),
          number: z.number().int().min(1).optional(),
        })
        .refine((v) => Boolean(v.decisionId) !== (v.number !== undefined), {
          message: "Pass exactly one of decisionId or number",
        }),
    },
    (args) =>
      guard(async () => {
        const decisionId =
          args.decisionId ||
          (await findDecisionIdByNumber(api, args.projectId, args.number ?? 0));
        const d = await api.json<DecisionDetailOut>(
          `/api/agent-decision/${encodeURIComponent(args.projectId)}/${encodeURIComponent(decisionId)}`,
        );
        return {
          id: d.id,
          number: d.number,
          title: d.title,
          status: d.status,
          reviewed: d.reviewed,
          author: decisionAuthor(d),
          context: d.context,
          decision: d.decision,
          alternatives: d.alternatives,
          consequences: d.consequences,
          reversible: d.reversible,
          refs: d.refs,
          taskIds: d.tasks.map((t) => t.id),
          supersedes: d.supersedes?.number ?? null,
          supersededBy: d.supersededBy?.number ?? null,
          createdAt: d.createdAt,
        };
      }),
  );

  reg(
    "agent_decision_put",
    {
      description:
        "Record an ADR as this agent. Applies immediately as `accepted` (no draft), unreviewed until a human reads it; humans may delete it. ADRs are immutable: to change one, write a new ADR with `supersedesDecisionId` (the old one becomes superseded in the same step; unknown id = 404, already superseded or deleted = 409). Check agent_decision_list first to avoid duplicates.",
      inputSchema: z
        .object({
          projectId: z.string(),
          title: nonBlank("title", DECISION_TITLE_MAX),
          context: nonBlank("context"),
          decision: nonBlank("decision"),
          alternatives: z.string().nullable().optional(),
          consequences: z.string().nullable().optional(),
          reversible: z.boolean().nullable().optional(),
          refs: refsInput,
          taskIds: z
            .array(z.string().min(1))
            .max(DECISION_TASK_LIMIT)
            .refine((ids) => new Set(ids).size === ids.length, {
              message: "taskIds must not contain duplicates",
            })
            .default([]),
          supersedesDecisionId: z.string().min(1).optional(),
          ...agentIdentity,
        })
        .refine(
          (v) =>
            Buffer.byteLength(
              `${v.context}${v.decision}${v.alternatives ?? ""}${v.consequences ?? ""}`,
              "utf8",
            ) <= DECISION_TEXT_BUDGET,
          { message: "ADR text must be at most 200KB in total" },
        ),
    },
    (args) =>
      guard(async () => {
        const d = await createDecisionAsAgent({ ...args, userId });
        // Meta only: the caller just sent the text.
        return {
          id: d.id,
          number: d.number,
          title: d.title,
          status: d.status,
          reviewed: d.reviewed,
          supersedes: d.supersedes?.number ?? null,
          taskIds: d.tasks.map((t) => t.id),
          createdAt: d.createdAt,
        };
      }),
  );
}
