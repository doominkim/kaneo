import { eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../../database";
import { agentDomainTable } from "../../database/schema-agent-layer";
import {
  findDomainInWorkspace,
  loadAncestors,
  requireDomainInWorkspace,
} from "./domain-lookup";
import { withAuthors } from "./domain-record";
import { isDomainSlugViolation } from "./is-domain-unique-violation";

type MoveInput = {
  workspaceId: string;
  domainId: string;
  parentId: string | null;
  position?: number;
};

/**
 * Re-parent and/or reorder. A cycle is detected by walking UP from the new
 * parent: if the page itself is among that parent's ancestors (or is the
 * parent), the move would detach the subtree from the root. The walk is
 * bounded, so a corrupted tree cannot hang the request.
 *
 * The slug check at the new level is left to the unique constraints — the
 * same two the create path relies on — so a concurrent create cannot slip in
 * between a pre-check and the update.
 */
async function moveDomain(input: MoveInput) {
  await requireDomainInWorkspace(input.workspaceId, input.domainId);

  if (input.parentId !== null) {
    if (input.parentId === input.domainId) {
      throw new HTTPException(400, {
        message: "A page cannot be its own parent",
      });
    }
    const parent = await findDomainInWorkspace(
      input.workspaceId,
      input.parentId,
    );
    if (!parent) {
      throw new HTTPException(400, {
        message: "parentId does not belong to this workspace",
      });
    }
    const lineage = await loadAncestors(input.workspaceId, parent.parentId);
    if (lineage.some((ancestor) => ancestor.id === input.domainId)) {
      throw new HTTPException(400, {
        message: "A page cannot be moved under its own descendant",
      });
    }
  }

  let moved: typeof agentDomainTable.$inferSelect | undefined;
  try {
    [moved] = await db
      .update(agentDomainTable)
      .set({
        parentId: input.parentId,
        ...(input.position !== undefined ? { position: input.position } : {}),
        updatedAt: new Date(),
      })
      .where(eq(agentDomainTable.id, input.domainId))
      .returning();
  } catch (error) {
    if (isDomainSlugViolation(error)) {
      throw new HTTPException(409, {
        message: "A page with the same slug already exists at the target level",
      });
    }
    throw error;
  }

  if (!moved) {
    throw new HTTPException(404, { message: "Domain not found" });
  }
  return withAuthors(moved);
}

export default moveDomain;
