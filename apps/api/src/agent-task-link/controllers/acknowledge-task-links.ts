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
 * Moves every link's clock to now; nothing upstream is touched.
 *
 * Agents may acknowledge too (agent-autoapply), so who did it is kept on the
 * links. An agent's acknowledgement records its actor and stays unreviewed
 * until a person reviews the task's links; a person's acknowledgement is its
 * own review. An API-key call carries a person's permissions but is not a
 * person reading the change, so it acknowledges without marking reviewed.
 */
async function acknowledgeTaskLinks(input: {
  workspaceId: string;
  projectId: string;
  taskId: string;
  userId: string;
  agent?: {
    actorId: string;
    provider: string;
    model: string;
    sessionId?: string | null;
  };
  viaApiKey?: boolean;
}) {
  await requireTaskInProject(input.projectId, input.taskId);
  const now = new Date();
  const values = {
    acknowledgedAt: now,
    acknowledgedActorId: input.agent?.actorId ?? null,
    reviewedAt: input.agent || input.viaApiKey ? null : now,
  };
  await db.transaction(async (tx) => {
    await tx
      .update(agentTaskRequirementTable)
      .set(values)
      .where(eq(agentTaskRequirementTable.taskId, input.taskId));
    await tx
      .update(agentTaskDesignTable)
      .set(values)
      .where(eq(agentTaskDesignTable.taskId, input.taskId));
  });
  await appendEntry({
    workspaceId: input.workspaceId,
    userId: input.userId,
    projectId: input.projectId,
    taskId: input.taskId,
    provider: input.agent?.provider,
    model: input.agent?.model,
    sessionId: input.agent?.sessionId ?? null,
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
