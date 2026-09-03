import { eq, sql } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { assertDomainsInWorkspace } from "../../agent-domain/controllers/domain-lookup";
import db from "../../database";
import {
  agentProjectDomainTable,
  agentProjectTable,
} from "../../database/schema-agent-layer";
import { normalizeRelativePath } from "../core-paths";
import type { ProjectSettings } from "./get-settings";
import { listProjectDomains } from "./project-domains";

type PutInput = {
  projectId: string;
  workspaceId: string;
  userId: string;
  corePaths: string[];
  activeTaskThreshold: number;
  doneArchiveDays: number;
  /** Full replacement when present; untouched when absent. */
  domainIds?: string[];
};

/**
 * Full replacement of the project's settings, creating the row on first
 * write. One statement (INSERT ... ON CONFLICT) so two concurrent saves cannot
 * both see "no row" and race the insert; last write wins.
 *
 * Patterns arrive validated (relative, no `..`) and are stored in canonical
 * form — a leading `./` is dropped — so the matcher sees the same text a
 * `git diff --name-only` line would produce.
 *
 * `domainIds` is optional so a client that predates the field (or a form
 * that does not show it) cannot wipe the links by leaving it out; when sent
 * it is validated against the workspace and applied as delete-then-insert in
 * the same transaction as the settings row.
 */
async function putSettings(input: PutInput): Promise<ProjectSettings> {
  const corePaths: string[] = [];
  for (const pattern of input.corePaths) {
    const normalized = normalizeRelativePath(pattern);
    // Validation already rejected these; a throw here means the schema and
    // this normalizer disagree, which must surface rather than store junk.
    if (normalized === null) {
      throw new HTTPException(400, { message: "Invalid core path pattern" });
    }
    if (!corePaths.includes(normalized)) corePaths.push(normalized);
  }

  const domainIds = input.domainIds ? [...new Set(input.domainIds)] : null;
  if (domainIds) {
    await assertDomainsInWorkspace(input.workspaceId, domainIds);
  }

  const now = new Date();
  const row = await db.transaction(async (tx) => {
    const [saved] = await tx
      .insert(agentProjectTable)
      .values({
        projectId: input.projectId,
        workspaceId: input.workspaceId,
        corePaths,
        activeTaskThreshold: input.activeTaskThreshold,
        doneArchiveDays: input.doneArchiveDays,
        updatedBy: input.userId,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: agentProjectTable.projectId,
        set: {
          corePaths: sql`excluded.core_paths`,
          activeTaskThreshold: sql`excluded.active_task_threshold`,
          doneArchiveDays: sql`excluded.done_archive_days`,
          updatedBy: sql`excluded.updated_by`,
          updatedAt: sql`excluded.updated_at`,
        },
      })
      .returning();

    if (domainIds) {
      await tx
        .delete(agentProjectDomainTable)
        .where(eq(agentProjectDomainTable.projectId, input.projectId));
      if (domainIds.length > 0) {
        await tx.insert(agentProjectDomainTable).values(
          domainIds.map((domainId) => ({
            projectId: input.projectId,
            domainId,
          })),
        );
      }
    }
    return saved;
  });

  if (!row) {
    throw new HTTPException(500, { message: "Failed to save settings" });
  }

  const domains = await listProjectDomains(row.projectId);
  return {
    projectId: row.projectId,
    corePaths: row.corePaths,
    activeTaskThreshold: row.activeTaskThreshold,
    doneArchiveDays: row.doneArchiveDays,
    domainIds: domains.map((domain) => domain.id),
    domains,
    configured: true,
    updatedBy: row.updatedBy,
    updatedAt: row.updatedAt,
  };
}

export default putSettings;
