import { eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../../database";
import { agentDomainTable } from "../../database/schema-agent-layer";
import { authorColumns, type DomainAuthorInput } from "./create-domain";
import { requireDomainInWorkspace } from "./domain-lookup";
import { withAuthors } from "./domain-record";

type UpdateInput = {
  workspaceId: string;
  domainId: string;
  title?: string;
  body?: string;
  author: DomainAuthorInput;
};

/**
 * Title and/or body, full replacement of whichever is given. Both author
 * columns are always rewritten so the page flips cleanly between human and
 * agent authorship — an agent overwrite must not leave the previous person's
 * id behind, or the reader trusts the wrong author. Last write wins.
 */
async function updateDomain(input: UpdateInput) {
  await requireDomainInWorkspace(input.workspaceId, input.domainId);

  const [updated] = await db
    .update(agentDomainTable)
    .set({
      ...(input.title !== undefined ? { title: input.title } : {}),
      ...(input.body !== undefined ? { body: input.body } : {}),
      ...authorColumns(input.author),
      updatedAt: new Date(),
    })
    .where(eq(agentDomainTable.id, input.domainId))
    .returning();

  if (!updated) {
    throw new HTTPException(404, { message: "Domain not found" });
  }
  return withAuthors(updated);
}

export default updateDomain;
