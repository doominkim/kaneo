import { HTTPException } from "hono/http-exception";
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
import createDecision from "./controllers/create-decision";
import { resolveDecisionAuthor } from "./controllers/decision-author";
import {
  deleteDecision,
  restoreDecision,
  reviewDecision,
} from "./controllers/decision-lifecycle";
import { getDecision } from "./controllers/decision-record";
import listDecisions from "./controllers/list-decisions";
import promoteEntry from "./controllers/promote-entry";
import {
  decisionDeleteResultSchema,
  decisionDetailSchema,
  decisionListSchema,
} from "./response";
import {
  createDecisionBody,
  decisionParams,
  listDecisionsQuery,
  projectIdParam,
  promotionParams,
} from "./schema";

const IMMUTABLE_MESSAGE = "accepted ADR is immutable; create a superseding ADR";

const listRoute = createRoute({
  method: "get",
  operationId: "listAgentDecisions",
  path: "/{projectId}",
  tags: ["Agent Layer"],
  summary: "List architecture decision records",
  description:
    "Project-local ADRs, newest number first. The default `status=current` returns accepted ADRs; `all` adds superseded ones; `deleted` lists only soft-deleted ADRs. Every row carries `reviewed`, and `unreviewedTotal` counts the project's unreviewed, non-deleted ADRs whatever the filters. Responses carry a 240-character context preview rather than the full ADR body. Filter by one linked task or search title, context and decision text. Page with the opaque `nextBefore` id.",
  middleware: [workspaceAccess.fromProject("projectId")] as const,
  request: { params: projectIdParam, query: listDecisionsQuery },
  responses: {
    200: jsonResponse("Bounded ADR summaries", decisionListSchema),
    400: errorResponse("Unknown cursor or invalid query"),
    403: errorResponse("No access to the project's workspace"),
  },
});

const getRoute = createRoute({
  method: "get",
  operationId: "getAgentDecision",
  path: "/{projectId}/{decisionId}",
  tags: ["Agent Layer"],
  summary: "Get one architecture decision record",
  description:
    "The full ADR with human/agent attribution, review mark, linked tasks, source ledger entry, and previous/next replacement links. A soft-deleted ADR is not found, and deleted ADRs are left out of the replacement links.",
  middleware: [workspaceAccess.fromProject("projectId")] as const,
  request: { params: decisionParams },
  responses: {
    200: jsonResponse("The ADR", decisionDetailSchema),
    403: errorResponse("No access to the project's workspace"),
    404: errorResponse("ADR not found in this project"),
  },
});

const createRouteDefinition = createRoute({
  method: "post",
  operationId: "createAgentDecision",
  path: "/",
  tags: ["Agent Layer"],
  summary: "Create an ADR",
  description:
    "Creates an accepted ADR at once — there is no draft — and atomically allocates its monotonically increasing project-local number. With `supersedesDecisionId` the previous accepted ADR becomes superseded in the same transaction. Every linked task must belong to the project. Provider and model together attribute the ADR to an agent, which leaves it unreviewed until a person reviews it; omitting both attributes it to the calling person, who is recorded as acceptor and reviewer. Creation and replacement append structured timeline entries.",
  middleware: [
    workspaceAccess.fromProject("projectId"),
    requireWorkspacePermission({ task: ["update"] }),
  ] as const,
  request: {
    body: {
      required: true,
      content: { "application/json": { schema: createDecisionBody } },
    },
  },
  responses: {
    200: jsonResponse("The accepted ADR", decisionDetailSchema),
    400: errorResponse("Invalid body or a task outside the project"),
    403: errorResponse("No workspace access, or missing task:update"),
    404: errorResponse("The ADR to supersede is not in this project"),
    409: errorResponse(
      "The ADR to supersede is superseded, deleted, or already replaced",
    ),
  },
});

const updateRoute = createRoute({
  method: "patch",
  operationId: "updateAgentDecision",
  path: "/{projectId}/{decisionId}",
  tags: ["Agent Layer"],
  summary: "Edit an ADR (always refused)",
  description:
    "ADRs are accepted on creation and their content is immutable, so this always answers 409. Record the change as a new ADR with `supersedesDecisionId`.",
  middleware: [
    workspaceAccess.fromProject("projectId"),
    requireWorkspacePermission({ task: ["update"] }),
  ] as const,
  request: { params: decisionParams },
  responses: {
    403: errorResponse("No workspace access, or missing task:update"),
    409: errorResponse(IMMUTABLE_MESSAGE),
  },
});

const promoteRoute = createRoute({
  method: "post",
  operationId: "promoteAgentDecisionEntry",
  path: "/{projectId}/from-entry/{entryId}",
  tags: ["Agent Layer"],
  summary: "Promote a legacy decision entry to an ADR",
  description:
    "Idempotently copies an existing, visible `kind=decision` ledger entry into an accepted ADR reviewed by the calling person. `decision.why`, `decision.what`, and `decision.rejected` map to ADR fields; the freeform entry body is preserved separately as `sourceNote`, not asserted to be consequences. The source entry is never changed. If the ADR promoted from the entry was deleted, promoting again is a 409.",
  middleware: [
    workspaceAccess.fromProject("projectId"),
    requireWorkspacePermission({ task: ["update"] }),
  ] as const,
  request: { params: promotionParams },
  responses: {
    200: jsonResponse(
      "The existing or newly created ADR",
      decisionDetailSchema,
    ),
    400: errorResponse("Entry decision payload is not promotable"),
    403: errorResponse("No workspace access, or missing task:update"),
    404: errorResponse("Visible decision entry not found in this project"),
    409: errorResponse("The ADR promoted from this entry is deleted"),
  },
});

const reviewRoute = createRoute({
  method: "post",
  operationId: "reviewAgentDecision",
  path: "/{projectId}/{decisionId}/review",
  tags: ["Agent Layer"],
  summary: "Mark an ADR reviewed",
  description:
    "Human-only: API-key callers get a 403 and no MCP tool exists. Records the calling person as having read the ADR (`reviewedAt`/`reviewedBy`). Writes no timeline entry.",
  middleware: [workspaceAccess.fromProject("projectId")] as const,
  request: { params: decisionParams },
  responses: {
    200: jsonResponse("The reviewed ADR", decisionDetailSchema),
    403: errorResponse("No workspace access, or API-key caller"),
    404: errorResponse("ADR not found in this project"),
  },
});

const deleteRoute = createRoute({
  method: "delete",
  operationId: "deleteAgentDecision",
  path: "/{projectId}/{decisionId}",
  tags: ["Agent Layer"],
  summary: "Delete an ADR",
  description:
    "Human-only soft delete for project:update holders. The row is kept and stamped `deletedAt`/`deletedBy`, and disappears from the default listing, the detail and replacement links. When the ADR had superseded another one that is still `superseded` and not deleted, that one returns to `accepted` in the same transaction. Appends timeline entries for both changes.",
  middleware: [
    workspaceAccess.fromProject("projectId"),
    requireWorkspacePermission({ project: ["update"] }),
  ] as const,
  request: { params: decisionParams },
  responses: {
    200: jsonResponse("The deleted ADR", decisionDeleteResultSchema),
    403: errorResponse(
      "No workspace access, missing project:update, or API-key caller",
    ),
    404: errorResponse("ADR not found in this project, or already deleted"),
  },
});

const restoreRoute = createRoute({
  method: "post",
  operationId: "restoreAgentDecision",
  path: "/{projectId}/{decisionId}/restore",
  tags: ["Agent Layer"],
  summary: "Restore a deleted ADR",
  description:
    "Human-only, project:update. Clears `deletedAt`/`deletedBy`. When the ADR supersedes another one, that one must still be `accepted` and not deleted, and is superseded again in the same transaction; otherwise the restore is a 409 and nothing changes. Appends timeline entries for both changes.",
  middleware: [
    workspaceAccess.fromProject("projectId"),
    requireWorkspacePermission({ project: ["update"] }),
  ] as const,
  request: { params: decisionParams },
  responses: {
    200: jsonResponse("The restored ADR", decisionDetailSchema),
    403: errorResponse(
      "No workspace access, missing project:update, or API-key caller",
    ),
    404: errorResponse("ADR not found in this project, or not deleted"),
    409: errorResponse(
      "The ADR it superseded is no longer accepted, or already has another replacement",
    ),
  },
});

const agentDecision = apiRouter<BaseVariables & { workspaceId: string }>()
  .openapi(listRoute, async (c) =>
    c.json(
      await listDecisions({
        projectId: c.req.valid("param").projectId,
        ...c.req.valid("query"),
      }),
      200,
    ),
  )
  .openapi(getRoute, async (c) => {
    const { projectId, decisionId } = c.req.valid("param");
    return c.json(await getDecision(projectId, decisionId), 200);
  })
  .openapi(createRouteDefinition, async (c) => {
    const body = c.req.valid("json");
    const author = await resolveDecisionAuthor({
      workspaceId: c.get("workspaceId"),
      userId: c.get("userId"),
      provider: body.provider,
      model: body.model,
    });
    return c.json(
      await createDecision({
        ...body,
        workspaceId: c.get("workspaceId"),
        author,
      }),
      200,
    );
  })
  .openapi(updateRoute, () => {
    throw new HTTPException(409, { message: IMMUTABLE_MESSAGE });
  })
  .openapi(promoteRoute, async (c) => {
    const { projectId, entryId } = c.req.valid("param");
    return c.json(
      await promoteEntry({
        workspaceId: c.get("workspaceId"),
        projectId,
        entryId,
        userId: c.get("userId"),
      }),
      200,
    );
  })
  .openapi(reviewRoute, async (c) => {
    rejectApiKey(c);
    const { projectId, decisionId } = c.req.valid("param");
    return c.json(
      await reviewDecision({ projectId, decisionId, userId: c.get("userId") }),
      200,
    );
  })
  .openapi(deleteRoute, async (c) => {
    rejectApiKey(c);
    const { projectId, decisionId } = c.req.valid("param");
    return c.json(
      await deleteDecision({
        workspaceId: c.get("workspaceId"),
        projectId,
        decisionId,
        userId: c.get("userId"),
      }),
      200,
    );
  })
  .openapi(restoreRoute, async (c) => {
    rejectApiKey(c);
    const { projectId, decisionId } = c.req.valid("param");
    return c.json(
      await restoreDecision({
        workspaceId: c.get("workspaceId"),
        projectId,
        decisionId,
        userId: c.get("userId"),
      }),
      200,
    );
  });

export default agentDecision;
