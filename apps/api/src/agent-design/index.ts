import {
  specDeleteResultSchema,
  specReviewResultSchema,
  specRevisionListSchema,
  specRevisionSchema,
} from "../agent-requirement/response";
import {
  featureParams,
  projectIdParam,
  revisionParams,
} from "../agent-requirement/schema";
import {
  apiRouter,
  type BaseVariables,
  createRoute,
  errorResponse,
  jsonResponse,
} from "../openapi";
import { rejectApiKey } from "../utils/reject-api-key";
import { requireWorkspacePermission } from "../utils/require-workspace-permission";
import { workspaceAccess } from "../utils/workspace-access-middleware";
import {
  deleteDesign,
  getDesignRevision,
  listDesignRevisions,
  restoreDesign,
  revertDesign,
  reviewDesign,
} from "./controllers/design-lifecycle";
import getDesign from "./controllers/get-design";
import listDesigns from "./controllers/list-designs";
import putDesign from "./controllers/put-design";
import { designListSchema, designSchema } from "./response";
import { putDesignBody } from "./schema";

const listRoute = createRoute({
  method: "get",
  operationId: "listAgentDesigns",
  path: "/{projectId}",
  tags: ["Agent Layer"],
  summary: "List designs",
  description:
    "One row per feature with a computed `stale` verdict: a design is stale when any requirement it covers changed after the design's content was last revised (`revisedAt`). Soft-deleted designs are not listed.",
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
    "Full body plus the requirements it covers (each flagged if it changed since the design was last revised) and the tasks derived from it. A soft-deleted design is not found.",
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
    "Overwrites title/body. `requirementKeys`, when sent, replaces the design's requirement links; unknown keys are a 400. The save applies immediately and, being a person's save, marks the design reviewed. A change to the title, body or covered keys moves `revisedAt` (linked tasks go stale) and appends a revision. A soft-deleted design is a 409 until it is restored.",
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
    409: errorResponse("The design is soft-deleted"),
  },
});

const reviewRoute = createRoute({
  method: "post",
  operationId: "reviewAgentDesign",
  path: "/{projectId}/{feature}/review",
  tags: ["Agent Layer"],
  summary: "Mark a design reviewed",
  description:
    "Human-only: API-key callers get a 403 and no MCP tool exists. Records the calling person as having read the current content; an agent's next save clears the mark. Writes no timeline entry.",
  middleware: [workspaceAccess.fromProject("projectId")] as const,
  request: { params: featureParams },
  responses: {
    200: jsonResponse("The review mark", specReviewResultSchema),
    400: errorResponse("Unknown project, or invalid feature"),
    403: errorResponse("No workspace access, or API-key caller"),
    404: errorResponse("Design not found"),
  },
});

const deleteRoute = createRoute({
  method: "delete",
  operationId: "deleteAgentDesign",
  path: "/{projectId}/{feature}",
  tags: ["Agent Layer"],
  summary: "Delete a design",
  description:
    "Human-only soft delete for project:update holders. The row, its requirement links and revisions are kept and stamped `deletedAt`/`deletedBy`; the design then disappears from lists, gets, feature summaries and task links. Task link rows are kept and show again on restore. Appends one timeline entry.",
  middleware: [
    workspaceAccess.fromProject("projectId"),
    requireWorkspacePermission({ project: ["update"] }),
  ] as const,
  request: { params: featureParams },
  responses: {
    200: jsonResponse("The deleted design", specDeleteResultSchema),
    400: errorResponse("Unknown project, or invalid feature"),
    403: errorResponse(
      "No workspace access, missing project:update, or API-key caller",
    ),
    404: errorResponse("Design not found, or already deleted"),
  },
});

const restoreRoute = createRoute({
  method: "post",
  operationId: "restoreAgentDesign",
  path: "/{projectId}/{feature}/restore",
  tags: ["Agent Layer"],
  summary: "Restore a deleted design",
  description:
    "Human-only, project:update. Clears `deletedAt`/`deletedBy`, so the design reads exactly as it did before the delete. Appends one timeline entry.",
  middleware: [
    workspaceAccess.fromProject("projectId"),
    requireWorkspacePermission({ project: ["update"] }),
  ] as const,
  request: { params: featureParams },
  responses: {
    200: jsonResponse("The restored design", designSchema),
    400: errorResponse("Unknown project, or invalid feature"),
    403: errorResponse(
      "No workspace access, missing project:update, or API-key caller",
    ),
    404: errorResponse("Design not found, or not deleted"),
  },
});

const revisionsRoute = createRoute({
  method: "get",
  operationId: "listAgentDesignRevisions",
  path: "/{projectId}/{feature}/revisions",
  tags: ["Agent Layer"],
  summary: "List a design's revisions",
  description:
    "Newest first, one per save that changed the title, body or covered keys. Carries the author (person or agent) and time, not the body.",
  middleware: [workspaceAccess.fromProject("projectId")] as const,
  request: { params: featureParams },
  responses: {
    200: jsonResponse("Revisions", specRevisionListSchema),
    400: errorResponse("Unknown project, or invalid feature"),
    403: errorResponse("No access to the project's workspace"),
    404: errorResponse("Design not found"),
  },
});

const revisionRoute = createRoute({
  method: "get",
  operationId: "getAgentDesignRevision",
  path: "/{projectId}/{feature}/revisions/{revisionId}",
  tags: ["Agent Layer"],
  summary: "Get one design revision",
  description:
    "The stored title, body and covered requirement keys of one revision.",
  middleware: [workspaceAccess.fromProject("projectId")] as const,
  request: { params: revisionParams },
  responses: {
    200: jsonResponse("The revision", specRevisionSchema),
    400: errorResponse("Unknown project, or invalid feature"),
    403: errorResponse("No access to the project's workspace"),
    404: errorResponse("Design or revision not found"),
  },
});

const revertRoute = createRoute({
  method: "post",
  operationId: "revertAgentDesign",
  path: "/{projectId}/{feature}/revisions/{revisionId}/revert",
  tags: ["Agent Layer"],
  summary: "Revert a design to a revision",
  description:
    "Human-only, task:update. Saves the revision's title, body and covered keys through the normal save as the calling person; the resulting revision records `revertedFromId`. Reverting to content identical to the current one changes nothing.",
  middleware: [
    workspaceAccess.fromProject("projectId"),
    requireWorkspacePermission({ task: ["update"] }),
  ] as const,
  request: { params: revisionParams },
  responses: {
    200: jsonResponse("The design after the revert", designSchema),
    400: errorResponse("A covered key no longer exists, or invalid params"),
    403: errorResponse(
      "No workspace access, missing task:update, or API-key caller",
    ),
    404: errorResponse("Design or revision not found"),
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
  .openapi(reviewRoute, async (c) => {
    rejectApiKey(c);
    const { projectId, feature } = c.req.valid("param");
    return c.json(
      await reviewDesign({ projectId, feature, userId: c.get("userId") }),
      200,
    );
  })
  .openapi(deleteRoute, async (c) => {
    rejectApiKey(c);
    const { projectId, feature } = c.req.valid("param");
    return c.json(
      await deleteDesign({
        workspaceId: c.get("workspaceId"),
        projectId,
        feature,
        userId: c.get("userId"),
      }),
      200,
    );
  })
  .openapi(restoreRoute, async (c) => {
    rejectApiKey(c);
    const { projectId, feature } = c.req.valid("param");
    return c.json(
      await restoreDesign({
        workspaceId: c.get("workspaceId"),
        projectId,
        feature,
        userId: c.get("userId"),
      }),
      200,
    );
  })
  .openapi(revisionsRoute, async (c) => {
    const { projectId, feature } = c.req.valid("param");
    return c.json(await listDesignRevisions(projectId, feature), 200);
  })
  .openapi(revisionRoute, async (c) => {
    const { projectId, feature, revisionId } = c.req.valid("param");
    return c.json(await getDesignRevision(projectId, feature, revisionId), 200);
  })
  .openapi(revertRoute, async (c) => {
    rejectApiKey(c);
    const { projectId, feature, revisionId } = c.req.valid("param");
    return c.json(
      await revertDesign({
        workspaceId: c.get("workspaceId"),
        projectId,
        feature,
        revisionId,
        userId: c.get("userId"),
      }),
      200,
    );
  });

export default agentDesign;
