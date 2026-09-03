import { and, eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { assertDomainsInWorkspace } from "../../agent-domain/controllers/domain-lookup";
import { loadActor } from "../../agent-entry/actor-response";
import db, { schema } from "../../database";
import { agentDocumentTable } from "../../database/schema-agent-layer";
import { isTaskForeignKeyViolation } from "./is-task-fk-violation";

type PutInput = {
  workspaceId: string;
  projectId: string;
  slug: string;
  title: string;
  body: string;
  taskId?: string | null;
  domainId?: string | null;
  /** Exactly one of these is set; the other is written as NULL. */
  author: { updatedBy: string } | { actorId: string };
};

/**
 * Create-or-replace on (project, slug). Last write wins — there is no
 * conditional PUT yet (DESIGN.md §10).
 *
 * The author columns are always both written so a document flips cleanly
 * between human and agent authorship: an agent overwrite must not leave the
 * previous human's id behind, or the reader would trust the wrong author.
 */
async function putDocument(input: PutInput) {
  if (input.taskId) {
    const [task] = await db
      .select({ id: schema.taskTable.id })
      .from(schema.taskTable)
      .where(
        and(
          eq(schema.taskTable.id, input.taskId),
          eq(schema.taskTable.projectId, input.projectId),
        ),
      )
      .limit(1);
    if (!task) {
      throw new HTTPException(400, {
        message: "taskId does not belong to this project",
      });
    }
  }

  if (input.domainId) {
    await assertDomainsInWorkspace(input.workspaceId, [input.domainId]);
  }

  const authorColumns =
    "updatedBy" in input.author
      ? { updatedBy: input.author.updatedBy, actorId: null }
      : { updatedBy: null, actorId: input.author.actorId };

  const values = {
    title: input.title,
    body: input.body,
    taskId: input.taskId ?? null,
    domainId: input.domainId ?? null,
    ...authorColumns,
  };

  let document: typeof agentDocumentTable.$inferSelect | undefined;
  try {
    [document] = await db
      .insert(agentDocumentTable)
      .values({
        workspaceId: input.workspaceId,
        projectId: input.projectId,
        slug: input.slug,
        ...values,
      })
      .onConflictDoUpdate({
        target: [agentDocumentTable.projectId, agentDocumentTable.slug],
        set: { ...values, updatedAt: new Date() },
      })
      .returning();
  } catch (error) {
    // The task passed the membership check above but was deleted before the
    // write landed. Same answer as the check, not a 500.
    if (isTaskForeignKeyViolation(error)) {
      throw new HTTPException(400, {
        message: "taskId does not belong to this project",
      });
    }
    throw error;
  }

  if (!document) {
    throw new HTTPException(500, { message: "Failed to save document" });
  }

  // Looked up rather than joined: the write returns its own row, and the
  // lookup only happens when the write was actually attributed to an agent.
  return { ...document, actor: await loadActor(document.actorId) };
}

export default putDocument;
