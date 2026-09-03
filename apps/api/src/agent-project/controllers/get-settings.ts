import { eq } from "drizzle-orm";
import db from "../../database";
import { agentProjectTable } from "../../database/schema-agent-layer";
import {
  DEFAULT_ACTIVE_TASK_THRESHOLD,
  DEFAULT_DONE_ARCHIVE_DAYS,
} from "../schema";

export type ProjectSettings = {
  projectId: string;
  corePaths: string[];
  activeTaskThreshold: number;
  doneArchiveDays: number;
  configured: boolean;
  updatedBy: string | null;
  updatedAt: Date | null;
};

function defaults(projectId: string): ProjectSettings {
  return {
    projectId,
    corePaths: [],
    activeTaskThreshold: DEFAULT_ACTIVE_TASK_THRESHOLD,
    doneArchiveDays: DEFAULT_DONE_ARCHIVE_DAYS,
    configured: false,
    updatedBy: null,
    updatedAt: null,
  };
}

/**
 * The project's settings, or the defaults when no row exists. A read never
 * inserts: a project that was only ever looked at must leave no row behind.
 */
async function getSettings(projectId: string): Promise<ProjectSettings> {
  const [row] = await db
    .select()
    .from(agentProjectTable)
    .where(eq(agentProjectTable.projectId, projectId))
    .limit(1);

  if (!row) return defaults(projectId);
  return {
    projectId: row.projectId,
    corePaths: row.corePaths,
    activeTaskThreshold: row.activeTaskThreshold,
    doneArchiveDays: row.doneArchiveDays,
    configured: true,
    updatedBy: row.updatedBy,
    updatedAt: row.updatedAt,
  };
}

export default getSettings;
