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
import confirmTerm from "./controllers/confirm-term";
import deleteTerm from "./controllers/delete-term";
import listTerms from "./controllers/list-terms";
import proposeTerm from "./controllers/propose-term";
import resolveTerm from "./controllers/resolve-term";
import restoreTerm from "./controllers/restore-term";
import reviewTerm from "./controllers/review-term";
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
    "Deterministic lookup: the same input always returns the same answer, with no embedding and no model judgement. Returns `confirmed`, non-deleted terms; a term applies as soon as it is proposed, and `reviewed` on each result says whether a person has checked it. `disputed` and soft-deleted terms never resolve. Retired terms are still returned — a tombstone tells you the concept is dead and what replaced it. Pass `projectId` to narrow the answer to that project's linked domain pages plus the unfiled, workspace-wide terms.",
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
    "Workspace vocabulary, alphabetical. Filter by state or confidence, and by `domainId` to read one domain page's knowledge; `domainId=none` returns the unfiled terms that belong to no page. Soft-deleted terms are hidden unless `deleted=true`, which lists only them. The filters combine.",
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
    "Adds a term that applies at once: it is stored `confirmed` and resolves immediately. Send `provider` and `model` together from an agent so the term records which model wrote it — one without the other is a 400; such a term stays unreviewed until a person reviews it. An agent proposal must also send `sourceEntryId`, the ledger entry the definition came out of, or the request is a 400. A signed-in person proposes with none of the three and is recorded as the reviewer; an API-key proposal is owned by the key's owner but stays unreviewed.",
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
    200: jsonResponse("The new term", termSchema),
    400: errorResponse(
      "provider without model or the reverse, an agent proposal with no sourceEntryId, or a domainId outside the workspace",
    ),
    403: errorResponse("No workspace access, or missing task:update"),
    409: errorResponse(
      "A term with that canonical name already exists, including a deleted one",
    ),
  },
});

const confirmRoute = createRoute({
  method: "post",
  operationId: "confirmAgentTerm",
  path: "/{workspaceId}/confirm",
  tags: ["Agent Layer"],
  summary: "Review a term",
  description:
    "Human review outcome; API-key callers get a 403. `confirmed` records the calling user as reviewer with `reviewedAt`, clearing the unreviewed mark on an agent's term; `disputed` requires `rejectReason`, stores it and withdraws the term from resolve. Also stamps lastVerifiedAt, which the re-verification schedule reads. A soft-deleted term is not found. To record only that a person read a term, use `POST /{workspaceId}/{termId}/review`.",
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
    403: errorResponse(
      "No workspace access, missing workspace:update, or API-key caller",
    ),
    404: errorResponse("Term not found"),
  },
});

const reviewRoute = createRoute({
  method: "post",
  operationId: "reviewAgentTerm",
  path: "/{workspaceId}/{termId}/review",
  tags: ["Agent Layer"],
  summary: "Mark a term reviewed",
  description:
    "Human-only: API-key callers get a 403 and no MCP tool exists. Records the calling person as having read the term (`reviewerId`/`reviewedAt`), like reviewing an ADR or a requirement document; any workspace member may do it. Confidence, the reject reason and `lastVerifiedAt` are left alone. A soft-deleted term is not found. Writes no timeline entry.",
  middleware: [workspaceAccess.fromParam("workspaceId")] as const,
  request: { params: termParams },
  responses: {
    200: jsonResponse("The reviewed term", termSchema),
    403: errorResponse("No workspace access, or API-key caller"),
    404: errorResponse("Term not found in this workspace, or deleted"),
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
    "Human-only soft delete whatever the term's confidence or state; API-key callers get a 403. The row is kept and stamped `deletedAt`/`deletedBy`, and disappears from list, resolve and the domain counts until restored. The one refusal is 409, when a live term names this one in `supersededBy`. Requires workspace:update, the same gate as review.",
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
    403: errorResponse(
      "No workspace access, missing workspace:update, or API-key caller",
    ),
    404: errorResponse("Term not found in this workspace, or already deleted"),
    409: errorResponse("Another term supersedes to this one"),
  },
});

const restoreRoute = createRoute({
  method: "post",
  operationId: "restoreAgentTerm",
  path: "/{workspaceId}/{termId}/restore",
  tags: ["Agent Layer"],
  summary: "Restore a deleted term",
  description:
    "Human-only, workspace:update. Clears `deletedAt`/`deletedBy`, so the term resolves and lists again with the confidence and review it had. A term whose `supersededBy` names a deleted term is a 409 until that term is restored.",
  middleware: [
    workspaceAccess.fromParam("workspaceId"),
    requireWorkspacePermission({ workspace: ["update"] }),
  ] as const,
  request: { params: termParams },
  responses: {
    200: jsonResponse("The restored term", termSchema),
    403: errorResponse(
      "No workspace access, missing workspace:update, or API-key caller",
    ),
    404: errorResponse("Term not found in this workspace, or not deleted"),
    409: errorResponse("The term it is superseded by is deleted"),
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
        viaApiKey: Boolean(c.get("apiKey")),
      }),
      200,
    ),
  )
  .openapi(confirmRoute, async (c) => {
    rejectApiKey(c);
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
  .openapi(reviewRoute, async (c) => {
    rejectApiKey(c);
    const { workspaceId, termId } = c.req.valid("param");
    return c.json(await reviewTerm(workspaceId, termId, c.get("userId")), 200);
  })
  .openapi(setDomainRoute, async (c) => {
    const { workspaceId, termId } = c.req.valid("param");
    return c.json(
      await setTermDomain(workspaceId, termId, c.req.valid("json").domainId),
      200,
    );
  })
  .openapi(deleteRoute, async (c) => {
    rejectApiKey(c);
    const { workspaceId, termId } = c.req.valid("param");
    return c.json(await deleteTerm(workspaceId, termId, c.get("userId")), 200);
  })
  .openapi(restoreRoute, async (c) => {
    rejectApiKey(c);
    const { workspaceId, termId } = c.req.valid("param");
    return c.json(await restoreTerm(workspaceId, termId), 200);
  });

export default agentTerm;
