import { projectIdParam } from "../agent-requirement/schema";
import {
  apiRouter,
  type BaseVariables,
  createRoute,
  errorResponse,
  jsonResponse,
  responseTimestamp,
  z,
} from "../openapi";
import { rejectApiKey } from "../utils/reject-api-key";
import { requireWorkspacePermission } from "../utils/require-workspace-permission";
import { workspaceAccess } from "../utils/workspace-access-middleware";
import acknowledgeTaskLinks from "./controllers/acknowledge-task-links";
import getTaskLinks from "./controllers/get-task-links";
import listTaskLinkBadges from "./controllers/list-task-link-badges";
import putTaskLinks from "./controllers/put-task-links";
import reviewTaskLinks from "./controllers/review-task-links";
import { taskLinkBadgeListSchema, taskLinksSchema } from "./response";
import { putTaskLinksBody, taskParams } from "./schema";

const listRoute = createRoute({
  method: "get",
  operationId: "listAgentTaskLinkBadges",
  path: "/{projectId}",
  tags: ["Agent Layer"],
  summary: "Requirement/design badges for every linked task in a project",
  description:
    "Only tasks with at least one link appear. `stale` is computed from timestamps: an upstream requirement or design changed after the link was made or last acknowledged. Links to soft-deleted requirement sets or designs are left out.",
  middleware: [workspaceAccess.fromProject("projectId")] as const,
  request: { params: projectIdParam },
  responses: {
    200: jsonResponse("Badges by task", taskLinkBadgeListSchema),
    400: errorResponse("Unknown project"),
    403: errorResponse("No access to the project's workspace"),
  },
});

const getRoute = createRoute({
  method: "get",
  operationId: "getAgentTaskLinks",
  path: "/{projectId}/{taskId}",
  tags: ["Agent Layer"],
  summary: "Requirements and designs a task derives from",
  description:
    "Each link carries its own clock (`createdAt`, `acknowledgedAt`) next to the upstream's, whether the latest acknowledgement came from an agent and whether a person has reviewed it, and `stale.causes` names exactly which key or feature moved past it. Links to soft-deleted documents are hidden; their rows are kept.",
  middleware: [workspaceAccess.fromProject("projectId")] as const,
  request: { params: taskParams },
  responses: {
    200: jsonResponse("The task's links", taskLinksSchema),
    400: errorResponse("Unknown project, or task outside the project"),
    403: errorResponse("No access to the project's workspace"),
  },
});

const putRoute = createRoute({
  method: "put",
  operationId: "putAgentTaskLinks",
  path: "/{projectId}/{taskId}",
  tags: ["Agent Layer"],
  summary: "Replace a task's requirement and design links",
  description:
    "Each list, when sent, replaces that kind of link. Existing links that remain keep their clocks. Unknown keys or features, including those of soft-deleted documents, are a 400.",
  middleware: [
    workspaceAccess.fromProject("projectId"),
    requireWorkspacePermission({ task: ["update"] }),
  ] as const,
  request: {
    params: taskParams,
    body: {
      required: true,
      content: { "application/json": { schema: putTaskLinksBody } },
    },
  },
  responses: {
    200: jsonResponse("The task's links after the write", taskLinksSchema),
    400: errorResponse(
      "Invalid body, unknown key/feature, or task outside the project",
    ),
    403: errorResponse("No workspace access, or missing task:update"),
  },
});

const acknowledgeRoute = createRoute({
  method: "post",
  operationId: "acknowledgeAgentTaskLinks",
  path: "/{projectId}/{taskId}/acknowledge",
  tags: ["Agent Layer"],
  summary: "Acknowledge upstream changes for a task",
  description:
    "Records that the upstream change was read and the task still stands; moves every link's clock to now so `stale` clears without touching the requirement or design. A signed-in person's acknowledgement also marks the links reviewed; an API-key call acknowledges without marking them reviewed.",
  middleware: [
    workspaceAccess.fromProject("projectId"),
    requireWorkspacePermission({ task: ["update"] }),
  ] as const,
  request: { params: taskParams },
  responses: {
    200: jsonResponse(
      "Acknowledged",
      z
        .object({ taskId: z.string(), acknowledgedAt: responseTimestamp })
        .openapi("AgentTaskLinkAck"),
    ),
    400: errorResponse("Unknown project, or task outside the project"),
    403: errorResponse("No workspace access, or missing task:update"),
  },
});

const reviewRoute = createRoute({
  method: "post",
  operationId: "reviewAgentTaskLinks",
  path: "/{projectId}/{taskId}/review",
  tags: ["Agent Layer"],
  summary: "Mark a task's links reviewed",
  description:
    "Human-only: API-key callers get a 403. Stamps `reviewedAt` on every requirement and design link of the task, which is how a person signs off an agent's acknowledgement. The stale clock does not move and no timeline entry is written.",
  middleware: [workspaceAccess.fromProject("projectId")] as const,
  request: { params: taskParams },
  responses: {
    200: jsonResponse(
      "Reviewed",
      z
        .object({ taskId: z.string(), reviewedAt: responseTimestamp })
        .openapi("AgentTaskLinkReview"),
    ),
    400: errorResponse("Unknown project, or task outside the project"),
    403: errorResponse("No workspace access, or API-key caller"),
  },
});

const agentTaskLink = apiRouter<BaseVariables & { workspaceId: string }>()
  .openapi(listRoute, async (c) =>
    c.json(
      { tasks: await listTaskLinkBadges(c.req.valid("param").projectId) },
      200,
    ),
  )
  .openapi(getRoute, async (c) => {
    const { projectId, taskId } = c.req.valid("param");
    return c.json(await getTaskLinks(projectId, taskId), 200);
  })
  .openapi(putRoute, async (c) => {
    const { projectId, taskId } = c.req.valid("param");
    await putTaskLinks({ ...c.req.valid("json"), projectId, taskId });
    return c.json(await getTaskLinks(projectId, taskId), 200);
  })
  .openapi(acknowledgeRoute, async (c) => {
    const { projectId, taskId } = c.req.valid("param");
    return c.json(
      await acknowledgeTaskLinks({
        projectId,
        taskId,
        workspaceId: c.get("workspaceId"),
        userId: c.get("userId"),
        viaApiKey: Boolean(c.get("apiKey")),
      }),
      200,
    );
  })
  .openapi(reviewRoute, async (c) => {
    rejectApiKey(c);
    const { projectId, taskId } = c.req.valid("param");
    return c.json(await reviewTaskLinks({ projectId, taskId }), 200);
  });

export default agentTaskLink;
