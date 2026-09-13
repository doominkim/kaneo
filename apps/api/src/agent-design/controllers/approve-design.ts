import { eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import appendEntry from "../../agent-entry/controllers/append-entry";
import db from "../../database";
import {
  agentDesignTable,
  agentTaskDesignTable,
} from "../../database/schema-agent-layer";
import { requireDesign } from "./shared";

/** Human-only, like requirement approval (REQ-SPEC-TABS-6). */
async function approveDesign(input: {
  workspaceId: string;
  projectId: string;
  feature: string;
  userId: string;
}) {
  const design = await requireDesign(input.projectId, input.feature);
  const now = new Date();
  const firstApproval = design.approvedAt === null;
  const approved = await db.transaction(async (tx) => {
    const [row] = await tx
      .update(agentDesignTable)
      .set({
        status: "approved",
        approvedAt: now,
        approvedBy: input.userId,
        updatedAt: now,
      })
      .where(eq(agentDesignTable.id, design.id))
      .returning();
    if (!row) {
      throw new HTTPException(500, { message: "Failed to approve design" });
    }
    // First approval is not a change to tasks already derived from the
    // draft (REQ-FEATURE-HUB-14): their clocks move with it so nothing goes
    // stale. A re-approval leaves the links alone, so the usual comparison
    // flags them (REQ-FEATURE-HUB-15).
    if (firstApproval) {
      await tx
        .update(agentTaskDesignTable)
        .set({ acknowledgedAt: now })
        .where(eq(agentTaskDesignTable.designId, design.id));
    }
    return row;
  });
  await appendEntry({
    workspaceId: input.workspaceId,
    userId: input.userId,
    projectId: input.projectId,
    kind: "decision",
    summary: `[design:${input.feature}] 설계 문서 승인`,
    decision: {
      what: `설계 문서 ${input.feature} 를 승인했다`,
      why: "사람 검토 완료",
      reversible: true,
    },
  });
  return approved;
}

export default approveDesign;
