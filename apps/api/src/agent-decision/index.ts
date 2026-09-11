import {
  apiRouter,
  type BaseVariables,
  createRoute,
  errorResponse,
  jsonResponse,
} from "../openapi";
import { requireWorkspacePermission } from "../utils/require-workspace-permission";
import { workspaceAccess } from "../utils/workspace-access-middleware";
import acceptDecision from "./controllers/accept-decision";
import createDecision from "./controllers/create-decision";
import { resolveDecisionAuthor } from "./controllers/decision-author";
import { getDecision } from "./controllers/decision-record";
import listDecisions from "./controllers/list-decisions";
import promoteEntry from "./controllers/promote-entry";
import updateDecision from "./controllers/update-decision";
import { decisionDetailSchema, decisionListSchema } from "./response";
import {
  acceptDecisionBody,
  createDecisionBody,
  decisionParams,
  listDecisionsQuery,
  projectIdParam,
  promotionParams,
  updateDecisionBody,
} from "./schema";

const listRoute = createRoute({
  method: "get",
  operationId: "listAgentDecisions",
  path: "/{projectId}",
  tags: ["Agent Layer"],
  summary: "List architecture decision records",
  description:
    "Project-local ADRs, newest number first. The default `status=current` returns drafts and accepted ADRs, excluding superseded records. Responses carry a 240-character context preview rather than the full ADR body. Filter by one linked task or search title, context and decision text. Page with the opaque `nextBefore` id.",
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
    "The full ADR with human/agent attribution, linked tasks, source ledger entry, and previous/next replacement links.",
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
  summary: "Create an ADR draft",
  description:
    "Creates an editable draft and atomically allocates its monotonically increasing project-local number. Every linked task must belong to the project. Provider and model together attribute the draft to an agent; omitting both attributes it to the calling person.",
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
    200: jsonResponse("The created draft", decisionDetailSchema),
    400: errorResponse("Invalid body or a task outside the project"),
    403: errorResponse("No workspace access, or missing task:update"),
  },
});

const updateRoute = createRoute({
  method: "patch",
  operationId: "updateAgentDecision",
  path: "/{projectId}/{decisionId}",
  tags: ["Agent Layer"],
  summary: "Edit an ADR draft",
  description:
    "Only drafts are editable. `expectedUpdatedAt` is an optimistic concurrency token; stale writes return 409. Accepted and superseded ADR content is immutable. Sending taskIds replaces every task link and every task must belong to the project.",
  middleware: [
    workspaceAccess.fromProject("projectId"),
    requireWorkspacePermission({ task: ["update"] }),
  ] as const,
  request: {
    params: decisionParams,
    body: {
      required: true,
      content: { "application/json": { schema: updateDecisionBody } },
    },
  },
  responses: {
    200: jsonResponse("The updated draft", decisionDetailSchema),
    400: errorResponse("Invalid body or a task outside the project"),
    403: errorResponse("No workspace access, or missing task:update"),
    404: errorResponse("ADR not found in this project"),
    409: errorResponse("ADR is no longer the editable version"),
  },
});

const promoteRoute = createRoute({
  method: "post",
  operationId: "promoteAgentDecisionEntry",
  path: "/{projectId}/from-entry/{entryId}",
  tags: ["Agent Layer"],
  summary: "Promote a legacy decision entry to an ADR draft",
  description:
    "Idempotently copies an existing, visible `kind=decision` ledger entry. `decision.why`, `decision.what`, and `decision.rejected` map to ADR fields; the freeform entry body is preserved separately as `sourceNote`, not asserted to be consequences. The source entry is never changed.",
  middleware: [
    workspaceAccess.fromProject("projectId"),
    requireWorkspacePermission({ task: ["update"] }),
  ] as const,
  request: { params: promotionParams },
  responses: {
    200: jsonResponse(
      "The existing or newly created draft",
      decisionDetailSchema,
    ),
    400: errorResponse("Entry decision payload is not promotable"),
    403: errorResponse("No workspace access, or missing task:update"),
    404: errorResponse("Visible decision entry not found in this project"),
  },
});

const acceptRoute = createRoute({
  method: "post",
  operationId: "acceptAgentDecision",
  path: "/{projectId}/{decisionId}/accept",
  tags: ["Agent Layer"],
  summary: "Accept an ADR draft",
  description:
    "A human project maintainer accepts the reviewed draft. `expectedUpdatedAt` prevents accepting content that changed after review. With `supersedesDecisionId`, the previous accepted ADR becomes superseded in the same transaction. Both lifecycle changes append structured ledger entries; no existing entry is edited.",
  middleware: [
    workspaceAccess.fromProject("projectId"),
    requireWorkspacePermission({ project: ["update"] }),
  ] as const,
  request: {
    params: decisionParams,
    body: {
      required: true,
      content: { "application/json": { schema: acceptDecisionBody } },
    },
  },
  responses: {
    200: jsonResponse("The accepted ADR", decisionDetailSchema),
    400: errorResponse("An ADR cannot supersede itself"),
    403: errorResponse("No workspace access, or missing project:update"),
    404: errorResponse("Draft or previous ADR not found in this project"),
    409: errorResponse(
      "Stale draft, invalid previous state, or concurrent replacement",
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
  .openapi(updateRoute, async (c) => {
    const body = c.req.valid("json");
    const { projectId, decisionId } = c.req.valid("param");
    const author = await resolveDecisionAuthor({
      workspaceId: c.get("workspaceId"),
      userId: c.get("userId"),
      provider: body.provider,
      model: body.model,
    });
    return c.json(
      await updateDecision({ ...body, projectId, decisionId, author }),
      200,
    );
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
  .openapi(acceptRoute, async (c) => {
    const { projectId, decisionId } = c.req.valid("param");
    return c.json(
      await acceptDecision({
        workspaceId: c.get("workspaceId"),
        projectId,
        decisionId,
        userId: c.get("userId"),
        ...c.req.valid("json"),
      }),
      200,
    );
  });

export default agentDecision;
