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

const refsBody = z
  .object({
    commits: z.array(z.string()).optional(),
    prs: z.array(z.string()).optional(),
    files: z.array(z.string()).optional(),
  })
  .openapi({
    description:
      "References into git. Never copies — the content already lives there and a copy rots.",
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
  coreChanged: z.array(z.string()).nullable().optional().openapi({
    description: "Changed paths that matched the project's core_paths config.",
  }),
  provider: z.string().openapi({ description: "anthropic | openai | ..." }),
  model: z.string().openapi({ description: "claude-opus-5 | gpt-5.6 | ..." }),
  sessionId: z.string().nullable().optional(),
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
