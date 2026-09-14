import { and, eq, inArray } from "drizzle-orm";
import appendEntry from "../../agent-entry/controllers/append-entry";
import { liveItemIds } from "../../agent-requirement/controllers/shared";
import db from "../../database";
import {
  agentTaskDesignTable,
  agentTaskRequirementTable,
} from "../../database/schema-agent-layer";
import { liveDesignIds, requireTaskInProject } from "./shared";

/**
 * "I have read the upstream change and this task still stands" (REQ-SPEC-TABS-10).
 * Moves every visible link's clock to now; nothing upstream is touched.
 *
 * Agents may acknowledge too (agent-autoapply), so who did it is kept on the
 * links. An agent's acknowledgement records its actor and stays unreviewed
 * until a person reviews the task's links; a person's acknowledgement is its
 * own review. An API-key call carries a person's permissions but is not a
 * person reading the change, so it acknowledges without marking reviewed.
 *
 * Links to a soft-deleted requirement set or design are hidden from the task,
 * so nobody acknowledging it has read them: they keep their clock and review
 * marker, and show exactly as they were when the document is restored. The
 * timeline entry is written in the same transaction as the link updates.
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
      .where(
        and(
          eq(agentTaskRequirementTable.taskId, input.taskId),
          inArray(
            agentTaskRequirementTable.itemId,
            liveItemIds(input.projectId),
          ),
        ),
      );
    await tx
      .update(agentTaskDesignTable)
      .set(values)
      .where(
        and(
          eq(agentTaskDesignTable.taskId, input.taskId),
          inArray(
            agentTaskDesignTable.designId,
            liveDesignIds(input.projectId),
          ),
        ),
      );
    await appendEntry(
      {
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
      },
      tx,
    );
  });
  return { taskId: input.taskId, acknowledgedAt: now };
}

export default acknowledgeTaskLinks;
