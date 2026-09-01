import {
  apiRouter,
  type BaseVariables,
  createRoute,
  errorResponse,
  jsonResponse,
} from "../openapi";
import { requireWorkspacePermission } from "../utils/require-workspace-permission";
import { workspaceAccess } from "../utils/workspace-access-middleware";
import acquireLease from "./controllers/acquire-lease";
import listLeases from "./controllers/list-leases";
import releaseLease from "./controllers/release-lease";
import {
  acquireResultSchema,
  leaseListSchema,
  releaseResultSchema,
} from "./response";
import { acquireLeaseBody, projectIdParam, releaseLeaseBody } from "./schema";

const acquireRoute = createRoute({
  method: "post",
  operationId: "acquireAgentLease",
  path: "/acquire",
  tags: ["Agent Layer"],
  summary: "Claim a task",
  description:
    "Returns acquired=false with the current holder when another live session has the task. Atomic: two sessions asking simultaneously cannot both be told yes.",
  middleware: [
    workspaceAccess.fromTaskId("taskId"),
    requireWorkspacePermission({ task: ["update"] }),
  ] as const,
  request: {
    body: {
      required: true,
      content: { "application/json": { schema: acquireLeaseBody } },
    },
  },
  responses: {
    200: jsonResponse("Acquisition result", acquireResultSchema),
    400: errorResponse("Unknown task"),
    403: errorResponse("No workspace access, or missing task:update"),
  },
});

const releaseRoute = createRoute({
  method: "post",
  operationId: "releaseAgentLease",
  path: "/release",
  tags: ["Agent Layer"],
  summary: "Release a claim",
  description:
    "Only the holding session may release, so one agent cannot drop another's claim. The durable record of the work lives in the ledger, not here.",
  middleware: [
    workspaceAccess.fromTaskId("taskId"),
    requireWorkspacePermission({ task: ["update"] }),
  ] as const,
  request: {
    body: {
      required: true,
      content: { "application/json": { schema: releaseLeaseBody } },
    },
  },
  responses: {
    200: jsonResponse("Release result", releaseResultSchema),
    400: errorResponse("Unknown task"),
    403: errorResponse("No workspace access, or missing task:update"),
  },
});

const listRoute = createRoute({
  method: "get",
  operationId: "listAgentLeases",
  path: "/{projectId}",
  tags: ["Agent Layer"],
  summary: "List live claims",
  description:
    "Who is working on what right now. Expired claims are filtered out rather than swept, so correctness does not depend on a cleanup job running.",
  middleware: [workspaceAccess.fromProject("projectId")] as const,
  request: { params: projectIdParam },
  responses: {
    200: jsonResponse("Live leases", leaseListSchema),
    403: errorResponse("No access to the project's workspace"),
  },
});

const agentLease = apiRouter<BaseVariables & { workspaceId: string }>()
  .openapi(acquireRoute, async (c) =>
    c.json(
      await acquireLease({
        ...c.req.valid("json"),
        workspaceId: c.get("workspaceId"),
        userId: c.get("userId"),
      }),
      200,
    ),
  )
  .openapi(releaseRoute, async (c) => {
    const { taskId, sessionId } = c.req.valid("json");
    return c.json(await releaseLease(taskId, sessionId), 200);
  })
  .openapi(listRoute, async (c) =>
    c.json(await listLeases(c.req.valid("param").projectId), 200),
  );

export default agentLease;
