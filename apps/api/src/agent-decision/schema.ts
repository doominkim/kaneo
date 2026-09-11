import { refsBody } from "../agent-entry/schema";
import { z } from "../openapi";

export const DECISION_TITLE_MAX = 200;
export const DECISION_TEXT_BUDGET = 200 * 1024;
export const DECISION_TASK_LIMIT = 50;

export const decisionStatus = z.enum(["draft", "accepted", "superseded"]);

export const projectIdParam = z.object({ projectId: z.string() });
export const decisionParams = projectIdParam.extend({ decisionId: z.string() });
export const promotionParams = projectIdParam.extend({ entryId: z.string() });

const taskIds = z
  .array(z.string().min(1))
  .max(DECISION_TASK_LIMIT)
  .refine((ids) => new Set(ids).size === ids.length, {
    message: "taskIds must not contain duplicates",
  });

const text = z.string();

function totalTextBytes(value: {
  context?: string;
  decision?: string;
  alternatives?: string | null;
  consequences?: string | null;
}) {
  return Buffer.byteLength(
    [
      value.context ?? "",
      value.decision ?? "",
      value.alternatives ?? "",
      value.consequences ?? "",
    ].join(""),
    "utf8",
  );
}

function withinTextBudget(value: Parameters<typeof totalTextBytes>[0]) {
  return totalTextBytes(value) <= DECISION_TEXT_BUDGET;
}

const agentIdentity = {
  provider: z.string().min(1).optional(),
  model: z.string().min(1).optional(),
};

function validateAgentIdentity(
  value: { provider?: string; model?: string },
  ctx: z.RefinementCtx,
) {
  if ((value.provider != null) !== (value.model != null)) {
    ctx.addIssue({
      code: "custom",
      path: [value.provider != null ? "model" : "provider"],
      message: "provider and model must be given together",
    });
  }
}

export const createDecisionBody = z
  .object({
    projectId: z.string(),
    title: z.string().trim().min(1).max(DECISION_TITLE_MAX),
    context: text,
    decision: text,
    alternatives: text.nullable().optional(),
    consequences: text.nullable().optional(),
    reversible: z.boolean().nullable().optional(),
    refs: refsBody.nullable().optional(),
    taskIds: taskIds.default([]),
    ...agentIdentity,
  })
  .superRefine((value, ctx) => {
    validateAgentIdentity(value, ctx);
    if (!value.context.trim() || !value.decision.trim()) {
      ctx.addIssue({
        code: "custom",
        path: [!value.context.trim() ? "context" : "decision"],
        message: "context and decision must not be blank",
      });
    }
    if (!withinTextBudget(value)) {
      ctx.addIssue({
        code: "custom",
        path: ["context"],
        message: "ADR text must be at most 200KB in total",
      });
    }
  });

export const updateDecisionBody = z
  .object({
    expectedUpdatedAt: z.iso.datetime(),
    title: z.string().trim().min(1).max(DECISION_TITLE_MAX).optional(),
    context: text.optional(),
    decision: text.optional(),
    alternatives: text.nullable().optional(),
    consequences: text.nullable().optional(),
    reversible: z.boolean().nullable().optional(),
    refs: refsBody.nullable().optional(),
    taskIds: taskIds.optional(),
    ...agentIdentity,
  })
  .superRefine((value, ctx) => {
    validateAgentIdentity(value, ctx);
    const mutableKeys = [
      "title",
      "context",
      "decision",
      "alternatives",
      "consequences",
      "reversible",
      "refs",
      "taskIds",
    ] as const;
    if (!mutableKeys.some((key) => value[key] !== undefined)) {
      ctx.addIssue({
        code: "custom",
        path: [],
        message: "At least one editable field is required",
      });
    }
    if (value.context !== undefined && !value.context.trim()) {
      ctx.addIssue({
        code: "custom",
        path: ["context"],
        message: "context must not be blank",
      });
    }
    if (value.decision !== undefined && !value.decision.trim()) {
      ctx.addIssue({
        code: "custom",
        path: ["decision"],
        message: "decision must not be blank",
      });
    }
    if (!withinTextBudget(value)) {
      ctx.addIssue({
        code: "custom",
        path: ["context"],
        message: "ADR text must be at most 200KB in total",
      });
    }
  });

export const acceptDecisionBody = z.object({
  expectedUpdatedAt: z.iso.datetime(),
  supersedesDecisionId: z.string().min(1).optional(),
});

export const listDecisionsQuery = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(20),
  before: z.string().optional().openapi({
    description: "Opaque cursor: the nextBefore value from the previous page.",
  }),
  status: z
    .enum(["current", "all", "draft", "accepted", "superseded"])
    .default("current"),
  taskId: z.string().optional(),
  q: z.string().trim().min(1).max(200).optional(),
});
