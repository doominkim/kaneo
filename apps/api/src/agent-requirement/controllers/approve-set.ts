import { eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import appendEntry from "../../agent-entry/controllers/append-entry";
import db from "../../database";
import { agentRequirementSetTable } from "../../database/schema-agent-layer";
import { requireSet } from "./shared";

/**
 * Human-only (REQ-SPEC-TABS-4): the route refuses API keys and the MCP layer
 * registers no approve tool, so the only path here is a signed-in person.
 * `approvedAt` is the clock downstream stale checks compare against.
 */
async function approveSet(input: {
  workspaceId: string;
  projectId: string;
  feature: string;
  userId: string;
}) {
  const set = await requireSet(input.projectId, input.feature);
  const now = new Date();
  const [approved] = await db
    .update(agentRequirementSetTable)
    .set({
      status: "approved",
      approvedAt: now,
      approvedBy: input.userId,
      updatedAt: now,
    })
    .where(eq(agentRequirementSetTable.id, set.id))
    .returning();
  if (!approved) {
    throw new HTTPException(500, {
      message: "Failed to approve requirement set",
    });
  }
  await appendEntry({
    workspaceId: input.workspaceId,
    userId: input.userId,
    projectId: input.projectId,
    kind: "decision",
    summary: `[requirements:${input.feature}] 요구사항 문서 승인`,
    decision: {
      what: `요구사항 문서 ${input.feature} 를 승인했다`,
      why: "사람 검토 완료",
      reversible: true,
    },
  });
  return approved;
}

export default approveSet;
