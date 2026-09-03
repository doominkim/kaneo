import { eq } from "drizzle-orm";
import db from "../../database";
import { agentProjectTable } from "../../database/schema-agent-layer";
import {
  DEFAULT_ACTIVE_TASK_THRESHOLD,
  DEFAULT_DONE_ARCHIVE_DAYS,
} from "../schema";
import { type LinkedDomain, listProjectDomains } from "./project-domains";

export type ProjectSettings = {
  projectId: string;
  corePaths: string[];
  activeTaskThreshold: number;
  doneArchiveDays: number;
  domainIds: string[];
  domains: LinkedDomain[];
  configured: boolean;
  updatedBy: string | null;
  updatedAt: Date | null;
};

function defaults(projectId: string, domains: LinkedDomain[]): ProjectSettings {
  return {
    projectId,
    corePaths: [],
    activeTaskThreshold: DEFAULT_ACTIVE_TASK_THRESHOLD,
    doneArchiveDays: DEFAULT_DONE_ARCHIVE_DAYS,
    domainIds: domains.map((domain) => domain.id),
    domains,
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
  const [[row], domains] = await Promise.all([
    db
      .select()
      .from(agentProjectTable)
      .where(eq(agentProjectTable.projectId, projectId))
      .limit(1),
    listProjectDomains(projectId),
  ]);

  if (!row) return defaults(projectId, domains);
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

export default getSettings;
