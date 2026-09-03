import { and, asc, desc, eq, isNotNull } from "drizzle-orm";
import type {
  EntryRefs,
  EntryUsage,
} from "../../agent-entry/controllers/entry-fields";
import db, { schema } from "../../database";
import {
  agentActorTable,
  agentArtifactTable,
  agentDocumentTable,
  agentEntryTable,
} from "../../database/schema-agent-layer";
import type { TreeNode } from "../response";
import getSettings from "./get-settings";

const UNKNOWN_MODEL = "unknown";

function emptyUsage(): TreeNode["usage"] {
  return {
    entryCount: 0,
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    byModel: {},
  };
}

function isDone(status: string, isFinal: boolean | null) {
  return isFinal === true || status === "done" || status === "archived";
}

type Tree = {
  nodes: TreeNode[];
  threshold: {
    activeTaskThreshold: number;
    openTotal: number;
    exceeded: boolean;
  };
};

/**
 * The overview tree, assembled server-side in a fixed number of queries
 * (tasks, subtask relations, entries, documents, artifacts — five, plus the
 * settings row) regardless of project size. A client walking task-by-task would be N+1
 * several times over.
 *
 * `attachments` come from the fork-owned `agent_artifact` table (finalized
 * rows only); the upstream `asset` table is NOT the source — its rows are
 * inline description/comment images, not deliverables. Leaves carry no URL:
 * one is minted per click from `GET /api/agent-artifact/{projectId}/{id}/url`.
 *
 * Roots are tasks that are the target of no `subtask` relation (`sourceTaskId`
 * is the parent, `targetTaskId` the child), ordered by creation. A task with
 * two parents appears under both. Cycles cannot be excluded at write time
 * upstream, so the walk carries its ancestor path and stops at a repeat; tasks
 * reachable only through a cycle (hence never a root) are appended as extra
 * roots so nothing silently disappears from the view.
 */
async function getTree(projectId: string): Promise<Tree> {
  const [tasks, relations, entries, documents, artifacts] = await Promise.all([
    db
      .select({
        id: schema.taskTable.id,
        number: schema.taskTable.number,
        title: schema.taskTable.title,
        status: schema.taskTable.status,
        createdAt: schema.taskTable.createdAt,
        updatedAt: schema.taskTable.updatedAt,
        isFinal: schema.columnTable.isFinal,
      })
      .from(schema.taskTable)
      .leftJoin(
        schema.columnTable,
        eq(schema.taskTable.columnId, schema.columnTable.id),
      )
      .where(eq(schema.taskTable.projectId, projectId))
      .orderBy(asc(schema.taskTable.createdAt), asc(schema.taskTable.id)),
    db
      .select({
        parentId: schema.taskRelationTable.sourceTaskId,
        childId: schema.taskRelationTable.targetTaskId,
      })
      .from(schema.taskRelationTable)
      .innerJoin(
        schema.taskTable,
        eq(schema.taskRelationTable.sourceTaskId, schema.taskTable.id),
      )
      .where(
        and(
          eq(schema.taskTable.projectId, projectId),
          eq(schema.taskRelationTable.relationType, "subtask"),
        ),
      )
      .orderBy(
        asc(schema.taskRelationTable.createdAt),
        asc(schema.taskRelationTable.id),
      ),
    // Narrow projection: refs and usage are small, body/decision are not.
    db
      .select({
        taskId: agentEntryTable.taskId,
        refs: agentEntryTable.refs,
        usage: agentEntryTable.usage,
        model: agentActorTable.model,
      })
      .from(agentEntryTable)
      .leftJoin(
        agentActorTable,
        eq(agentEntryTable.actorId, agentActorTable.id),
      )
      .where(
        and(
          eq(agentEntryTable.projectId, projectId),
          isNotNull(agentEntryTable.taskId),
        ),
      )
      .orderBy(desc(agentEntryTable.createdAt), desc(agentEntryTable.id)),
    db
      .select({
        id: agentDocumentTable.id,
        slug: agentDocumentTable.slug,
        title: agentDocumentTable.title,
        taskId: agentDocumentTable.taskId,
        actorId: agentDocumentTable.actorId,
        updatedBy: agentDocumentTable.updatedBy,
        updatedAt: agentDocumentTable.updatedAt,
      })
      .from(agentDocumentTable)
      .where(
        and(
          eq(agentDocumentTable.projectId, projectId),
          isNotNull(agentDocumentTable.taskId),
        ),
      )
      .orderBy(asc(agentDocumentTable.slug)),
    db
      .select({
        id: agentArtifactTable.id,
        taskId: agentArtifactTable.taskId,
        name: agentArtifactTable.name,
        contentType: agentArtifactTable.contentType,
        size: agentArtifactTable.size,
        createdAt: agentArtifactTable.createdAt,
      })
      .from(agentArtifactTable)
      .where(
        and(
          eq(agentArtifactTable.projectId, projectId),
          isNotNull(agentArtifactTable.taskId),
          isNotNull(agentArtifactTable.finalizedAt),
        ),
      )
      .orderBy(desc(agentArtifactTable.createdAt), desc(agentArtifactTable.id)),
  ]);
  // One primary-key lookup after the fan-out: not worth a sixth branch in
  // the Promise.all, and awaiting it here keeps its failure path ordinary.
  const settings = await getSettings(projectId);

  const taskIds = new Set(tasks.map((task) => task.id));

  const childrenOf = new Map<string, string[]>();
  const hasParent = new Set<string>();
  // Sibling order is the relation's creation order (ties broken by id in the
  // query), so it is stable across calls.
  for (const relation of relations) {
    // Both ends must be in this project; the join only guaranteed the parent.
    if (!taskIds.has(relation.childId)) continue;
    hasParent.add(relation.childId);
    const siblings = childrenOf.get(relation.parentId) ?? [];
    if (!siblings.includes(relation.childId)) siblings.push(relation.childId);
    childrenOf.set(relation.parentId, siblings);
  }

  const branchesOf = new Map<string, TreeNode["branches"]>();
  const usageOf = new Map<string, TreeNode["usage"]>();
  for (const entry of entries) {
    if (!entry.taskId) continue;

    const usage = usageOf.get(entry.taskId) ?? emptyUsage();
    usage.entryCount += 1;
    const tokens = (entry.usage as EntryUsage | null) ?? null;
    if (tokens) {
      const input = tokens.inputTokens ?? 0;
      const output = tokens.outputTokens ?? 0;
      const total = tokens.totalTokens ?? input + output;
      usage.inputTokens += input;
      usage.outputTokens += output;
      usage.totalTokens += total;
      const model = entry.model ?? UNKNOWN_MODEL;
      usage.byModel[model] = (usage.byModel[model] ?? 0) + total;
    }
    usageOf.set(entry.taskId, usage);

    // Entries arrive newest first, so first occurrence wins the ordering.
    const refs = (entry.refs as EntryRefs | null) ?? null;
    if (refs?.branch) {
      const branches = branchesOf.get(entry.taskId) ?? [];
      const repo = refs.repo || undefined;
      if (!branches.some((b) => b.branch === refs.branch && b.repo === repo)) {
        branches.push(
          repo ? { repo, branch: refs.branch } : { branch: refs.branch },
        );
      }
      branchesOf.set(entry.taskId, branches);
    }
  }

  const documentsOf = new Map<string, TreeNode["documents"]>();
  for (const document of documents) {
    if (!document.taskId) continue;
    const list = documentsOf.get(document.taskId) ?? [];
    list.push({
      id: document.id,
      slug: document.slug,
      title: document.title,
      actorId: document.actorId,
      updatedBy: document.updatedBy,
      updatedAt: document.updatedAt,
    });
    documentsOf.set(document.taskId, list);
  }

  const attachmentsOf = new Map<string, TreeNode["attachments"]>();
  for (const artifact of artifacts) {
    if (!artifact.taskId) continue;
    const list = attachmentsOf.get(artifact.taskId) ?? [];
    list.push({
      id: artifact.id,
      name: artifact.name,
      contentType: artifact.contentType,
      size: artifact.size,
      createdAt: artifact.createdAt,
    });
    attachmentsOf.set(artifact.taskId, list);
  }

  const taskById = new Map(tasks.map((task) => [task.id, task]));
  const rendered = new Set<string>();

  function build(taskId: string, ancestors: Set<string>): TreeNode | null {
    const task = taskById.get(taskId);
    if (!task || ancestors.has(taskId)) return null;
    rendered.add(taskId);

    const path = new Set(ancestors).add(taskId);
    const children: TreeNode[] = [];
    for (const childId of childrenOf.get(taskId) ?? []) {
      const child = build(childId, path);
      if (child) children.push(child);
    }

    return {
      id: task.id,
      number: task.number,
      title: task.title,
      status: task.status,
      done: isDone(task.status, task.isFinal),
      createdAt: task.createdAt,
      updatedAt: task.updatedAt,
      branches: branchesOf.get(taskId) ?? [],
      documents: documentsOf.get(taskId) ?? [],
      attachments: attachmentsOf.get(taskId) ?? [],
      usage: usageOf.get(taskId) ?? emptyUsage(),
      children,
    };
  }

  const nodes: TreeNode[] = [];
  for (const task of tasks) {
    if (hasParent.has(task.id)) continue;
    const node = build(task.id, new Set());
    if (node) nodes.push(node);
  }
  // Only a cycle leaves a task unrendered: every member has a parent, so none
  // qualified as a root. Surface them rather than lose them.
  for (const task of tasks) {
    if (rendered.has(task.id)) continue;
    const node = build(task.id, new Set());
    if (node) nodes.push(node);
  }

  // Counted over every task, not the rendered roots: a subtask that is still
  // open is still working-set. Cycle members are included since each task
  // is counted once here regardless of how the tree rendered it.
  let openTotal = 0;
  for (const task of tasks) {
    if (!isDone(task.status, task.isFinal)) openTotal += 1;
  }

  return {
    nodes,
    threshold: {
      activeTaskThreshold: settings.activeTaskThreshold,
      openTotal,
      exceeded: openTotal > settings.activeTaskThreshold,
    },
  };
}

export default getTree;
