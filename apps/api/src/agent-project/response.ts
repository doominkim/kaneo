import { responseTimestamp, z } from "../openapi";

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
    createdAt: responseTimestamp,
  })
  .openapi("AgentTreeAttachment");

const usageSchema = z
  .object({
    entryCount: z.number().int(),
    inputTokens: z.number().int(),
    outputTokens: z.number().int(),
    totalTokens: z.number().int(),
    byModel: z.record(z.string(), z.number().int()).openapi({
      description:
        "Total tokens per actor model. Entries without an actor are keyed `unknown`.",
    }),
  })
  .openapi("AgentTreeUsage");

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
    updatedBy: string | null;
    updatedAt: Date;
  }>;
  attachments: Array<{
    id: string;
    name: string;
    contentType: string;
    size: number;
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

export const treeSchema = z
  .object({ nodes: z.array(treeNodeSchema) })
  .openapi("AgentProjectTree");
