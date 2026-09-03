import {
  apiRouter,
  type BaseVariables,
  createRoute,
  errorResponse,
  jsonResponse,
} from "../openapi";
import { requireWorkspacePermission } from "../utils/require-workspace-permission";
import { workspaceAccess } from "../utils/workspace-access-middleware";
import confirmTerm from "./controllers/confirm-term";
import listTerms from "./controllers/list-terms";
import proposeTerm from "./controllers/propose-term";
import resolveTerm from "./controllers/resolve-term";
import { resolveResultSchema, termListSchema, termSchema } from "./response";
import {
  confirmTermBody,
  listTermsQuery,
  proposeTermBody,
  resolveQuery,
  workspaceIdParam,
} from "./schema";

const resolveRoute = createRoute({
  method: "get",
  operationId: "resolveAgentTerm",
  path: "/{workspaceId}/resolve",
  tags: ["Agent Layer"],
  summary: "Resolve a term",
  description:
    "Deterministic lookup: the same input always returns the same answer, with no embedding and no model judgement. Retired terms are still returned — a tombstone tells you the concept is dead and what replaced it.",
  middleware: [workspaceAccess.fromParam("workspaceId")] as const,
  request: { params: workspaceIdParam, query: resolveQuery },
  responses: {
    200: jsonResponse("Resolution result", resolveResultSchema),
    403: errorResponse("No access to the workspace"),
  },
});

const listRoute = createRoute({
  method: "get",
  operationId: "listAgentTerms",
  path: "/{workspaceId}",
  tags: ["Agent Layer"],
  summary: "List lexicon terms",
  description:
    "Workspace vocabulary, alphabetical. Filter by state or confidence to drive the review queue.",
  middleware: [workspaceAccess.fromParam("workspaceId")] as const,
  request: { params: workspaceIdParam, query: listTermsQuery },
  responses: {
    200: jsonResponse("Terms", termListSchema),
    403: errorResponse("No access to the workspace"),
  },
});

const proposeRoute = createRoute({
  method: "post",
  operationId: "proposeAgentTerm",
  path: "/",
  tags: ["Agent Layer"],
  summary: "Propose a term",
  description:
    "Adds a term as `proposed`. It never becomes `confirmed` here — unreviewed entries accumulating is how a lexicon stops being trusted. Send `provider`/`model` from an agent so the proposal records which model wrote it; omit both when a person proposes.",
  middleware: [
    workspaceAccess.fromBody("workspaceId"),
    requireWorkspacePermission({ task: ["update"] }),
  ] as const,
  request: {
    body: {
      required: true,
      content: { "application/json": { schema: proposeTermBody } },
    },
  },
  responses: {
    200: jsonResponse("The proposed term", termSchema),
    403: errorResponse("No workspace access, or missing task:update"),
    409: errorResponse("A term with that canonical name already exists"),
  },
});

const confirmRoute = createRoute({
  method: "post",
  operationId: "confirmAgentTerm",
  path: "/{workspaceId}/confirm",
  tags: ["Agent Layer"],
  summary: "Review a proposed term",
  description:
    "Human review outcome — the only path from `proposed` to `confirmed`. Also stamps lastVerifiedAt, which the re-verification schedule reads.",
  middleware: [
    workspaceAccess.fromParam("workspaceId"),
    requireWorkspacePermission({ workspace: ["update"] }),
  ] as const,
  request: {
    params: workspaceIdParam,
    body: {
      required: true,
      content: { "application/json": { schema: confirmTermBody } },
    },
  },
  responses: {
    200: jsonResponse("The reviewed term", termSchema),
    403: errorResponse("No workspace access, or missing workspace:update"),
    404: errorResponse("Term not found"),
  },
});

const agentTerm = apiRouter<BaseVariables & { workspaceId: string }>()
  .openapi(resolveRoute, async (c) =>
    c.json(
      await resolveTerm(
        c.req.valid("param").workspaceId,
        c.req.valid("query").term,
      ),
      200,
    ),
  )
  .openapi(listRoute, async (c) =>
    c.json(
      await listTerms({
        workspaceId: c.req.valid("param").workspaceId,
        ...c.req.valid("query"),
      }),
      200,
    ),
  )
  .openapi(proposeRoute, async (c) =>
    c.json(
      await proposeTerm({
        ...c.req.valid("json"),
        ownerId: c.get("userId"),
      }),
      200,
    ),
  )
  .openapi(confirmRoute, async (c) => {
    const { termId, confidence } = c.req.valid("json");
    return c.json(
      await confirmTerm(c.req.valid("param").workspaceId, termId, confidence),
      200,
    );
  });

export default agentTerm;
