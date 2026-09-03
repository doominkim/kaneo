import { actorResponseSchema } from "../agent-entry/actor-response";
import { nullableResponseTimestamp, responseTimestamp, z } from "../openapi";

/**
 * Who wrote a leaf. Carried on the tree itself rather than looked up per leaf:
 * the overview is one call by design, and "which model produced this" is the
 * question the tree exists to answer.
 */
const leafActorSchema = actorResponseSchema.nullable().openapi({
  description:
    "The agent that produced this leaf; null when a person did. `model` is the model id as the harness reported it and is shown verbatim.",
});

const branchSchema = z
  .object({
    repo: z.string().optional(),
    branch: z.string(),
  })
  .openapi("AgentTreeBranch");

const documentLeafSchema = z
  .object({
    id: z.string(),
    slug: z.string(),
    title: z.string(),
    actorId: z.string().nullable(),
    actor: leafActorSchema,
    updatedBy: z.string().nullable(),
    updatedAt: responseTimestamp,
  })
  .openapi("AgentTreeDocument");

/**
 * Deliberately no `url`: artifacts are served through short-lived URLs fetched
 * per click (`GET /api/agent-artifact/{projectId}/{id}/url`), so a tree
 * response never carries anything that could be replayed later.
 */
const attachmentLeafSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    contentType: z.string(),
    size: z.number().int(),
    actorId: z.string().nullable(),
    actor: leafActorSchema,
    uploadedBy: z.string().nullable().openapi({
      description:
        "User id of the human uploader, or null for an agent upload. Present so a human-uploaded file is not rendered as an anonymous agent one.",
    }),
    createdAt: responseTimestamp,
  })
  .openapi("AgentTreeAttachment");

const usageSchema = z
  .object({
    entryCount: z.number().int().openapi({
      description:
        "Ledger entries on this task, human and agent alike. Only agent entries can carry tokens, so this is the one figure a human entry moves.",
    }),
    inputTokens: z.number().int(),
    outputTokens: z.number().int(),
    totalTokens: z.number().int(),
    byModel: z.record(z.string(), z.number().int()).openapi({
      description:
        "Total tokens per actor model. Agent entries whose actor was deleted are keyed `unknown`; human entries never appear here (they carry no usage).",
    }),
  })
  .openapi("AgentTreeUsage");

type LeafActor = z.infer<typeof actorResponseSchema> | null;

export type TreeNode = {
  id: string;
  number: number | null;
  title: string;
  status: string;
  done: boolean;
  createdAt: Date;
  updatedAt: Date;
  branches: Array<{ repo?: string; branch: string }>;
  documents: Array<{
    id: string;
    slug: string;
    title: string;
    actorId: string | null;
    actor: LeafActor;
    updatedBy: string | null;
    updatedAt: Date;
  }>;
  attachments: Array<{
    id: string;
    name: string;
    contentType: string;
    size: number;
    actorId: string | null;
    actor: LeafActor;
    uploadedBy: string | null;
    createdAt: Date;
  }>;
  usage: {
    entryCount: number;
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    byModel: Record<string, number>;
  };
  children: TreeNode[];
};

/**
 * Recursive by `z.lazy`; the `.openapi("AgentTreeNode")` registration is what
 * lets the generator emit a `$ref` instead of recursing forever.
 */
export const treeNodeSchema: z.ZodType<TreeNode> = z
  .lazy(() =>
    z.object({
      id: z.string(),
      number: z.number().int().nullable(),
      title: z.string(),
      status: z.string(),
      done: z.boolean().openapi({
        description:
          "True when the task sits in a column marked isFinal, or its status is done/archived.",
      }),
      createdAt: responseTimestamp,
      updatedAt: responseTimestamp,
      branches: z.array(branchSchema).openapi({
        description:
          "Distinct (repo, branch) pairs from this task's ledger entries, newest first. Derived — not stored on the task.",
      }),
      documents: z.array(documentLeafSchema),
      attachments: z.array(attachmentLeafSchema).openapi({
        description:
          "Finalized artifacts (html/zip/pdf/md) linked to the task, newest first. Mint a URL per click via `GET /api/agent-artifact/{projectId}/{id}/url`.",
      }),
      usage: usageSchema.openapi({
        description: "Summed over this task's own entries, not its subtree.",
      }),
      children: z.array(treeNodeSchema),
    }),
  )
  .openapi("AgentTreeNode");

const thresholdSchema = z
  .object({
    activeTaskThreshold: z.number().int(),
    openTotal: z.number().int().openapi({
      description: "Tasks in the project that are not done, at any depth.",
    }),
    exceeded: z.boolean().openapi({
      description: "openTotal > activeTaskThreshold — show the §6.1 banner.",
    }),
  })
  .openapi("AgentTreeThreshold");

export const treeSchema = z
  .object({
    nodes: z.array(treeNodeSchema),
    threshold: thresholdSchema.openapi({
      description:
        "Active-task limit from the project's settings (default 20 when unset) against the live open count. Carried on the tree so the overview needs one call.",
    }),
  })
  .openapi("AgentProjectTree");

export const settingsSchema = z
  .object({
    projectId: z.string(),
    corePaths: z.array(z.string()),
    activeTaskThreshold: z.number().int(),
    doneArchiveDays: z.number().int(),
    domainIds: z.array(z.string()).openapi({
      description: "Ids of the linked domain pages, in title order.",
    }),
    domains: z
      .array(z.object({ id: z.string(), slug: z.string(), title: z.string() }))
      .openapi({
        description:
          "The same links with slug and title, so a settings form and a booting agent can show them without a second call.",
      }),
    configured: z.boolean().openapi({
      description:
        "False when no settings row exists yet and the values shown are the defaults.",
    }),
    updatedBy: z.string().nullable(),
    updatedAt: nullableResponseTimestamp,
  })
  .openapi("AgentProjectSettings");
