import { eq } from "drizzle-orm";
import appendEntry from "../../agent-entry/controllers/append-entry";
import db from "../../database";
import {
  agentTaskDesignTable,
  agentTaskRequirementTable,
} from "../../database/schema-agent-layer";
import { requireTaskInProject } from "./shared";

/**
 * "I have read the upstream change and this task still stands" (REQ-SPEC-TABS-10).
 * Human-only. Moves every link's clock to now; nothing upstream is touched.
 */
async function acknowledgeTaskLinks(input: {
  workspaceId: string;
  projectId: string;
  taskId: string;
  userId: string;
}) {
  await requireTaskInProject(input.projectId, input.taskId);
  const now = new Date();
  await db.transaction(async (tx) => {
    await tx
      .update(agentTaskRequirementTable)
      .set({ acknowledgedAt: now })
      .where(eq(agentTaskRequirementTable.taskId, input.taskId));
    await tx
      .update(agentTaskDesignTable)
      .set({ acknowledgedAt: now })
      .where(eq(agentTaskDesignTable.taskId, input.taskId));
  });
  await appendEntry({
    workspaceId: input.workspaceId,
    userId: input.userId,
    projectId: input.projectId,
    taskId: input.taskId,
    kind: "decision",
    summary: "상위 요구사항·설계 변경을 확인하고 태스크를 그대로 유지함",
    decision: {
      what: "요구사항·설계 변경 확인 (acknowledge)",
      why: "태스크 범위에 영향 없음으로 판단",
      reversible: true,
    },
  });
  return { taskId: input.taskId, acknowledgedAt: now };
}

export default acknowledgeTaskLinks;
