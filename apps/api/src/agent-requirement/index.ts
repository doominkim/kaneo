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
import getSet from "./controllers/get-set";
import listSets from "./controllers/list-sets";
import putCoverage from "./controllers/put-coverage";
import putSet from "./controllers/put-set";
import {
  deleteSet,
  getSetRevision,
  listSetRevisions,
  restoreSet,
  revertSet,
  reviewSet,
} from "./controllers/set-lifecycle";
import {
  coverageResultSchema,
  requirementSetListSchema,
  requirementSetSchema,
  specDeleteResultSchema,
  specReviewResultSchema,
  specRevisionListSchema,
  specRevisionSchema,
} from "./response";
import {
  featureParams,
  projectIdParam,
  putCoverageBody,
  putRequirementSetBody,
  revisionParams,
} from "./schema";

const listRoute = createRoute({
  method: "get",
  operationId: "listAgentRequirementSets",
  path: "/{projectId}",
  tags: ["Agent Layer"],
  summary: "List requirement sets",
  description:
    "One row per feature with item counts. Bodies and items are excluded; fetch a set for those. Soft-deleted sets are not listed.",
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
    "The set with its items in `seq` order. Each item lists the designs and tasks derived from it and the tests that cite its key, so coverage is readable from a single call. A soft-deleted set is not found.",
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
    "Replaces `title`/`body` and upserts the items sent. Items are rows: an item omitted from the payload is untouched, never deleted — send `status: \"dropped\"` to retire one. A changed `text`, `status`, `layer` or `story` moves the item's `updatedAt`, which every downstream stale check reads. The save applies immediately (`approved`, `approvedAt` = now). A signed-in person's save marks the set reviewed; an API-key save is attributed to the key's owner but leaves the set unreviewed. A changed title, body or item appends a revision that stores all three. A soft-deleted set is a 409 until it is restored. This is the human path (`updatedBy`); agents write through MCP.",
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
    409: errorResponse("The set is soft-deleted"),
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

const reviewRoute = createRoute({
  method: "post",
  operationId: "reviewAgentRequirementSet",
  path: "/{projectId}/{feature}/review",
  tags: ["Agent Layer"],
  summary: "Mark a requirement set reviewed",
  description:
    "Human-only: API-key callers get a 403 and no MCP tool exists. Records the calling person as having read the current content. Saves already apply without it; an agent's next save clears the mark again. Writes no timeline entry.",
  middleware: [workspaceAccess.fromProject("projectId")] as const,
  request: { params: featureParams },
  responses: {
    200: jsonResponse("The review mark", specReviewResultSchema),
    400: errorResponse("Unknown project, or invalid feature"),
    403: errorResponse("No workspace access, or API-key caller"),
    404: errorResponse("Requirement set not found"),
  },
});

const deleteRoute = createRoute({
  method: "delete",
  operationId: "deleteAgentRequirementSet",
  path: "/{projectId}/{feature}",
  tags: ["Agent Layer"],
  summary: "Delete a requirement set",
  description:
    "Human-only soft delete for project:update holders. The row, its items and revisions are kept and stamped `deletedAt`/`deletedBy`; the set then disappears from lists, gets, feature summaries, task links and the spec-check route. Task link rows are kept and show again on restore. Appends one timeline entry.",
  middleware: [
    workspaceAccess.fromProject("projectId"),
    requireWorkspacePermission({ project: ["update"] }),
  ] as const,
  request: { params: featureParams },
  responses: {
    200: jsonResponse("The deleted set", specDeleteResultSchema),
    400: errorResponse("Unknown project, or invalid feature"),
    403: errorResponse(
      "No workspace access, missing project:update, or API-key caller",
    ),
    404: errorResponse("Requirement set not found, or already deleted"),
  },
});

const restoreRoute = createRoute({
  method: "post",
  operationId: "restoreAgentRequirementSet",
  path: "/{projectId}/{feature}/restore",
  tags: ["Agent Layer"],
  summary: "Restore a deleted requirement set",
  description:
    "Human-only, project:update. Clears `deletedAt`/`deletedBy`, so the set reads exactly as it did before the delete. Appends one timeline entry.",
  middleware: [
    workspaceAccess.fromProject("projectId"),
    requireWorkspacePermission({ project: ["update"] }),
  ] as const,
  request: { params: featureParams },
  responses: {
    200: jsonResponse("The restored set", requirementSetSchema),
    400: errorResponse("Unknown project, or invalid feature"),
    403: errorResponse(
      "No workspace access, missing project:update, or API-key caller",
    ),
    404: errorResponse("Requirement set not found, or not deleted"),
  },
});

const revisionsRoute = createRoute({
  method: "get",
  operationId: "listAgentRequirementSetRevisions",
  path: "/{projectId}/{feature}/revisions",
  tags: ["Agent Layer"],
  summary: "List a requirement set's revisions",
  description:
    "Newest first, one per save that changed the title or body. Carries the author (person or agent) and time, not the body.",
  middleware: [workspaceAccess.fromProject("projectId")] as const,
  request: { params: featureParams },
  responses: {
    200: jsonResponse("Revisions", specRevisionListSchema),
    400: errorResponse("Unknown project, or invalid feature"),
    403: errorResponse("No access to the project's workspace"),
    404: errorResponse("Requirement set not found"),
  },
});

const revisionRoute = createRoute({
  method: "get",
  operationId: "getAgentRequirementSetRevision",
  path: "/{projectId}/{feature}/revisions/{revisionId}",
  tags: ["Agent Layer"],
  summary: "Get one requirement set revision",
  description: "The stored title and body of one revision.",
  middleware: [workspaceAccess.fromProject("projectId")] as const,
  request: { params: revisionParams },
  responses: {
    200: jsonResponse("The revision", specRevisionSchema),
    400: errorResponse("Unknown project, or invalid feature"),
    403: errorResponse("No access to the project's workspace"),
    404: errorResponse("Requirement set or revision not found"),
  },
});

const revertRoute = createRoute({
  method: "post",
  operationId: "revertAgentRequirementSet",
  path: "/{projectId}/{feature}/revisions/{revisionId}/revert",
  tags: ["Agent Layer"],
  summary: "Revert a requirement set to a revision",
  description:
    "Human-only, task:update. Saves the revision's title and body through the normal save as the calling person: keys, dropped lines and item clocks follow, so designs and tasks go stale exactly as for a hand-written save. The resulting revision records `revertedFromId`; reverting to content identical to the current one changes nothing.",
  middleware: [
    workspaceAccess.fromProject("projectId"),
    requireWorkspacePermission({ task: ["update"] }),
  ] as const,
  request: { params: revisionParams },
  responses: {
    200: jsonResponse("The set after the revert", requirementSetSchema),
    400: errorResponse("The revision no longer parses, or invalid params"),
    403: errorResponse(
      "No workspace access, missing task:update, or API-key caller",
    ),
    404: errorResponse("Requirement set or revision not found"),
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
      viaApiKey: Boolean(c.get("apiKey")),
    });
    return c.json(await getSet(projectId, feature), 200);
  })
  .openapi(coverageRoute, async (c) => {
    const { projectId, feature } = c.req.valid("param");
    return c.json(
      await putCoverage({ ...c.req.valid("json"), projectId, feature }),
      200,
    );
  })
  .openapi(reviewRoute, async (c) => {
    rejectApiKey(c);
    const { projectId, feature } = c.req.valid("param");
    return c.json(
      await reviewSet({ projectId, feature, userId: c.get("userId") }),
      200,
    );
  })
  .openapi(deleteRoute, async (c) => {
    rejectApiKey(c);
    const { projectId, feature } = c.req.valid("param");
    return c.json(
      await deleteSet({
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
      await restoreSet({
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
    return c.json(await listSetRevisions(projectId, feature), 200);
  })
  .openapi(revisionRoute, async (c) => {
    const { projectId, feature, revisionId } = c.req.valid("param");
    return c.json(await getSetRevision(projectId, feature, revisionId), 200);
  })
  .openapi(revertRoute, async (c) => {
    rejectApiKey(c);
    const { projectId, feature, revisionId } = c.req.valid("param");
    return c.json(
      await revertSet({
        workspaceId: c.get("workspaceId"),
        projectId,
        feature,
        revisionId,
        userId: c.get("userId"),
      }),
      200,
    );
  });

export default agentRequirement;
