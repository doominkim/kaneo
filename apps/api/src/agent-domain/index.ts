import {
  apiRouter,
  type BaseVariables,
  createRoute,
  errorResponse,
  jsonResponse,
} from "../openapi";
import { requireWorkspacePermission } from "../utils/require-workspace-permission";
import { workspaceAccess } from "../utils/workspace-access-middleware";
import createDomain from "./controllers/create-domain";
import deleteDomain from "./controllers/delete-domain";
import getDomain from "./controllers/get-domain";
import listDomains from "./controllers/list-domains";
import moveDomain from "./controllers/move-domain";
import updateDomain from "./controllers/update-domain";
import {
  domainDeleteResultSchema,
  domainListSchema,
  domainPageSchema,
  domainSchema,
} from "./response";
import {
  createDomainBody,
  domainParams,
  moveDomainBody,
  updateDomainBody,
  workspaceIdParam,
} from "./schema";

const listRoute = createRoute({
  method: "get",
  operationId: "listAgentDomains",
  path: "/{workspaceId}",
  tags: ["Agent Layer"],
  summary: "Domain page tree",
  description:
    "Every domain page of the workspace as a flat list ordered by (parentId, position, title), with `childCount` per row plus the knowledge items filed directly under it counted by review outcome (`proposedCount`, `confirmedCount`, `disputedCount`). The workspace's unfiled items are counted once at the top level under `unfiled`. No bodies. The client builds the tree from `parentId`.",
  middleware: [workspaceAccess.fromParam("workspaceId")] as const,
  request: { params: workspaceIdParam },
  responses: {
    200: jsonResponse("The pages", domainListSchema),
    403: errorResponse("No access to the workspace"),
  },
});

const createRouteDef = createRoute({
  method: "post",
  operationId: "createAgentDomain",
  path: "/{workspaceId}",
  tags: ["Agent Layer"],
  summary: "Create a domain page",
  description:
    "New page under `parentId`, or at the root when omitted. Slugs are unique per level. This is the human path: the caller becomes `updatedBy`. Requires task:update — writing domain knowledge is member work, like writing a document.",
  middleware: [
    workspaceAccess.fromParam("workspaceId"),
    requireWorkspacePermission({ task: ["update"] }),
  ] as const,
  request: {
    params: workspaceIdParam,
    body: {
      required: true,
      content: { "application/json": { schema: createDomainBody } },
    },
  },
  responses: {
    200: jsonResponse("The created page", domainSchema),
    400: errorResponse("Invalid body, or parentId outside the workspace"),
    403: errorResponse("No workspace access, or missing task:update"),
    409: errorResponse("A sibling already uses that slug"),
  },
});

const getRoute = createRoute({
  method: "get",
  operationId: "getAgentDomain",
  path: "/{workspaceId}/{domainId}",
  tags: ["Agent Layer"],
  summary: "Get a domain page",
  description:
    "The page with its markdown body, author (human `author` or agent `actor`), ancestors, children, and everything filed under it: terms, linked projects and documents. Aggregated server-side so the page view is one call.",
  middleware: [workspaceAccess.fromParam("workspaceId")] as const,
  request: { params: domainParams },
  responses: {
    200: jsonResponse("The page and its links", domainPageSchema),
    403: errorResponse("No access to the workspace"),
    404: errorResponse("Domain not found in this workspace"),
  },
});

const updateRoute = createRoute({
  method: "put",
  operationId: "updateAgentDomain",
  path: "/{workspaceId}/{domainId}",
  tags: ["Agent Layer"],
  summary: "Edit a domain page",
  description:
    "Replaces `title` and/or `body` (whichever is sent; the body is a full overwrite, never an append). The caller becomes `updatedBy` and any agent author is cleared. Last write wins.",
  middleware: [
    workspaceAccess.fromParam("workspaceId"),
    requireWorkspacePermission({ task: ["update"] }),
  ] as const,
  request: {
    params: domainParams,
    body: {
      required: true,
      content: { "application/json": { schema: updateDomainBody } },
    },
  },
  responses: {
    200: jsonResponse("The saved page", domainSchema),
    400: errorResponse("Invalid body"),
    403: errorResponse("No workspace access, or missing task:update"),
    404: errorResponse("Domain not found in this workspace"),
  },
});

const moveRoute = createRoute({
  method: "post",
  operationId: "moveAgentDomain",
  path: "/{workspaceId}/{domainId}/move",
  tags: ["Agent Layer"],
  summary: "Move or reorder a domain page",
  description:
    "Sets the parent (null for root) and optionally the sibling position. Moving a page under itself or one of its descendants is a 400; a slug clash at the target level is a 409. Requires workspace:update: the tree's shape is a workspace decision, not a page edit.",
  middleware: [
    workspaceAccess.fromParam("workspaceId"),
    requireWorkspacePermission({ workspace: ["update"] }),
  ] as const,
  request: {
    params: domainParams,
    body: {
      required: true,
      content: { "application/json": { schema: moveDomainBody } },
    },
  },
  responses: {
    200: jsonResponse("The moved page", domainSchema),
    400: errorResponse(
      "Invalid body, parentId outside the workspace, or a cycle",
    ),
    403: errorResponse("No workspace access, or missing workspace:update"),
    404: errorResponse("Domain not found in this workspace"),
    409: errorResponse("A page at the target level already uses that slug"),
  },
});

const deleteRoute = createRoute({
  method: "delete",
  operationId: "deleteAgentDomain",
  path: "/{workspaceId}/{domainId}",
  tags: ["Agent Layer"],
  summary: "Delete a domain page",
  description:
    "Hard delete, refused with 409 while the page still has children, terms, documents or linked projects — the message lists the counts. Requires workspace:update.",
  middleware: [
    workspaceAccess.fromParam("workspaceId"),
    requireWorkspacePermission({ workspace: ["update"] }),
  ] as const,
  request: { params: domainParams },
  responses: {
    200: jsonResponse(
      "The deleted page's id and slug",
      domainDeleteResultSchema,
    ),
    403: errorResponse("No workspace access, or missing workspace:update"),
    404: errorResponse("Domain not found in this workspace"),
    409: errorResponse("The page still has children or links"),
  },
});

const agentDomain = apiRouter<BaseVariables & { workspaceId: string }>()
  .openapi(listRoute, async (c) =>
    c.json(await listDomains(c.req.valid("param").workspaceId), 200),
  )
  .openapi(createRouteDef, async (c) =>
    c.json(
      await createDomain({
        ...c.req.valid("json"),
        workspaceId: c.req.valid("param").workspaceId,
        author: { updatedBy: c.get("userId") },
      }),
      200,
    ),
  )
  .openapi(getRoute, async (c) => {
    const { workspaceId, domainId } = c.req.valid("param");
    return c.json(await getDomain(workspaceId, domainId), 200);
  })
  .openapi(updateRoute, async (c) => {
    const { workspaceId, domainId } = c.req.valid("param");
    return c.json(
      await updateDomain({
        ...c.req.valid("json"),
        workspaceId,
        domainId,
        author: { updatedBy: c.get("userId") },
      }),
      200,
    );
  })
  .openapi(moveRoute, async (c) => {
    const { workspaceId, domainId } = c.req.valid("param");
    return c.json(
      await moveDomain({ ...c.req.valid("json"), workspaceId, domainId }),
      200,
    );
  })
  .openapi(deleteRoute, async (c) => {
    const { workspaceId, domainId } = c.req.valid("param");
    return c.json(await deleteDomain(workspaceId, domainId), 200);
  });

export default agentDomain;
