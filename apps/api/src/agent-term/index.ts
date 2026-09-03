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
import deleteTerm from "./controllers/delete-term";
import listTerms from "./controllers/list-terms";
import proposeTerm from "./controllers/propose-term";
import resolveTerm from "./controllers/resolve-term";
import setTermDomain from "./controllers/set-term-domain";
import {
  resolveResultSchema,
  termDeleteResultSchema,
  termListSchema,
  termSchema,
} from "./response";
import {
  confirmTermBody,
  listTermsQuery,
  proposeTermBody,
  resolveQuery,
  setTermDomainBody,
  termParams,
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

const setDomainRoute = createRoute({
  method: "patch",
  operationId: "setAgentTermDomain",
  path: "/{workspaceId}/{termId}/domain",
  tags: ["Agent Layer"],
  summary: "File a term under a domain page",
  description:
    "Sets or clears the term's `domainId`. The page must belong to the workspace. Requires workspace:update, the same gate as review — where a term belongs is a lexicon decision.",
  middleware: [
    workspaceAccess.fromParam("workspaceId"),
    requireWorkspacePermission({ workspace: ["update"] }),
  ] as const,
  request: {
    params: termParams,
    body: {
      required: true,
      content: { "application/json": { schema: setTermDomainBody } },
    },
  },
  responses: {
    200: jsonResponse("The term", termSchema),
    400: errorResponse("domainId outside the workspace"),
    403: errorResponse("No workspace access, or missing workspace:update"),
    404: errorResponse("Term not found in this workspace"),
  },
});

const deleteRoute = createRoute({
  method: "delete",
  operationId: "deleteAgentTerm",
  path: "/{workspaceId}/{termId}",
  tags: ["Agent Layer"],
  summary: "Delete a term",
  description:
    "Hard-deletes a term whatever its confidence or state — a workspace:update holder owns the lexicon. Retiring a term instead leaves a resolvable tombstone, so prefer it when the concept still needs an answer, but it is a choice rather than a precondition. The one refusal is 409, when another term names this one in `supersededBy` and deleting it would dangle that pointer. Requires workspace:update, the same gate as review.",
  middleware: [
    workspaceAccess.fromParam("workspaceId"),
    requireWorkspacePermission({ workspace: ["update"] }),
  ] as const,
  request: { params: termParams },
  responses: {
    200: jsonResponse(
      "The deleted term's id and canonical",
      termDeleteResultSchema,
    ),
    403: errorResponse("No workspace access, or missing workspace:update"),
    404: errorResponse("Term not found in this workspace"),
    409: errorResponse("Another term supersedes to this one"),
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
  })
  .openapi(setDomainRoute, async (c) => {
    const { workspaceId, termId } = c.req.valid("param");
    return c.json(
      await setTermDomain(workspaceId, termId, c.req.valid("json").domainId),
      200,
    );
  })
  .openapi(deleteRoute, async (c) => {
    const { workspaceId, termId } = c.req.valid("param");
    return c.json(await deleteTerm(workspaceId, termId), 200);
  });

export default agentTerm;
