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
    "Deterministic lookup: the same input always returns the same answer, with no embedding and no model judgement. Only terms a person confirmed are returned; `proposed` and `disputed` never resolve, so a model cannot read back its own unreviewed proposal as fact. Retired terms are still returned when confirmed — a tombstone tells you the concept is dead and what replaced it. Pass `projectId` to narrow the answer to that project's linked domain pages plus the unfiled, workspace-wide terms.",
  middleware: [workspaceAccess.fromParam("workspaceId")] as const,
  request: { params: workspaceIdParam, query: resolveQuery },
  responses: {
    200: jsonResponse("Resolution result", resolveResultSchema),
    400: errorResponse("projectId outside the workspace"),
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
    "Workspace vocabulary, alphabetical. Filter by state or confidence to drive the review queue, and by `domainId` to read one domain page's knowledge; `domainId=none` returns the unfiled terms that belong to no page. The filters combine.",
  middleware: [workspaceAccess.fromParam("workspaceId")] as const,
  request: { params: workspaceIdParam, query: listTermsQuery },
  responses: {
    200: jsonResponse("Terms", termListSchema),
    400: errorResponse("domainId outside the workspace"),
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
    "Adds a term as `proposed`, which does not resolve — it never becomes `confirmed` here, because unreviewed entries accumulating is how a lexicon stops being trusted. Send `provider` and `model` together from an agent so the proposal records which model wrote it — one without the other is a 400. An agent proposal must also send `sourceEntryId`, the ledger entry the definition came out of, or the request is a 400. A person proposes with none of the three.",
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
    400: errorResponse(
      "provider without model or the reverse, an agent proposal with no sourceEntryId, or a domainId outside the workspace",
    ),
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
    "Human review outcome — the only path from `proposed` to `confirmed`, and the only thing that makes a term resolvable. Records the calling user as the reviewer with `reviewedAt`; a `disputed` outcome requires `rejectReason` and stores it, a `confirmed` one clears it. Also stamps lastVerifiedAt, which the re-verification schedule reads.",
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
    400: errorResponse(
      "A disputed outcome with a missing or blank rejectReason",
    ),
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
  .openapi(resolveRoute, async (c) => {
    const { term, projectId } = c.req.valid("query");
    return c.json(
      await resolveTerm(c.req.valid("param").workspaceId, term, projectId),
      200,
    );
  })
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
    const { termId, confidence, rejectReason } = c.req.valid("json");
    return c.json(
      await confirmTerm(
        c.req.valid("param").workspaceId,
        termId,
        confidence,
        // The reviewer is the calling user, never a value from the body: who
        // signed off is the whole content of a review.
        c.get("userId"),
        rejectReason ?? null,
      ),
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
