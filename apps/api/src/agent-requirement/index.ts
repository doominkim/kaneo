import { HTTPException } from "hono/http-exception";
import {
  apiRouter,
  type BaseVariables,
  createRoute,
  errorResponse,
  jsonResponse,
} from "../openapi";
import { requireWorkspacePermission } from "../utils/require-workspace-permission";
import { workspaceAccess } from "../utils/workspace-access-middleware";
import approveSet from "./controllers/approve-set";
import getSet from "./controllers/get-set";
import listSets from "./controllers/list-sets";
import putCoverage from "./controllers/put-coverage";
import putSet from "./controllers/put-set";
import {
  coverageResultSchema,
  requirementSetListSchema,
  requirementSetRowSchema,
  requirementSetSchema,
} from "./response";
import {
  featureParams,
  projectIdParam,
  putCoverageBody,
  putRequirementSetBody,
} from "./schema";

const listRoute = createRoute({
  method: "get",
  operationId: "listAgentRequirementSets",
  path: "/{projectId}",
  tags: ["Agent Layer"],
  summary: "List requirement sets",
  description:
    "One row per feature with item counts. Bodies and items are excluded; fetch a set for those.",
  middleware: [workspaceAccess.fromProject("projectId")] as const,
  request: { params: projectIdParam },
  responses: {
    200: jsonResponse("Requirement set summaries", requirementSetListSchema),
    400: errorResponse("Unknown project"),
    403: errorResponse("No access to the project's workspace"),
  },
});

const getRoute = createRoute({
  method: "get",
  operationId: "getAgentRequirementSet",
  path: "/{projectId}/{feature}",
  tags: ["Agent Layer"],
  summary: "Get one requirement set",
  description:
    "The set with its items in `seq` order. Each item lists the designs and tasks derived from it and the tests that cite its key, so coverage is readable from a single call.",
  middleware: [workspaceAccess.fromProject("projectId")] as const,
  request: { params: featureParams },
  responses: {
    200: jsonResponse("The requirement set", requirementSetSchema),
    400: errorResponse("Unknown project, or invalid feature"),
    403: errorResponse("No access to the project's workspace"),
    404: errorResponse("Requirement set not found"),
  },
});

const putRoute = createRoute({
  method: "put",
  operationId: "putAgentRequirementSet",
  path: "/{projectId}/{feature}",
  tags: ["Agent Layer"],
  summary: "Create or update a requirement set",
  description:
    'Replaces `title`/`body` and upserts the items sent. Items are rows: an item omitted from the payload is untouched, never deleted — send `status: "dropped"` to retire one. A changed `text` or `status` moves the item\'s `updatedAt`, which every downstream stale check reads. Writing to an approved set returns it to `draft`. This is the human path (`updatedBy`); agents write through MCP.',
  middleware: [
    workspaceAccess.fromProject("projectId"),
    requireWorkspacePermission({ task: ["update"] }),
  ] as const,
  request: {
    params: featureParams,
    body: {
      required: true,
      content: { "application/json": { schema: putRequirementSetBody } },
    },
  },
  responses: {
    200: jsonResponse("The saved set", requirementSetSchema),
    400: errorResponse("Invalid body, bad or duplicate key, unknown project"),
    403: errorResponse("No workspace access, or missing task:update"),
  },
});

const approveRoute = createRoute({
  method: "post",
  operationId: "approveAgentRequirementSet",
  path: "/{projectId}/{feature}/approve",
  tags: ["Agent Layer"],
  summary: "Approve a requirement set",
  description:
    "Human-only: rejected for API-key callers, and no MCP tool exists for it. Sets `approvedAt`, the clock designs and tasks are compared against for staleness.",
  middleware: [
    workspaceAccess.fromProject("projectId"),
    requireWorkspacePermission({ task: ["update"] }),
  ] as const,
  request: { params: featureParams },
  responses: {
    200: jsonResponse("The approved set", requirementSetRowSchema),
    400: errorResponse("Unknown project, or invalid feature"),
    403: errorResponse(
      "No workspace access, missing task:update, or API-key caller",
    ),
    404: errorResponse("Requirement set not found"),
  },
});

const coverageRoute = createRoute({
  method: "put",
  operationId: "putAgentRequirementCoverage",
  path: "/{projectId}/{feature}/coverage",
  tags: ["Agent Layer"],
  summary: "Report test coverage for a requirement set",
  description:
    "spec-check's report for one repo: replaces that repo's coverage rows for the set's items. Unknown keys are a 400 so a typo in a test title does not silently drop coverage.",
  middleware: [
    workspaceAccess.fromProject("projectId"),
    requireWorkspacePermission({ task: ["update"] }),
  ] as const,
  request: {
    params: featureParams,
    body: {
      required: true,
      content: { "application/json": { schema: putCoverageBody } },
    },
  },
  responses: {
    200: jsonResponse("Coverage accepted", coverageResultSchema),
    400: errorResponse("Invalid body or unknown key"),
    403: errorResponse("No workspace access, or missing task:update"),
    404: errorResponse("Requirement set not found"),
  },
});

const agentRequirement = apiRouter<BaseVariables & { workspaceId: string }>()
  .openapi(listRoute, async (c) =>
    c.json({ sets: await listSets(c.req.valid("param").projectId) }, 200),
  )
  .openapi(getRoute, async (c) => {
    const { projectId, feature } = c.req.valid("param");
    return c.json(await getSet(projectId, feature), 200);
  })
  .openapi(putRoute, async (c) => {
    const { projectId, feature } = c.req.valid("param");
    const userId = c.get("userId");
    await putSet({
      ...c.req.valid("json"),
      projectId,
      feature,
      workspaceId: c.get("workspaceId"),
      author: { updatedBy: userId },
      entryAuthor: { userId },
    });
    return c.json(await getSet(projectId, feature), 200);
  })
  .openapi(approveRoute, async (c) => {
    if (c.get("apiKey")) {
      throw new HTTPException(403, {
        message:
          "Approval is a human decision: sign in with a session, not an API key",
      });
    }
    const { projectId, feature } = c.req.valid("param");
    return c.json(
      await approveSet({
        projectId,
        feature,
        workspaceId: c.get("workspaceId"),
        userId: c.get("userId"),
      }),
      200,
    );
  })
  .openapi(coverageRoute, async (c) => {
    const { projectId, feature } = c.req.valid("param");
    return c.json(
      await putCoverage({ ...c.req.valid("json"), projectId, feature }),
      200,
    );
  });

export default agentRequirement;
