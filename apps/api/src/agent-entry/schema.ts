import { z } from "../openapi";

export const projectIdParam = z.object({ projectId: z.string() });
export const entryIdParam = z.object({ entryId: z.string() });

const decisionBody = z
  .object({
    what: z.string(),
    why: z.string(),
    rejected: z.string().nullable().optional().openapi({
      description:
        "The option that was NOT taken. Code keeps only what was chosen, so this is unrecoverable once lost.",
    }),
    reversible: z.boolean().optional(),
  })
  .openapi({
    description:
      "Why this was done, and what was rejected. The reason this table exists.",
  });

export const refsBody = z
  .object({
    repo: z.string().max(200).optional().openapi({
      description: 'Repository the work happened in, e.g. "doominkim/kaneo".',
    }),
    branch: z.string().max(200).optional().openapi({
      description:
        "Branch the work happened on. A commit sha alone does not say where unmerged work lives, so record this whenever git was involved.",
    }),
    commits: z.array(z.string().max(64)).max(100).optional(),
    prs: z.array(z.string().max(200)).max(50).optional(),
    files: z.array(z.string().max(300)).max(200).optional().openapi({
      description:
        "Repo-relative paths that changed (as `git diff --name-only` prints them). The server matches them against the project's core-path patterns to fill `coreChanged`.",
    }),
  })
  .openapi({
    description:
      "References into git. Never copies — the content already lives there and a copy rots. Bounded: files ≤200×300 chars, commits ≤100×64, prs ≤50×200 — a diff wider than that belongs in a document, not a ledger row.",
  });

export const effortEnum = z.enum(["low", "medium", "high", "xhigh", "max"]);

const nonNegativeInt = z.number().int().min(0);

export const usageBody = z
  .object({
    inputTokens: nonNegativeInt.optional(),
    outputTokens: nonNegativeInt.optional(),
    totalTokens: nonNegativeInt.optional(),
    cacheReadTokens: nonNegativeInt.optional(),
  })
  .openapi({
    description:
      "Token usage for this appearance. The model does not know its own usage; the harness supplies it.",
  });

export const appendEntryBody = z.object({
  projectId: z.string(),
  taskId: z.string().nullable().optional().openapi({
    description:
      "Optional by design. Investigation and design discussion must be recordable without inventing a task first.",
  }),
  kind: z
    .enum(["work", "investigation", "decision", "handoff"])
    .default("work"),
  summary: z.string().min(1).max(200).openapi({
    description:
      "One line for the human timeline. Capped so the rendered view stays readable.",
  }),
  body: z.string().nullable().optional().openapi({
    description: "Long form, agent-facing. Never rendered on the human view.",
  }),
  decision: decisionBody.nullable().optional(),
  refs: refsBody.nullable().optional(),
  provider: z.string().openapi({ description: "anthropic | openai | ..." }),
  model: z.string().openapi({ description: "claude-opus-5 | gpt-5.6 | ..." }),
  sessionId: z.string().nullable().optional(),
  effort: effortEnum.nullable().optional().openapi({
    description:
      "Reasoning effort this appearance ran at. Same model, different effort, different cost and result.",
  }),
  agentLabel: z.string().max(64).nullable().optional().openapi({
    description: 'Harness roster name, e.g. "3setter" or "codex".',
  }),
  usage: usageBody.nullable().optional(),
});

export const listEntriesQuery = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(10).openapi({
    description:
      "Capped at 50. The ledger is unbounded; callers must page rather than pull everything.",
  }),
  before: z.string().optional().openapi({
    description:
      "Opaque cursor: the `nextBefore` value from the previous page. Returns the entries older than that one; an unknown cursor is a 400.",
  }),
  taskId: z.string().optional(),
  kind: z.enum(["work", "investigation", "decision", "handoff"]).optional(),
});
