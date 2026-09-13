import { HTTPException } from "hono/http-exception";
import { featureParams, projectIdParam } from "../agent-requirement/schema";
import {
  apiRouter,
  type BaseVariables,
  createRoute,
  errorResponse,
  jsonResponse,
} from "../openapi";
import { requireWorkspacePermission } from "../utils/require-workspace-permission";
import { workspaceAccess } from "../utils/workspace-access-middleware";
import approveDesign from "./controllers/approve-design";
import getDesign from "./controllers/get-design";
import listDesigns from "./controllers/list-designs";
import putDesign from "./controllers/put-design";
import { designListSchema, designRowSchema, designSchema } from "./response";
import { putDesignBody } from "./schema";

const listRoute = createRoute({
  method: "get",
  operationId: "listAgentDesigns",
  path: "/{projectId}",
  tags: ["Agent Layer"],
  summary: "List designs",
  description:
    "One row per feature with a computed `stale` verdict: a design is stale when any requirement it covers changed after the design was approved.",
  middleware: [workspaceAccess.fromProject("projectId")] as const,
  request: { params: projectIdParam },
  responses: {
    200: jsonResponse("Design summaries", designListSchema),
    400: errorResponse("Unknown project"),
    403: errorResponse("No access to the project's workspace"),
  },
});

const getRoute = createRoute({
  method: "get",
  operationId: "getAgentDesign",
  path: "/{projectId}/{feature}",
  tags: ["Agent Layer"],
  summary: "Get one design",
  description:
    "Full body plus the requirements it covers (each flagged if it changed since approval) and the tasks derived from it.",
  middleware: [workspaceAccess.fromProject("projectId")] as const,
  request: { params: featureParams },
  responses: {
    200: jsonResponse("The design", designSchema),
    400: errorResponse("Unknown project, or invalid feature"),
    403: errorResponse("No access to the project's workspace"),
    404: errorResponse("Design not found"),
  },
});

const putRoute = createRoute({
  method: "put",
  operationId: "putAgentDesign",
  path: "/{projectId}/{feature}",
  tags: ["Agent Layer"],
  summary: "Create or replace a design",
  description:
    "Overwrites title/body. `requirementKeys`, when sent, replaces the design's requirement links; unknown keys are a 400. Writing to an approved design returns it to `draft`.",
  middleware: [
    workspaceAccess.fromProject("projectId"),
    requireWorkspacePermission({ task: ["update"] }),
  ] as const,
  request: {
    params: featureParams,
    body: {
      required: true,
      content: { "application/json": { schema: putDesignBody } },
    },
  },
  responses: {
    200: jsonResponse("The saved design", designSchema),
    400: errorResponse(
      "Invalid body, unknown requirement key, unknown project",
    ),
    403: errorResponse("No workspace access, or missing task:update"),
  },
});

const approveRoute = createRoute({
  method: "post",
  operationId: "approveAgentDesign",
  path: "/{projectId}/{feature}/approve",
  tags: ["Agent Layer"],
  summary: "Approve a design",
  description:
    "Human-only: rejected for API-key callers, no MCP tool. Sets `approvedAt`, the clock task staleness is compared against.",
  middleware: [
    workspaceAccess.fromProject("projectId"),
    requireWorkspacePermission({ task: ["update"] }),
  ] as const,
  request: { params: featureParams },
  responses: {
    200: jsonResponse("The approved design", designRowSchema),
    400: errorResponse("Unknown project, or invalid feature"),
    403: errorResponse(
      "No workspace access, missing task:update, or API-key caller",
    ),
    404: errorResponse("Design not found"),
  },
});

const agentDesign = apiRouter<BaseVariables & { workspaceId: string }>()
  .openapi(listRoute, async (c) =>
    c.json({ designs: await listDesigns(c.req.valid("param").projectId) }, 200),
  )
  .openapi(getRoute, async (c) => {
    const { projectId, feature } = c.req.valid("param");
    return c.json(await getDesign(projectId, feature), 200);
  })
  .openapi(putRoute, async (c) => {
    const { projectId, feature } = c.req.valid("param");
    const userId = c.get("userId");
    await putDesign({
      ...c.req.valid("json"),
      projectId,
      feature,
      workspaceId: c.get("workspaceId"),
      author: { updatedBy: userId },
      entryAuthor: { userId },
    });
    return c.json(await getDesign(projectId, feature), 200);
  })
  .openapi(approveRoute, async (c) => {
    if (c.get("apiKey")) {
      throw new HTTPException(403, {
        message:
          "Approval is a human decision: sign in with a session, not an API key",
      });
    }
    const { projectId, feature } = c.req.valid("param");
    const row = await approveDesign({
      projectId,
      feature,
      workspaceId: c.get("workspaceId"),
      userId: c.get("userId"),
    });
    return c.json(
      {
        id: row.id,
        feature: row.feature,
        title: row.title,
        status: row.status,
        approvedAt: row.approvedAt,
        approvedBy: row.approvedBy,
        updatedAt: row.updatedAt,
      },
      200,
    );
  });

export default agentDesign;
